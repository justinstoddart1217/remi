import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useLocation, useParams } from 'react-router';

import { ErrorBoundary } from '../../app/ErrorBoundary';
import { SCREEN_IDS, SCREENS } from '../../app/screens';
import type { ScreenId } from '../../app/screens';
import { ScreenActivityContext } from '../../lib/arrival';
import type { ScreenActivity } from '../../lib/arrival';
import { focusScreenHeading } from '../../lib/focus';
import { resolveViewTransition } from '../../lib/viewTransition';
import { useUi } from '../../stores/ui';
import { useActiveScreen } from '../useActiveScreen';
import { SCREEN_COMPONENTS } from './screenComponents';
import s from './ScreenStack.module.css';

/**
 * <main> with all eight screens mounted at once (Remi.dc.html lines 107-132). The route picks
 * the active section; the others fade out and are hidden, so every screen keeps its local
 * state and scroll position. React's <Activity> is not used: it hides with display:none,
 * which would cut the fade-out.
 *
 * Cross-fade (exact): entering 'opacity 240ms ease-out 60ms, visibility 0s'; leaving
 * 'opacity 140ms ease-out, visibility 0s linear 140ms'. `data-instant` (view transition)
 * turns it off. A leaving section is made `inert` at once, before its visibility flips.
 */
export function ScreenStack() {
  const active = useActiveScreen();
  const instant = useUi((st) => st.instant);
  const { projectId } = useParams();
  const { key } = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    resolveViewTransition(active, projectId ?? null);
  }, [active, projectId]);

  useEffect(() => {
    if (!active || !useUi.getState().takeHeadingFocus()) return;
    focusScreenHeading(mainRef.current?.querySelector(`[data-screen="${active}"]`));
  }, [active, key]);

  return (
    <main ref={mainRef} className={s.main} data-instant={instant ? '' : undefined}>
      {SCREEN_IDS.map((id) => (
        <ScreenSection key={id} id={id} active={id === active} />
      ))}
    </main>
  );
}

const ScreenSection = memo(function ScreenSection({ id, active }: { id: ScreenId; active: boolean }) {
  const meta = SCREENS[id];
  const Screen = SCREEN_COMPONENTS[id];
  const activity = useMemo<ScreenActivity>(() => ({ screen: id, active }), [id, active]);
  return (
    <section
      className={s.screen}
      data-screen-label={meta.sectionLabel}
      data-screen={id}
      data-state={active ? 'active' : 'idle'}
      data-overflow={meta.overflow}
      inert={!active}
    >
      <ScreenActivityContext.Provider value={activity}>
        <ErrorBoundary label={meta.label}>
          <Screen />
        </ErrorBoundary>
      </ScreenActivityContext.Provider>
    </section>
  );
});
