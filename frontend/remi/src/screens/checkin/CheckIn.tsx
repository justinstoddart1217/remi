/**
 * Tell Remi (CheckIn.dc.html): the check-in drawer's content. DrawerHost owns the frame (scrim,
 * sliding 1160px panel, focus return); this owns everything inside it.
 *
 * The state machine lives in ./reducer (compose → thinking → review | error). Reading an
 * update goes through `useCheckinParser` (one AbortController and session guard per parse:
 * `POST /checkins/parse`, or `/parse-simple` for "Use a simple reading"). The server picks the
 * provider from Settings; with `none` (the default) the simple reading comes straight back.
 * Review previews the ticked changes with the server (debounced 150ms, preview == apply), and
 * applying closes the drawer at once; the plan moves 220ms later (`useApplyCheckin`). If the
 * apply fails, the drawer reopens on the same review with a toast.
 *
 * Keys: ⌘/Ctrl+Enter on the drawer root sends in compose and error and applies in review
 * (crit :9). Typing during review or error drops back to compose (crit :309).
 */

import { useCallback, useLayoutEffect, useReducer, useRef } from 'react';
import type { KeyboardEvent } from 'react';

import { isRemiApiError, useAiStatus, useApplyCheckin, useCheckinParser, useProjects, useRoutines } from '../../api';
import type { ParseMode, ProjectOut } from '../../api';
import { Icon } from '../../components/Icon';
import { Toast, useToast } from '../../components/Toast';
import { DOMAIN_ACCENT, DOMAIN_SOFT } from '../../components/shared/domain';
import { FOCUS_DELAY, placeCaretAtEnd } from '../../lib/focus';
import { isSubmitShortcut } from '../../lib/keyboard';
import { afterTwoFrames, sleep } from '../../lib/timers';
import type { DrawerContentProps } from '../../shell/DrawerHost';
import { useOverlays } from '../../stores/overlays';
import s from './CheckIn.module.css';
import {
  APPLY_FAILED,
  CANCEL,
  CLEAR_FOCUS_TITLE,
  CLOSE_TITLE,
  EDIT_UPDATE,
  NO_FOCUS,
  PLACEHOLDER,
  SEND_LABEL,
  SHORTCUT,
  SUBTITLE,
  TITLE,
} from './copy';
import { applyLabel, footNoteFor, hintFor, MIN_DWELL_MS, prefillText, providerIndicator, selectedChanges } from './model';
import { ComposePanel, ErrorPanel, ReviewPanel, ThinkingPanel } from './Panels';
import { canSend, checkinReducer, initialState } from './reducer';
import type { CheckinAction, CheckinState } from './reducer';

const NO_PROJECTS: readonly ProjectOut[] = [];

