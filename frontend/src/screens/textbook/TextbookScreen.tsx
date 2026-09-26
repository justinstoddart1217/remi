import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import {
  keys,
  textbookPageQuery,
  useCreatePage,
  useCreateSection,
  useDeletePage,
  useSettings,
  useTextbookTree,
  useUpdateUiPrefs,
} from '../../api';
import type { PageOut } from '../../api';
import { paths } from '../../app/screens';
import { useToast } from '../../components';
import { useReducedMotion } from '../../lib/reducedMotion';
import { Stage } from '../../shell/Stage';
import { TextbookContext } from './context';
import type { TextbookCtx } from './context';
import { PageView } from './PageView';
import { Sidebar } from './Sidebar';
import type { SectionEdit } from './Sidebar';
import s from './Textbook.module.css';
import { TextbookHome } from './TextbookHome';
import { ancestorsOf, descendantsOf } from './tree';
import type { LivePage } from './tree';
import { CONFLICT_COPY, SAVE_COPY, usePageSaver } from './usePageSaver';

/** A page switch fades the old page out for 120ms, then shows the new one (:426-432). */
const SWITCH_MS = 120;

/**
 * The Textbook (`/textbook/:pageId?`, Remi Textbook.dc.html): a scaled canvas with the sidebar,
 * the page (or Textbook home) and the outline column. The route names the page; everything on
 * it lives on the server (sections, pages, blocks, charts) and saves as you type.
 */
