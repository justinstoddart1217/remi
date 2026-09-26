/**
 * Autosave for Textbook pages (arch-frontend-screens §4 "Save status"). It lives at the screen
 * level, so a save still lands when the editor for its page has gone (page switches flush).
 *
 * - Blocks: debounced 350ms, `PUT …/blocks {blocks, baseVersion}`. Saves of one page run one
 *   after another, each with the version the previous one returned.
 * - Title: debounced 350ms, `PATCH /textbook/pages/{id}` (a rename never bumps the version).
 * - 409 `VERSION_CONFLICT` (another tab saved first): the saver fetches the latest copy and
 *   merges this tab's edits onto it block by block (merge.ts), saves the result, and the page
 *   is reloaded from it (`onConflict`). Typing is never thrown away: a block both tabs changed
 *   keeps both versions.
 * - Leaving the page (reload, close) while anything is unsent or failing asks first
 *   (`beforeunload`), and sends what is waiting straight away.
 * - 404: the page is gone (`onGone`).
 * - Network or server errors: "Not saved · retrying", again 3s later.
 * - Status copy: "Saving…" while a request is out, "Saved" for 5s after a save (or after the
 *   page is opened), otherwise "Saved locally" (arch-frontend-screens §4). The prototype's
 *   resting line was "Saved in this browser" (:657) because it kept pages in localStorage;
 *   Remi keeps them in the local server's database, so that line would be false.
 *
 * The engine is plain closures (no hooks), created once per screen; the hook feeds it the
 * latest mutation functions and events and mirrors its statuses into React state.
 */

import { useEffect, useState } from 'react';

import { isRemiApiError, useSavePageBlocks, useUpdatePage } from '../../api';
import type { PageSavedOut } from '../../api';
import type { Block } from './editor';
import { mergeBlocks, sameBlocks } from './merge';

export const SAVE_DEBOUNCE_MS = 350;
export const SAVED_FOR_MS = 5000;
export const RETRY_MS = 3000;

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export const SAVE_COPY: Record<SaveStatus, string> = {
  idle: 'Saved locally',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Not saved · retrying',
};

/**
 * What a 409 came to: `latest` (nothing of this tab's to keep, so the page shows the server's
 * copy), `merged` (this tab's edits were added to it) or `kept` (some blocks both tabs changed
 * now appear twice, theirs then this tab's).
 */
export type ConflictOutcome = 'latest' | 'merged' | 'kept';

/** The toast after a 409 (arch-frontend-screens §4 gives the `latest` line). */
export const CONFLICT_COPY: Record<ConflictOutcome, string> = {
  latest: 'This page changed in another tab. Showing the latest.',
  merged: 'This page changed in another tab. Your edits were added to the latest.',
  kept: 'This page changed in another tab. Blocks you both edited now show both versions.',
};

export interface SaverEvents {
  /** The page's latest copy on the server (after a 409). */
  latest: (pageId: string) => Promise<{ version: number; blocks: Block[] }>;
  /** A 409 was resolved: reload the page's editor (it starts from `pendingBlocks`, else the server copy). */
  onConflict: (pageId: string, outcome: ConflictOutcome) => void;
  onGone: (pageId: string) => void;
}

/** The saver's commands. The object is stable for the life of the screen. */
export interface PageSaver {
  /**
   * A page was opened (or reloaded) at `version` with `blocks`: "Saved" for 5s. A save still
   * waiting or in flight for it is kept, and keeps its own version.
   */
  loaded: (pageId: string, version: number, blocks: Block[]) => void;
  /** Blocks typed on a page that the server may not have yet (waiting or in flight): a page reopened before its save landed starts from these. */
  pendingBlocks: (pageId: string) => Block[] | null;
  /** The server answered a newer version for this page (a sub-page was created in it). */
  setVersion: (pageId: string, version: number) => void;
  schedule: (pageId: string, blocks: Block[]) => void;
  scheduleTitle: (pageId: string, title: string) => void;
  /** Sends anything pending for the page now; resolves when it has landed (or failed). */
  flush: (pageId: string) => Promise<void>;
  /** Drops anything pending (the page is being deleted). */
  discard: (pageId: string) => void;
  /** Anything typed that the server does not have yet (waiting, in flight, failing or merging). */
  hasUnsaved: () => boolean;
  /** Sends everything waiting on every page now (the tab is being left). */
  flushAll: () => void;
}

/** What the saver calls out to; `setDeps` swaps in the latest ones after each render. */
export interface SaverDeps {
  save: (args: { pageId: string; blocks: Block[]; baseVersion: number }) => Promise<Pick<PageSavedOut, 'version'>>;
  rename: (args: { pageId: string; title: string }) => Promise<unknown>;
  events: SaverEvents;
}

