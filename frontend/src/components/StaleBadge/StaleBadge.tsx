import clsx from 'clsx';

import s from './StaleBadge.module.css';

export interface StaleBadgeProps {
  /** Calendar days since the last check-in. */
  days: number;
  /** The hollow dot (Projects rows). The Foundations specimen draws it without. */
  dot?: boolean;
  /**
   * One text run instead of three items: the Foundations specimen's static 'Stale · 9 days'
   * (Remi Foundations.dc.html:262), where the gap only follows the dot.
   */
  joined?: boolean;
  className?: string;
}

/**
 * 'Stale · 9 days': an inset risk ring (45% into paper), risk 45% into ink text. The words are
 * three flex items, as the prototype's interpolation lays them out (Projects.dc.html:36), so the
 * badge's 6px gap sits on both sides of the number.
 */
export function StaleBadge({ days, dot = true, joined = false, className }: StaleBadgeProps) {
  return (
    <span className={clsx(s.badge, className)}>
      {dot && <span className={s.dot} aria-hidden="true" />}
      {joined ? (
        `Stale · ${String(days)} days`
      ) : (
        // The spaces between the items are not laid out (whitespace between flex items is
        // dropped); they keep the text 'Stale · 9 days' for assistive tech and copy.
        <>
          <span>Stale ·</span> <span>{days}</span> <span>days</span>
        </>
      )}
    </span>
  );
}
