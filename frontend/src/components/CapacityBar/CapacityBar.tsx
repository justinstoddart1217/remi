import clsx from 'clsx';
import type { CSSProperties } from 'react';

import { isBauItem } from '../shared/domain';
import type { DayLoad, Domain, LoadItem } from '../shared/domain';
import s from './CapacityBar.module.css';

/**
 * - `day` 14px (Today), `panel` 12px (Calendar day panel), `mini` 6px (Today week cards):
 *   notched BAU, soft project fill, outlined free, stacked left to right.
 * - `cell` 5px (Calendar month cells): solid BAU, soft project, outlined free.
 * - `strip` (Timeline): one vertical bar at 5px per hour, BAU at the bottom.
 * - `decor` (Home): one soft bar whose height is the day's total.
 */
export type CapacityVariant = 'day' | 'panel' | 'mini' | 'cell' | 'strip' | 'decor';

export interface CapacityBarProps {
  load: DayLoad;
  variant: CapacityVariant;
  /** False draws every segment at zero, so the first `true` grows them in (arrival). */
  arrived?: boolean;
  /** Width/height transition delay (Today day bar 90ms, week minis 160ms, Timeline i×2.5ms). */
  delay?: number;
  /** Overload pulse, one 600ms ring. Defaults to `load.over && arrived`. Off under reduced motion. */
  pulse?: boolean;
  /** Pulse delay in ms. Defaults: day 300, panel 200, mini 400, cell 300, strip 450. */
  pulseDelay?: number;
  /** Changing it replays the pulse (e.g. the day's ISO date), without remounting the segments. */
  pulseKey?: string;
  /** Mini BAU notches: per-hour cells like Today (default) or the Foundations repeating gradient. */
  notches?: 'cells' | 'gradient';
  /** The 8h capacity line, shown while over (default on for `day`). */
  marker?: boolean;
  /**
   * The linked highlight per item: true fades that segment to `--linked-dim` (0.28) over
   * --dur-fast (styled by `[data-dim]`). Prefer it to `itemOpacity`.
   */
  itemDimmed?: (item: LoadItem) => boolean;
  /** Linked-highlight opacity per item (1 when omitted), for a screen with its own dim value. */
  itemOpacity?: (item: LoadItem) => number;
  /** Dims the whole bar to `--linked-dim` (another day or item is hovered). */
  dimmed?: boolean;
  onItemEnter?: (item: LoadItem) => void;
  onItemLeave?: (item: LoadItem) => void;
  /** `strip` bar width in px (Timeline: clamp(3, column − 5, 30)). */
  width?: number;
  /** `decor` colour (defaults to the domain with the most hours). `decor` height scale (10h). */
  domain?: Domain;
  max?: number;
  className?: string;
  style?: CSSProperties;
  /** Accessible summary; a default one is built from the load. */
  label?: string;
}

const DEFAULT_PULSE_DELAY: Record<CapacityVariant, number> = {
  day: 300,
  panel: 200,
  mini: 400,
  cell: 300,
  strip: 450,
  decor: 0,
};

const GAP: Record<CapacityVariant, number> = { day: 2, panel: 2, mini: 1, cell: 1, strip: 1, decor: 0 };

interface Seg {
  key: string;
  kind: 'bau' | 'proj' | 'free';
  domain: Domain;
  h: number;
  item: LoadItem | null;
}

function summary(load: DayLoad): string {
  const over = load.over ? `, ${String(load.total - load.capacity)}h over` : `, ${String(load.free)}h free`;
  return `${String(load.total)}h of ${String(load.capacity)}h planned: ${String(load.bau)}h BAU, ${String(load.proj)}h project${over}`;
}

function majorityDomain(items: readonly LoadItem[]): Domain {
  let pc = 0;
  let fi = 0;
  for (const i of items) {
    if (i.domain === 'pc') pc += i.h;
    else fi += i.h;
  }
  return fi > pc ? 'fi' : 'pc';
}

function segments(load: DayLoad, variant: CapacityVariant): Seg[] {
  const toSeg = (item: LoadItem): Seg => ({
    key: `${item.refType}:${item.refId}`,
    kind: isBauItem(item) ? 'bau' : 'proj',
    domain: item.domain,
    h: item.h,
    item,
  });
  // Today and the Calendar panel stack BAU first; cells and strips keep the server's order.
  const ordered =
    variant === 'day' || variant === 'panel' || variant === 'mini'
      ? [...load.items.filter(isBauItem), ...load.items.filter((i) => !isBauItem(i))]
      : load.items;
  const out = ordered.map(toSeg);
  if (variant !== 'strip' && load.free > 0) {
    out.push({ key: 'free', kind: 'free', domain: 'pc', h: load.free, item: null });
  }
  return out;
}

