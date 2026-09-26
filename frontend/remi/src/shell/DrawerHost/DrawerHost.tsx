import { createElement, Suspense, useEffect, useRef } from 'react';

import { ErrorBoundary } from '../../app/ErrorBoundary';
import { captureFocus } from '../../lib/focus';
import { DRAWER_LAYER, focusReturnTarget, useOverlays } from '../../stores/overlays';
import s from './DrawerHost.module.css';
import { useDrawerContent } from './registry';
import type { DrawerContentProps } from './registry';

/**
 * The check-in drawer layer (Remi.dc.html lines 135-140): an ink 18% scrim and a 1160px panel
 * (max calc(100% - 160px)) that slides from translateX(104%) over the 440ms spring with a
 * 240ms opacity fade, the same both ways. It covers the top bar too (z 20).
 *
 * The content stays mounted; it resets on each new `session`. Closed, the layer is inert;
 * on close, focus returns to whatever opened it: the trigger `openDrawer` recorded, which for a
 * palette row is what was focused before ⌘K (by now the palette's input is inert).
 */
export function DrawerHost() {
  const drawer = useOverlays((st) => st.drawer);
  const paletteOpen = useOverlays((st) => st.palette.open);
  const closeDrawer = useOverlays((st) => st.closeDrawer);
  const Content = useDrawerContent();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!drawer.open) return;
    const restore = captureFocus(focusReturnTarget(DRAWER_LAYER));
    const panel = panelRef.current;
    return () => {
      const current = document.activeElement;
      if (!current || current === document.body || panel?.contains(current)) restore();
    };
  }, [drawer.open]);

  return (
    <div className={s.layer} data-open={drawer.open ? '' : undefined} inert={!drawer.open || paletteOpen}>
      <div className={s.scrim} onClick={closeDrawer} />
      <div
        ref={panelRef}
        className={s.panel}
        data-screen-label="Check-in drawer"
        role="dialog"
        aria-modal={drawer.open}
        aria-label="Tell Remi"
      >
        {Content ? (
          <div className={s.content}>
            <ErrorBoundary label="Tell Remi">
              <Suspense fallback={null}>
                {createElement<DrawerContentProps>(Content, {
                  open: drawer.open,
                  session: drawer.session,
                  projectId: drawer.projectId,
                  prefill: drawer.prefill,
                  onClose: closeDrawer,
                })}
              </Suspense>
            </ErrorBoundary>
          </div>
        ) : null}
      </div>
    </div>
  );
}
