/**
 * Card → workspace shared-element transition (arch-frontend-core §5, motionSystem §2).
 *
 * 1. `flushSync` sets `vtPhase: 'from', vtId: id`; the Projects card gives its goal
 *    `view-transition-name: remi-goal`.
 * 2. `document.startViewTransition` runs a callback that sets `vtPhase: 'to', instant: true`
 *    (the workspace goal takes the name and the section cross-fade is disabled) and
 *    navigates, then returns a promise that ScreenStack resolves once the workspace is the
 *    active screen with this project (`resolveViewTransition`), or after a 300ms safety
 *    timeout.
 * 3. `finished` clears the view-transition state and turns the cross-fade back on.
 *
 * Skipped (plain navigation) under reduced motion, without `startViewTransition`, or when
 * the workspace is already showing. React Router's own `viewTransition` flag is not used: it
 * can neither name the 'from' element nor suppress the cross-fade.
 */

import { flushSync } from 'react-dom';

import { paths, screenFromPath } from '../app/screens';
import { useUi } from '../stores/ui';
import { isReducedMotion } from './reducedMotion';
import { deferred } from './timers';
import type { Deferred } from './timers';

/** CSS `view-transition-name` shared by the card goal and the workspace goal. */
export const GOAL_TRANSITION_NAME = 'remi-goal';

/** How long the transition waits for the workspace to commit before snapshotting anyway. */
export const VT_SAFETY_MS = 300;

type Navigate = (to: string) => void | Promise<void>;

let pending: { projectId: string; done: Deferred<void> } | null = null;

function supportsViewTransitions(): boolean {
  return typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
}

/** Opens a project's workspace without the shared-element transition. */
export function openProject(projectId: string, navigate: Navigate): void {
  void navigate(paths.project(projectId));
}

/** Opens a project's workspace from its Projects card, with the shared-element transition. */
export function openProjectViaCard(projectId: string, navigate: Navigate): void {
  const onWorkspace = screenFromPath(window.location.pathname) === 'workspace';
  if (isReducedMotion() || !supportsViewTransitions() || onWorkspace) {
    openProject(projectId, navigate);
    return;
  }

  const ui = useUi.getState();
  flushSync(() => {
    ui.setVt('from', projectId);
  });

  pending?.done.resolve();
  const done = deferred();
  pending = { projectId, done };

  const transition = document.startViewTransition(() => {
    flushSync(() => {
      useUi.setState({ vtPhase: 'to', vtId: projectId, instant: true });
    });
    void navigate(paths.project(projectId));
    const safety = setTimeout(() => {
      done.resolve();
    }, VT_SAFETY_MS);
    return done.promise.finally(() => {
      clearTimeout(safety);
    });
  });

  void transition.finished.finally(() => {
    if (pending?.done === done) pending = null;
    useUi.setState({ vtPhase: null, vtId: null, instant: false });
  });
}

/**
 * Called by ScreenStack in a layout effect whenever the active screen or workspace project
 * changes. Resolves the pending transition once the workspace shows the right project.
 */
export function resolveViewTransition(activeScreen: string | null, projectId: string | null | undefined): void {
  if (!pending) return;
  if (activeScreen === 'workspace' && projectId === pending.projectId) {
    pending.done.resolve();
    pending = null;
  }
}