/** The notched BAU gradient for a mini bar with `n` hour cells and a 1px gap. */
function miniNotches(n: number): string {
  const step = `calc(100% / ${String(n)})`;
  const cell = `calc(100% / ${String(n)} - 1px)`;
  return `repeating-linear-gradient(to right, var(--c) 0 ${cell}, transparent ${cell} ${step})`;
}

/**
 * One day's capacity, built by the prototype's shared segment builder: each segment's width is
 * `calc(h / max(total, capacity) × 100% − gap)`, so an overloaded day fills the bar and turns
 * every segment `--overload`. Segments keep their identity (keyed by ref) so a new load glides.
 */
export function CapacityBar({
  load,
  variant,
  arrived = true,
  delay,
  pulse,
  pulseDelay,
  pulseKey,
  notches = 'cells',
  marker = variant === 'day',
  itemDimmed,
  itemOpacity,
  dimmed = false,
  onItemEnter,
  onItemLeave,
  width,
  domain,
  max = 10,
  className,
  style,
  label,
}: CapacityBarProps) {
  const over = load.over;
  const cap = Math.max(load.total, load.capacity);
  const doPulse = (pulse ?? (over && arrived)) && over;
  const ring = doPulse ? (
    <span
      key={pulseKey ?? 'ring'}
      className={s.ring}
      style={{ animationDelay: `${String(pulseDelay ?? DEFAULT_PULSE_DELAY[variant])}ms` }}
      aria-hidden="true"
    />
  ) : null;
  const a11y = { role: 'img' as const, 'aria-label': label ?? summary(load), 'data-dim': dimmed ? '' : undefined };
  const segDim = (item: LoadItem | null) => (item && itemDimmed?.(item) ? '' : undefined);
  const hover = (item: LoadItem | null) =>
    item
      ? {
          onMouseEnter: onItemEnter
            ? () => {
                onItemEnter(item);
              }
            : undefined,
          onMouseLeave: onItemLeave
            ? () => {
                onItemLeave(item);
              }
            : undefined,
        }
      : {};

  if (variant === 'decor') {
    const d = domain ?? majorityDomain(load.items);
    return (
      <div
        {...a11y}
        className={clsx(s.decor, s[d], over && s.over, className)}
        style={{
          height: arrived ? `${String((load.total / max) * 100)}%` : '0%',
          transitionDelay: delay !== undefined ? `${String(delay)}ms, 0ms, 0ms` : undefined,
          ...style,
        }}
      />
    );
  }

  const segs = segments(load, variant);
  const gap = GAP[variant];

  if (variant === 'strip') {
    return (
      <div
        {...a11y}
        className={clsx(s.bar, s.strip, over && s.over, className)}
        style={{ width, ...style }}
      >
        {segs.map((g) => (
          <div
            key={g.key}
            className={clsx(s.vseg, s[g.kind], s[g.domain])}
            data-dim={segDim(g.item)}
            style={{
              height: arrived ? g.h * 5 : 0,
              opacity: g.item && itemOpacity ? itemOpacity(g.item) : undefined,
              transitionDelay: delay !== undefined ? `${String(delay)}ms, 0ms` : undefined,
            }}
            {...hover(g.item)}
          />
        ))}
        {ring}
      </div>
    );
  }

  const withCells = variant === 'day' || variant === 'panel' || (variant === 'mini' && notches === 'cells');
  return (
    <div {...a11y} className={clsx(s.bar, s[variant], over && s.over, className)} style={style}>
      {segs.map((g) => {
        const n = Math.ceil(g.h);
        const w = arrived ? `calc(${String((g.h / cap) * 100)}% - ${String(gap)}px)` : '0%';
        const segStyle: CSSProperties = {
          width: w,
          opacity: g.item && itemOpacity ? itemOpacity(g.item) : undefined,
          transitionDelay: delay !== undefined ? `${String(delay)}ms, 0ms` : undefined,
        };
        if (variant === 'mini' && notches === 'gradient' && g.kind === 'bau') {
          segStyle.background = miniNotches(n);
        }
        return (
          <div
            key={g.key}
            className={clsx(s.seg, s[g.kind], s[g.domain])}
            data-dim={segDim(g.item)}
            style={segStyle}
            {...hover(g.item)}
          >
            {withCells && g.kind === 'bau'
              ? Array.from({ length: n }, (_, k) => <div key={k} className={s.notch} />)
              : null}
          </div>
        );
      })}
      {marker && (
        <div
          className={s.marker}
          style={{ left: `${String((load.capacity / cap) * 100)}%`, opacity: over ? 1 : 0 }}
          aria-hidden="true"
        />
      )}
      {ring}
    </div>
  );
}
