import type { CSSProperties } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';

import { COPY, legendNote, placeFlagLabels } from './model';
import type { FlagPlace, StripModel } from './model';
import s from './Transition.module.css';

/** The design's flag row box (Transition.module.css .flags); taller only for extra label rows. */
const FLAGS_HEIGHT_PX = 44;
/** A label moved to another row sits just above its stick (the design's low row: 2px). */
const FLAG_LABEL_LIFT_PX = 2;

function samePlaces(a: readonly FlagPlace[] | null, b: readonly FlagPlace[]): boolean {
  return (
    a !== null &&
    a.length === b.length &&
    a.every((p, i) => {
      const q = b[i];
      return p.bottom === q?.bottom && p.end === q.end;
    })
  );
}

/**
 * The business-day strip (Transition.dc.html:30-56): one block per business day strictly between
 * today and the move, filled while a Private Credit exit is still running; flags above for each
 * PC forecast, the key run and the move (slots and label heights from `move.flags`); the months
 * below. Flags glide on `left` (440ms spring) when a forecast moves.
 *
 * The labels are measured after each layout and moved apart only where they would collide or
 * leave the strip (placeFlagLabels); a label moved to another row gets a stick that reaches it,
 * and the flag row grows by the rows it adds above the design's two.
 */
export function MoveStrip({ strip, region, style }: { strip: StripModel; region: string | null | undefined; style?: CSSProperties }) {
  const flagsRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLSpanElement>());
  const [places, setPlaces] = useState<FlagPlace[] | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = flagsRef.current;
    if (!el) return;
    const measure = () => {
      setWidth(el.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const next = placeFlagLabels(
      strip.flags.map((f) => {
        const label = labels.current.get(f.key);
        return {
          x: (parseFloat(f.x) / 100) * width,
          width: label?.offsetWidth ?? 0,
          height: label?.offsetHeight ?? 0,
          bottom: f.stickPx + f.liftPx,
          end: f.end,
        };
      }),
      width,
    );
    setPlaces((prev) => (samePlaces(prev, next) ? prev : next));
  }, [strip, width]);

  const extra = Math.max(0, ...(places ?? []).map((p) => p.bottom - FLAGS_HEIGHT_PX));

  return (
    <div className={s.arrive} style={style}>
      <div ref={flagsRef} className={s.flags} style={extra > 0 ? { marginTop: extra } : undefined}>
        {strip.flags.map((f, i) => {
          const place = places?.[i];
          const moved = place !== undefined && place.bottom !== f.stickPx + f.liftPx;
          const end = place?.end ?? f.end;
          return (
            <div key={f.key} className={s.flag} data-tone={f.tone} data-end={end ? '' : undefined} style={{ left: f.x }}>
              <span
                ref={(node) => {
                  if (node) labels.current.set(f.key, node);
                  else labels.current.delete(f.key);
                }}
                className={s.flagLabel}
                style={{ marginBottom: moved ? FLAG_LABEL_LIFT_PX : f.liftPx }}
              >
                {f.label}
              </span>
              <span className={s.stick} style={{ height: moved ? place.bottom - FLAG_LABEL_LIFT_PX : f.stickPx }} />
            </div>
          );
        })}
      </div>
      <div className={s.ticks}>
        {strip.ticks.map((t) => (
          <span key={t.iso} className={s.tick} data-running={t.running ? '' : undefined} title={t.title} />
        ))}
      </div>
      <div className={s.months}>
        {strip.months.map((m) => (
          <span key={m.key} className={s.month} style={{ left: m.x }}>
            {m.label}
          </span>
        ))}
      </div>
      <div className={s.stripLegend}>
        <span className={s.legendItem}>
          <span className={s.swatch} data-running="" />
          {COPY.legendRunning}
        </span>
        <span className={s.legendItem}>
          <span className={s.swatch} />
          {COPY.legendBuffer}
        </span>
        <span>{legendNote(region)}</span>
      </div>
    </div>
  );
}