type Report = (pageId: string, status: SaveStatus) => void;

const NO_DEPS: SaverDeps = {
  save: () => Promise.reject(new Error('saver not ready')),
  rename: () => Promise.reject(new Error('saver not ready')),
  events: { latest: () => Promise.reject(new Error('saver not ready')), onConflict: () => undefined, onGone: () => undefined },
};

interface PageState {
  version: number;
  /** The blocks the server holds at `version`, as far as this tab knows (the merge base). */
  base: Block[] | null;
  pending: Block[] | null;
  inflight: boolean;
  /** The blocks of the save in flight. */
  sending: Block[] | null;
  /** A 409 is being resolved: nothing is sent until the latest copy is merged. */
  merging: boolean;
  title: string | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  titleTimer: ReturnType<typeof setTimeout> | undefined;
  retry: ReturnType<typeof setTimeout> | undefined;
  chain: Promise<void>;
  titleChain: Promise<void>;
}

const busy = (ps: PageState) => ps.pending !== null || ps.inflight || ps.merging;
const titleWaiting = (ps: PageState) => ps.title !== null;

/** The saver itself, without React (exported for tests). */
export function createPageSaver(report: Report, initial: SaverDeps = NO_DEPS): PageSaver & { dispose: () => void; setDeps: (deps: SaverDeps) => void } {
  const pages = new Map<string, PageState>();
  let deps = initial;

  const state = (pageId: string): PageState => {
    let ps = pages.get(pageId);
    if (!ps) {
      ps = {
        version: 0,
        base: null,
        pending: null,
        inflight: false,
        sending: null,
        merging: false,
        title: null,
        timer: undefined,
        titleTimer: undefined,
        retry: undefined,
        chain: Promise.resolve(),
        titleChain: Promise.resolve(),
      };
      pages.set(pageId, ps);
    }
    return ps;
  };

  async function saveNow(pageId: string): Promise<void> {
    const ps = state(pageId);
    const blocks = ps.pending;
    if (!blocks || ps.merging) return;
    ps.pending = null;
    ps.inflight = true;
    ps.sending = blocks;
    report(pageId, 'saving');
    try {
      const out = await deps.save({ pageId, blocks, baseVersion: ps.version });
      ps.version = out.version;
      ps.base = blocks;
      ps.inflight = false;
      ps.sending = null;
      report(pageId, busy(ps) ? 'saving' : 'saved');
    } catch (error) {
      ps.inflight = false;
      ps.sending = null;
      if (isRemiApiError(error, 'VERSION_CONFLICT')) {
        // Anything typed while this save was out is newer than `blocks`.
        ps.pending ??= blocks;
        ps.merging = true;
        clearTimeout(ps.timer);
        report(pageId, 'saving');
        await rebase(pageId);
      } else if (isRemiApiError(error, 'NOT_FOUND')) {
        ps.pending = null;
        report(pageId, 'idle');
        deps.events.onGone(pageId);
      } else {
        ps.pending ??= blocks;
        report(pageId, 'error');
        clearTimeout(ps.retry);
        ps.retry = setTimeout(() => {
          ps.chain = ps.chain.then(() => saveNow(pageId));
        }, RETRY_MS);
      }
    }
  }

  /**
   * After a 409: fetch the latest copy, merge this tab's edits onto it and save the result
   * with the latest version. A failed fetch is retried like a failed save.
   */
  async function rebase(pageId: string): Promise<void> {
    const ps = state(pageId);
    let latest: { version: number; blocks: Block[] };
    try {
      latest = await deps.events.latest(pageId);
    } catch (error) {
      if (isRemiApiError(error, 'NOT_FOUND')) {
        ps.merging = false;
        ps.pending = null;
        report(pageId, 'idle');
        deps.events.onGone(pageId);
        return;
      }
      report(pageId, 'error');
      clearTimeout(ps.retry);
      ps.retry = setTimeout(() => {
        ps.chain = ps.chain.then(() => rebase(pageId));
      }, RETRY_MS);
      return;
    }
    const mine = ps.pending;
    const base = ps.base;
    ps.merging = false;
    ps.version = latest.version;
    ps.base = latest.blocks;
    let outcome: ConflictOutcome = 'latest';
    if (mine && base && !sameBlocks(mine, base)) {
      const merged = mergeBlocks(base, mine, latest.blocks);
      if (sameBlocks(merged.blocks, latest.blocks)) {
        ps.pending = null;
      } else {
        ps.pending = merged.blocks;
        outcome = merged.kept > 0 ? 'kept' : 'merged';
      }
    } else {
      ps.pending = null;
    }
    deps.events.onConflict(pageId, outcome);
    if (ps.pending) {
      await saveNow(pageId);
    } else {
      report(pageId, 'saved');
    }
  }

  async function titleNow(pageId: string): Promise<void> {
    const ps = state(pageId);
    const title = ps.title;
    if (title === null) return;
    ps.title = null;
    try {
      await deps.rename({ pageId, title });
      if (!titleWaiting(ps)) report(pageId, busy(ps) ? 'saving' : 'saved');
    } catch (error) {
      if (isRemiApiError(error, 'NOT_FOUND')) return;
      ps.title ??= title;
      report(pageId, 'error');
      clearTimeout(ps.titleTimer);
      ps.titleTimer = setTimeout(() => {
        ps.titleChain = ps.titleChain.then(() => titleNow(pageId));
      }, RETRY_MS);
    }
  }

  function flush(pageId: string): Promise<void> {
    const ps = state(pageId);
    clearTimeout(ps.timer);
    clearTimeout(ps.titleTimer);
    clearTimeout(ps.retry);
    ps.chain = ps.chain.then(() => saveNow(pageId));
    ps.titleChain = ps.titleChain.then(() => titleNow(pageId));
    return Promise.all([ps.chain, ps.titleChain]).then(() => undefined);
  }

  return {
    loaded: (pageId, version, blocks) => {
      const ps = state(pageId);
      const waiting = busy(ps);
      if (!waiting) {
        ps.version = version;
        ps.base = blocks;
      }
      report(pageId, waiting ? 'saving' : 'saved');
    },
    pendingBlocks: (pageId) => {
      const ps = pages.get(pageId);
      return ps?.pending ?? ps?.sending ?? null;
    },
    setVersion: (pageId, version) => {
      state(pageId).version = version;
    },
    schedule: (pageId, blocks) => {
      const ps = state(pageId);
      ps.pending = blocks;
      clearTimeout(ps.timer);
      ps.timer = setTimeout(() => {
        ps.chain = ps.chain.then(() => saveNow(pageId));
      }, SAVE_DEBOUNCE_MS);
    },
    scheduleTitle: (pageId, title) => {
      const ps = state(pageId);
      ps.title = title;
      clearTimeout(ps.titleTimer);
      ps.titleTimer = setTimeout(() => {
        ps.titleChain = ps.titleChain.then(() => titleNow(pageId));
      }, SAVE_DEBOUNCE_MS);
    },
    flush,
    discard: (pageId) => {
      const ps = state(pageId);
      clearTimeout(ps.timer);
      clearTimeout(ps.titleTimer);
      clearTimeout(ps.retry);
      ps.pending = null;
      ps.title = null;
      ps.merging = false;
    },
    hasUnsaved: () => [...pages.values()].some((ps) => busy(ps) || titleWaiting(ps)),
    flushAll: () => {
      for (const [id, ps] of pages) if ((ps.pending && !ps.inflight && !ps.merging) || titleWaiting(ps)) void flush(id);
    },
    setDeps: (next) => {
      deps = next;
    },
    dispose: () => {
      // Leaving the Textbook: send whatever is still waiting.
      for (const id of pages.keys()) void flush(id);
    },
  };
}

