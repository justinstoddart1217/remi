import clsx from 'clsx';

import s from './ProgressRule.module.css';

export interface ProgressRuleProps {
  /** 0–1. */
  value: number;
  /** Track height: 2px (Today funds, month minis, drawer), 3px, or 4px (Transition readiness). */
  height?: 2 | 3 | 4;
  /** `brand`: the --brand-deep fill (`ink` is the same fill under its pre-redesign name). */
  tone?: 'pc' | 'fi' | 'brand' | 'ink';
  /**
   * `spring` (default): width glides 440ms --spring-soft. `thinking`: the drawer's 0 → 88% over
   * 2600ms cubic-bezier(0.2, 0.7, 0.3, 1).
   */
  motion?: 'spring' | 'thinking';
  /** Accessible name; the rule is decorative without one. */
  label?: string;
  className?: string;
}

/** A hairline track with an accent or --brand-deep fill. */
export function ProgressRule({ value, height = 2, tone = 'pc', motion = 'spring', label, className }: ProgressRuleProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const a11y = label
    ? { role: 'progressbar' as const, 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct) }
    : { 'aria-hidden': true as const };
  return (
    <div {...a11y} className={clsx(s.track, className)} style={{ height }}>
      <div className={clsx(s.fill, s[tone], s[motion])} style={{ width: `${String(pct)}%` }} />
    </div>
  );
}