export function TextbookScreen() {
  const params = useParams();
  const routeId = params.pageId ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reduced = useReducedMotion();
  const tree = useTextbookTree().data;
  const prefs = useSettings().data?.uiPrefs;
  const { message: toastMessage, show: toast } = useToast();
  const createPage = useCreatePage();
  const createSection = useCreateSection();
  const removePage = useDeletePage();
  const { mutate: savePrefs } = useUpdateUiPrefs();

  const [shownId, setShownId] = useState(routeId);
  const [switched, setSwitched] = useState(false);
  const [live, setLive] = useState<LivePage | null>(null);
  const [reloads, setReloads] = useState<Readonly<Record<string, number>>>({});
  const [secEdit, setSecEdit] = useState<SectionEdit | null>(null);
  const [sideOpenLocal, setSideOpenLocal] = useState<boolean | null>(null);
  const [collapsedLocal, setCollapsedLocal] = useState<ReadonlySet<string> | null>(null);
  const focusTitleFor = useRef<string | null>(null);
  const deleted = useRef(new Set<string>());

  const goHomeTo = useCallback(
    (nextId: string | null) => {
      void navigate(nextId ? paths.textbook(nextId) : paths.textbook(), { replace: true });
    },
    [navigate],
  );

  const { saver, statusOf } = usePageSaver({
    latest: (id) => queryClient.query({ ...textbookPageQuery(id), staleTime: 0 }),
    onConflict: (id, outcome) => {
      toast(CONFLICT_COPY[outcome]);
      setReloads((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }));
    },
    onGone: (id) => {
      if (deleted.current.has(id) || id !== routeId) return;
      toast('That page no longer exists.');
      goHomeTo(null);
    },
  });

  // ------------------------------------------------------------------ page switches
  const switching = routeId !== shownId;
  useEffect(() => {
    if (routeId === shownId) return;
    if (shownId) void saver.flush(shownId);
    if (routeId) queryClient.query(textbookPageQuery(routeId)).catch(() => undefined);
    const t = setTimeout(() => {
      setShownId(routeId);
      setSwitched(true);
    }, SWITCH_MS);
    return () => {
      clearTimeout(t);
    };
  }, [routeId, shownId, saver, queryClient]);

  // ------------------------------------------------------------------ the last page
  // The open page is remembered (uiPrefs.lastTextbookPageId). Textbook home marks it in the
  // sidebar, as the prototype marks its current page there (Remi Textbook.dc.html `cur`).
  const lastSaved = prefs?.lastTextbookPageId ?? null;
  const shownExists = Boolean(shownId && tree?.pages.some((p) => p.id === shownId));
  useEffect(() => {
    if (shownId && shownExists && shownId !== lastSaved) savePrefs({ lastTextbookPageId: shownId });
  }, [shownId, shownExists, lastSaved, savePrefs]);
  const lastId = lastSaved && tree?.pages.some((p) => p.id === lastSaved) ? lastSaved : null;

  // ------------------------------------------------------------------ remembered layout
  const sideOpen = sideOpenLocal ?? prefs?.textbookSidebarOpen ?? true;
  const setSideOpen = useCallback(
    (open: boolean) => {
      setSideOpenLocal(open);
      savePrefs({ textbookSidebarOpen: open });
    },
    [savePrefs],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === '\\') {
        e.preventDefault();
        setSideOpen(!sideOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [sideOpen, setSideOpen]);

  // Folded pages; the ancestors of a page opened by URL start unfolded.
  const collapsed = useMemo<ReadonlySet<string>>(() => {
    if (collapsedLocal) return collapsedLocal;
    const set = new Set(prefs?.collapsedPageIds ?? []);
    if (tree && routeId) for (const a of ancestorsOf(tree.pages, routeId)) set.delete(a.id);
    return set;
  }, [collapsedLocal, prefs?.collapsedPageIds, tree, routeId]);

  const setCollapsed = useCallback(
    (next: ReadonlySet<string>) => {
      setCollapsedLocal(next);
      savePrefs({ collapsedPageIds: [...next] });
    },
    [savePrefs],
  );

  const togglePage = useCallback(
    (id: string) => {
      const next = new Set(collapsed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setCollapsed(next);
    },
    [collapsed, setCollapsed],
  );

  /** Unfolds `ids` (a page's ancestors, or a parent that just gained a page). */
  const unfold = useCallback(
    (ids: readonly string[]) => {
      const folded = ids.filter((id) => collapsed.has(id));
      if (!folded.length) return;
      const next = new Set(collapsed);
      for (const id of folded) next.delete(id);
      setCollapsed(next);
    },
    [collapsed, setCollapsed],
  );

  // ------------------------------------------------------------------ actions
  const openPage = useCallback(
    (id: string) => {
      if (tree) unfold(ancestorsOf(tree.pages, id).map((a) => a.id));
      if (id !== routeId) void navigate(paths.textbook(id));
    },
    [tree, unfold, routeId, navigate],
  );

  const openHome = useCallback(() => {
    if (routeId !== null) void navigate(paths.textbook());
  }, [routeId, navigate]);

  const newPageIn = useCallback(
    (sectionId: string) => {
      createPage
        .mutateAsync({ sectionId })
        .then((out) => {
          focusTitleFor.current = out.page.id;
          void navigate(paths.textbook(out.page.id));
        })
        .catch(() => {
          toast('Couldn’t add a page. Try again.');
        });
    },
    [createPage, navigate, toast],
  );

  const createSub = useCallback(
    (parentId: string, replaceBlockId?: string) => {
      const sectionId =
        tree?.pages.find((p) => p.id === parentId)?.sectionId ?? queryClient.getQueryData<PageOut>(keys.textbook.page(parentId))?.sectionId;
      if (!sectionId) return;
      // The parent's latest blocks land first: the server swaps or appends the link block.
      saver
        .flush(parentId)
        .then(() => createPage.mutateAsync({ sectionId, parentId, replaceBlockId: replaceBlockId ?? null }))
        .then((out) => {
          unfold([parentId]);
          focusTitleFor.current = out.page.id;
          void navigate(paths.textbook(out.page.id));
        })
        .catch(() => {
          toast('Couldn’t add a page. Try again.');
        });
    },
    [tree, queryClient, saver, createPage, unfold, navigate, toast],
  );

  const deletePage = useCallback(
    (id: string) => {
      const ids = [id, ...(tree ? descendantsOf(tree.pages, id) : [])];
      for (const x of ids) {
        deleted.current.add(x);
        saver.discard(x);
      }
      removePage
        .mutateAsync({ pageId: id })
        .then((out) => {
          goHomeTo(out.nextPageId);
        })
        .catch(() => {
          for (const x of ids) deleted.current.delete(x);
          toast('Couldn’t delete that page. Try again.');
        });
    },
    [tree, saver, removePage, goHomeTo, toast],
  );

  const pageGone = useCallback(
    (id: string) => {
      if (deleted.current.has(id) || id !== routeId) return;
      toast('That page no longer exists.');
      goHomeTo(null);
    },
    [routeId, toast, goHomeTo],
  );

  const addSection = useCallback(() => {
    createSection
      .mutateAsync({})
      .then((sec) => {
        setSideOpen(true);
        setSecEdit({ id: sec.id, draft: '' });
      })
      .catch(() => {
        toast('Couldn’t add a section. Try again.');
      });
  }, [createSection, setSideOpen, toast]);

  const takeFocusTitle = useCallback((id: string) => {
    if (focusTitleFor.current !== id) return false;
    focusTitleFor.current = null;
    return true;
  }, []);

  const reloadOf = useCallback((id: string) => reloads[id] ?? 0, [reloads]);

  const saveStatus = SAVE_COPY[statusOf(shownId)];
  const ctx = useMemo<TextbookCtx>(
    () => ({
      tree,
      saver,
      saveStatus,
      toastMessage,
      toast,
      openPage,
      openHome,
      newPageIn,
      createSub,
      deletePage,
      pageGone,
      addSection,
      setLive,
      takeFocusTitle,
      reloadOf,
      reduced,
    }),
    [tree, saver, saveStatus, toastMessage, toast, openPage, openHome, newPageIn, createSub, deletePage, pageGone, addSection, takeFocusTitle, reloadOf, reduced],
  );

  return (
    <TextbookContext.Provider value={ctx}>
      <Stage label="Textbook" className={clsx(s.stage, !sideOpen && s.stageClosed)}>
        <Sidebar
          currentId={shownId}
          lastId={lastId}
          open={sideOpen}
          onOpenChange={setSideOpen}
          collapsed={collapsed}
          onTogglePage={togglePage}
          live={live?.pageId === shownId ? live : null}
          secEdit={secEdit}
          onSecEdit={setSecEdit}
        />
        {shownId ? (
          <PageView key={shownId} pageId={shownId} fade={switching} fadeIn={switched} />
        ) : (
          <TextbookHome key="home" fade={switching} fadeIn={switched} />
        )}
      </Stage>
    </TextbookContext.Provider>
  );
}