export function usePageSaver(events: SaverEvents): { saver: PageSaver; statusOf: (pageId: string | null) => SaveStatus } {
  const saveBlocks = useSavePageBlocks();
  const rename = useUpdatePage();
  const [statuses, setStatuses] = useState<Readonly<Record<string, SaveStatus>>>({});
  const [timers] = useState(() => new Map<string, ReturnType<typeof setTimeout>>());
  const [saver] = useState(() =>
    createPageSaver((pageId, status) => {
      clearTimeout(timers.get(pageId));
      setStatuses((prev) => (prev[pageId] === status ? prev : { ...prev, [pageId]: status }));
      if (status === 'saved') {
        timers.set(
          pageId,
          setTimeout(() => {
            setStatuses((prev) => (prev[pageId] === 'saved' ? { ...prev, [pageId]: 'idle' } : prev));
          }, SAVED_FOR_MS),
        );
      }
    }),
  );

  useEffect(() => {
    saver.setDeps({ save: saveBlocks.mutateAsync, rename: rename.mutateAsync, events });
  });

  useEffect(
    () => () => {
      saver.dispose();
      for (const t of timers.values()) clearTimeout(t);
    },
    [saver, timers],
  );

  // Reloading or closing the tab with typing the server does not have yet: send it now and ask
  // the browser to confirm, so a 350ms debounce or a failing save never loses it silently.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!saver.hasUnsaved()) return;
      saver.flushAll();
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('beforeunload', onLeave);
    };
  }, [saver]);

  const statusOf = (pageId: string | null): SaveStatus => (pageId ? (statuses[pageId] ?? 'idle') : 'idle');
  return { saver, statusOf };
}
