import clsx from 'clsx';
import { useMemo, useRef } from 'react';
import type { ReactNode } from 'react';

import { canvasStyle, computeStage, parseFrameParam, StageContext, useViewportSize } from '../../lib/stage';
import type { Frame, StageInfo } from '../../lib/stage';
import s from './Stage.module.css';

/** `?frame=` is read once, from the URL the app was opened with, so it survives navigation. */
const INITIAL_FRAME: Frame | null = typeof window === 'undefined' ? null : parseFrameParam(window.location.search);

interface Props {
  /** `data-screen-label` of the canvas ("Remi app", "Remi home"). */
  label?: string;
  /**
   * Canvas size. Omit for the app default: 'Fit window', or the `?frame=` the app was opened
   * with. Pass a frame for a fixed art-directed canvas (Home: 1920×1080 scaled uniformly).
   */
  frame?: Frame;
  /** Layout of the canvas itself (the app shell's grid). */
  className?: string;
  children: ReactNode;
}

/**
 * The canvas and its letterbox (Remi.dc.html's outer fixed div and the "Remi app" stage).
 * The canvas always carries `transform: scale(s)`, even at scale 1, exactly as the prototype,
 * so `position: fixed` descendants stay relative to it. In 'Fit window' the letterbox scrolls
 * when the window (or a zoomed-in one) is smaller than the canvas's minimum (lib/stage.ts).
 */
export function Stage({ label, frame, className, children }: Props) {
  const { vw, vh } = useViewportSize();
  const ref = useRef<HTMLDivElement>(null);
  const g = computeStage(vw, vh, frame ?? INITIAL_FRAME);
  const info = useMemo<StageInfo>(
    () => ({ w: g.w, h: g.h, s: g.s, x: g.x, y: g.y, mode: g.mode, ref }),
    [g.w, g.h, g.s, g.x, g.y, g.mode],
  );
  return (
    <div className={s.letterbox} data-stage-mode={g.mode}>
      <div ref={ref} className={clsx(s.stage, className)} data-screen-label={label} data-stage={g.mode} style={canvasStyle(g)}>
        <StageContext.Provider value={info}>{children}</StageContext.Provider>
      </div>
    </div>
  );
}
