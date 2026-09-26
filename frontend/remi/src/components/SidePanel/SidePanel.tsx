import clsx from 'clsx';
import { useEffect, useState } from 'react';
import type { ReactNode, TransitionEvent } from 'react';

import s from './SidePanel.module.css';

export interface SidePanelProps<T> {
  /** What the panel shows; null closes it. The last item stays rendered through the exit. */
  item: T | null;
  children: (item: T) => ReactNode;
  /** 460px (Timeline project panel) or 440px (Calendar day panel). */
  width: number;
  /** Stacking: Timeline 12, Calendar 5. */
  zIndex?: number;
  /** Accessible name for the region. */
  label: string;
  /** Let the panel scroll (Calendar). */
  scroll?: boolean;
  className?: string;
  /** Called once the exit transition has finished and the content has unmounted. */
  onExited?: () => void;
}

/** Longest exit (--dur-slow 440ms) plus slack, in case `transitionend` never fires. */
const EXIT_FALLBACK_MS = 500;

/**
 * A right-hand sheet with no scrim (Timeline.dc.html:178, Calendar.dc.html:72): it slides from
 * translateX(104%) to 0 over 440ms --spring-soft while fading 240ms. The content stays mounted
 * until the exit finishes, so it never blanks mid-slide. Escape handling belongs to the
 * caller's overlay stack (only the topmost layer closes).
 */
export function SidePanel<T>({
  item,
  children,
  width,
  zIndex,
  label,
  scroll = false,
  className,
  onExited,
}: SidePanelProps<T>) {
  const [shown, setShown] = useState<T | null>(item);
  if (item !== null && item !== shown) setShown(item);
  const open = item !== null;

  // Fallback unmount if the transform transition is skipped (display:none ancestor, tests).
  useEffect(() => {
    if (open || shown === null) return;
    const t = setTimeout(() => {
      setShown(null);
      onExited?.();
    }, EXIT_FALLBACK_MS);
    return () => {
      clearTimeout(t);
    };
  }, [open, shown, onExited]);

  const onTransitionEnd = (e: TransitionEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || e.propertyName !== 'transform' || open) return;
    setShown(null);
    onExited?.();
  };

  return (
    <aside
      aria-label={label}
      aria-hidden={!open}
      inert={!open}
      data-open={open}
      className={clsx(s.panel, scroll && s.scroll, className)}
      style={{ width, zIndex }}
      onTransitionEnd={onTransitionEnd}
    >
      {shown !== null ? children(shown) : null}
    </aside>
  );
}