function messageOf(error: unknown): string {
  if (isRemiApiError(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'unknown error';
}

export function CheckInDrawer({ open, session, projectId, prefill, onClose }: DrawerContentProps) {
  const projects = useProjects() ?? NO_PROJECTS;
  const routines = useRoutines() ?? [];
  const ai = useAiStatus();
  const parser = useCheckinParser();
  const apply = useApplyCheckin();
  const toast = useToast();
  const taRef = useRef<HTMLTextAreaElement>(null);

  const shortOf = (id: string | null) => (id ? (projects.find((p) => p.id === id)?.short ?? null) : null);
  const [state, dispatch] = useReducer(checkinReducer, undefined, () =>
    initialState(session, projectId, prefillText(prefill, shortOf(projectId)), open),
  );

  // A new drawer session resets the composer (or reopens a review whose apply failed); closing
  // abandons a reading in flight. Derived from props during render, as the prototype's reset().
  if (session !== state.session) {
    dispatch(
      state.restoreNext
        ? { type: 'restore', session, open }
        : { type: 'open', session, focus: projectId, text: prefillText(prefill, shortOf(projectId)), open },
    );
  } else if (open !== state.open) {
    dispatch({ type: 'visibility', open });
  }

  // Event handlers read the latest state here; `act` keeps it current between renders.
  const stateRef = useRef<CheckinState>(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });
  const act = useCallback((action: CheckinAction) => {
    stateRef.current = checkinReducer(stateRef.current, action);
    dispatch(action);
  }, []);

  // Closing (Escape, scrim, ×, apply) stops the server's work on a reading in flight.
  useLayoutEffect(() => {
    if (!open) parser.cancel();
  }, [open, parser]);

  // On open: focus the textarea at 380ms with the caret at the end (crit :167).
  useLayoutEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      placeCaretAtEnd(el);
    }, FOCUS_DELAY.drawer);
    return () => {
      clearTimeout(id);
    };
  }, [open, session]);

  const focusProject = state.focus ? (projects.find((p) => p.id === state.focus) ?? null) : null;

  const read = useCallback(
    async (mode: ParseMode) => {
      const before = stateRef.current;
      if (mode === 'auto') {
        if (!canSend(before)) return;
        act({ type: 'send' });
      } else {
        act({ type: 'simple' });
        if (!stateRef.current.simplePending) return;
      }
      const { attempt } = stateRef.current;
      const started = performance.now();
      const cancelFrames =
        mode === 'auto'
          ? afterTwoFrames(() => {
              act({ type: 'reading', attempt });
            })
          : () => undefined;
      const text = before.text.trim();
      const focus = before.focus && projects.some((p) => p.id === before.focus) ? before.focus : null;
      const dwell = async () => {
        if (mode !== 'auto') return;
        const left = MIN_DWELL_MS - (performance.now() - started);
        if (left > 0) await sleep(left);
      };
      try {
        const result = await parser.parse({ text, focusProjectId: focus, mode });
        if (result === null) return;
        act({ type: 'answered', attempt });
        await dwell();
        act({ type: 'resolved', attempt, result });
        afterTwoFrames(() => {
          act({ type: 'shown', attempt });
        });
      } catch (error) {
        await dwell();
        act({ type: 'failed', attempt, message: messageOf(error) });
      } finally {
        cancelFrames();
      }
    },
    [act, parser, projects],
  );

  const send = useCallback(() => {
    void read('auto');
  }, [read]);

  const simple = useCallback(() => {
    void read('simple');
  }, [read]);

  const applyNow = useCallback(() => {
    const st = stateRef.current;
    if (st.phase !== 'review' || !st.result) return;
    const changes = selectedChanges(st.result.changes, st.off);
    if (!changes.length) return;
    const at = st.session;
    const focus = st.focus && projects.some((p) => p.id === st.focus) ? st.focus : null;
    apply.mutate(
      { changes, rawText: st.text, focusProjectId: focus, source: st.result.source, parseId: st.result.parseId },
      {
        onError: () => {
          act({ type: 'applyFailed', session: at });
          if (stateRef.current.restoreNext) {
            const drawer = useOverlays.getState().drawer;
            useOverlays.getState().openDrawer(drawer.projectId, drawer.prefill);
          }
          toast.show(APPLY_FAILED);
        },
      },
    );
  }, [act, apply, projects, toast]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isSubmitShortcut(e) || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (stateRef.current.phase === 'review') applyNow();
    else send();
  };

  const edit = () => {
    act({ type: 'edit' });
    setTimeout(() => taRef.current?.focus({ preventScroll: true }), FOCUS_DELAY.editUpdate);
  };

  const { phase, result } = state;
  const selectedCount = result ? selectedChanges(result.changes, state.off).length : 0;
  const provider = providerIndicator(ai.data);

  return (
    <div className={s.root} data-phase={phase} onKeyDown={onKeyDown}>
      <div className={s.header}>
        <div className={s.heading}>
          <span className={s.title}>
            {TITLE}
            <span className={s.provider} data-state={provider.state} role="img" aria-label={provider.label} title={provider.label} />
          </span>
          <span className={s.subtitle}>{SUBTITLE}</span>
        </div>
        <div className={s.spacer} />
        <button type="button" className={s.close} onClick={onClose} title={CLOSE_TITLE} aria-label="Close">
          <Icon name="close" className={s.closeIcon} />
        </button>
      </div>

      <div className={s.body}>
        <div className={s.left}>
          <div className={s.focusRow}>
            {focusProject ? (
              <span className={s.focusChip} style={{ background: DOMAIN_SOFT[focusProject.domain] }}>
                <span className={s.focusDot} style={{ background: DOMAIN_ACCENT[focusProject.domain] }} />
                <span className={s.muted}>About</span>
                <span className={s.strong}>{focusProject.name}</span>
                <button
                  type="button"
                  className={s.focusClear}
                  onClick={() => {
                    act({ type: 'clearFocus' });
                  }}
                  title={CLEAR_FOCUS_TITLE}
                  aria-label={CLEAR_FOCUS_TITLE}
                >
                  <Icon name="close" className={s.focusClearIcon} />
                </button>
              </span>
            ) : (
              <span className={s.noFocus}>{NO_FOCUS}</span>
            )}
          </div>
          <textarea
            ref={taRef}
            className={s.textarea}
            value={state.text}
            onChange={(e) => {
              act({ type: 'type', text: e.target.value });
            }}
            readOnly={phase === 'thinking'}
            data-locked={phase === 'thinking' ? '' : undefined}
            placeholder={PLACEHOLDER}
            aria-label="Your update"
          />
          <div className={s.hintRow}>
            <span className={s.hint}>{hintFor(phase, state.text)}</span>
            {phase === 'compose' ? (
              <button type="button" className={s.primary} data-tone="brand" onClick={send}>
                {SEND_LABEL} <span className={s.kbd}>{SHORTCUT}</span>
              </button>
            ) : null}
          </div>
        </div>

        <div className={s.right}>
          {phase === 'compose' ? <ComposePanel /> : null}
          {phase === 'thinking' ? <ThinkingPanel progress={state.progress} echo={state.echo} echoOn={state.echoOn} /> : null}
          {phase === 'review' && result ? (
            <ReviewPanel
              result={result}
              off={state.off}
              shown={state.shown}
              projects={projects}
              routines={routines}
              onToggle={(index) => {
                act({ type: 'toggle', index });
              }}
            />
          ) : null}
          {phase === 'error' ? (
            <ErrorPanel message={state.error} simplePending={state.simplePending} onRetry={send} onSimple={simple} />
          ) : null}
        </div>
      </div>

      <div className={s.footer}>
        <span className={s.footNote}>{footNoteFor(phase)}</span>
        <div className={s.spacer} />
        {phase === 'review' ? (
          <>
            <button type="button" className={s.outline} onClick={edit}>
              {EDIT_UPDATE}
            </button>
            <button type="button" className={s.primary} onClick={applyNow} disabled={selectedCount === 0}>
              {applyLabel(selectedCount)} <span className={s.kbd}>{SHORTCUT}</span>
            </button>
          </>
        ) : (
          <button type="button" className={s.outline} onClick={onClose}>
            {CANCEL}
          </button>
        )}
      </div>

      <Toast message={toast.message} />
    </div>
  );
}
