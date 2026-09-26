import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

import type { ProjectOut } from '../../api';
import { DOMAIN_ACCENT, DOMAIN_SOFT, Roll } from '../../components';
import { dayNumber, isoFromDayNumber } from '../../lib/calendar';
import type { CalendarIndex } from '../../lib/calendar';
import { s as short } from '../../lib/format';
import { useFlash, useMoved } from '../../stores/planMoves';
import {
  asOfHint,
  buildStrip,
  crosshairTransform,
  hoverDay,
  hoverLabelInputs,
  labelTransform,
  packLabels,
  pct,
  positionFromPercent,
  snapRelease,
  stepStop,
} from './scrubber';
import type { Snap } from './scrubber';
import s from './Workspace.module.css';

interface HistoryProps {
  project: ProjectOut;
  today: string;
  cal: CalendarIndex;
  snaps: readonly Snap[];
  pos: number | null;
  onPos: (pos: number | null) => void;
}

/** The label layer before the bar has been measured (the prototype's first-paint fallback). */
const FALLBACK_BAR_WIDTH = 1400;

/**
 * The history scrubber (Workspace.dc.html:95-138, :435-493). Dragging the handle between the
 * check-in stops interpolates the plan bar, milestones and forecast; release snaps to the
 * nearest stop, and the last stop is the live plan. Hovering the bar shows packed labels and a
 * crosshair with the day's business-day number and planned hours.
 */
export function History({ project: p, today, cal, snaps, pos, onPos }: HistoryProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const [hover, setHover] = useState(false);
  const [hx, setHx] = useState<number | null>(null);
  const [barWidth, setBarWidth] = useState(FALLBACK_BAR_WIDTH);
  const flash = useFlash(p.id);
  const moved = useMoved(p.id);

  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setBarWidth(el.offsetWidth || FALLBACK_BAR_WIDTH);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  const startN = dayNumber(p.startDate);
  const targetN = dayNumber(p.targetDate);
  const todayN = dayNumber(today);
  const strip = buildStrip({ startN, targetN, todayN, snaps, pos });
  const { axis, interp, risk, xs } = strip;
  const accent = DOMAIN_ACCENT[p.domain];
  const inHistory = pos !== null;
  const last = snaps.length - 1;
  const canDrag = snaps.length > 1;
  const hoverOn = hover && !drag;

  const dateOf = (n: number) => {
    const iso = isoFromDayNumber(n);
    return short(cal.nextBD(iso) ?? iso);
  };
  const labelInputs = hoverLabelInputs({ startN, targetN, endName: p.endName, names: strip.names, interp });
  const labels = packLabels(labelInputs, axis, barWidth, dateOf);

  let cLabel = '';
  if (hoverOn && hx != null) {
    const n = hoverDay(axis, hx);
    const iso = isoFromDayNumber(n);
    const day = cal.day(iso);
    if (day) {
      const inside = n >= startN && interp.fNow != null && n <= interp.fNow;
      const hh = day.bd && inside ? (p.derived.dayHours[iso] ?? 0) : 0;
      const at = labelInputs.find((l) => l.n === n);
      cLabel =
        short(iso) +
        (day.bd ? ` · BD${String(day.bdm ?? '')}` : day.hol ? ` · ${day.hol}` : ' · weekend') +
        (hh ? ` · ${String(Math.round(hh * 10) / 10)}h planned` : '') +
        (at ? ` · ${at.name}` : '');
    }
  }

  const posFrom = (clientX: number) => {
    const el = trackRef.current;
    if (!el || xs.length < 2) return 0;
    const r = el.getBoundingClientRect();
    return positionFromPercent(xs, ((clientX - r.left) / r.width) * 100);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!canDrag) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(true);
    onPos(posFrom(e.clientX));
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag) onPos(posFrom(e.clientX));
  };
  const onUp = () => {
    if (!drag) return;
    setDrag(false);
    onPos(snapRelease(pos, snaps.length));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!canDrag) return;
    const next = stepStop(pos, snaps.length, e.key);
    if (next === undefined) return;
    e.preventDefault();
    onPos(next);
  };

  const nearDate = short(isoFromDayNumber(interp.near.date));
  const barBg =
    p.derived.status === 'define' ? `repeating-linear-gradient(135deg, ${DOMAIN_SOFT[p.domain]} 0 4px, transparent 4px 8px)` : accent;
  const ghostN = flash && moved?.fromForecast ? dayNumber(moved.fromForecast) : null;
  // The ghost keeps its last width after the flash, so its 400ms fade-out is seen.
  const [ghostKept, setGhostKept] = useState<number | null>(null);
  if (ghostN !== null && ghostN !== ghostKept) setGhostKept(ghostN);
  const ghostDrawN = ghostN ?? ghostKept;

  return (
    <div className={s.history}>
      <div className={s.asOfCol}>
        <div className={s.label}>Plan as of</div>
        <div className={s.asOf}>
          <span className={s.host}>
            <Roll value={nearDate} />
          </span>
        </div>
        <div className={s.asOfHint}>{asOfHint(inHistory, snaps.length)}</div>
        {inHistory ? (
          <button
            type="button"
            className={s.toNow}
            onClick={() => {
              onPos(null);
            }}
          >
            Back to now
          </button>
        ) : null}
      </div>

      <div className={s.stripCol}>
        <div
          ref={barRef}
          className={s.bar}
          onMouseEnter={(e) => {
            setBarWidth(e.currentTarget.offsetWidth || FALLBACK_BAR_WIDTH);
            setHover(true);
          }}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const v = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
            if (hx == null || Math.abs(v - hx) > 0.002) setHx(v);
          }}
          onMouseLeave={() => {
            setHover(false);
            setHx(null);
          }}
        >
          <div className={s.labels} data-on={hoverOn} aria-hidden="true">
            {labels.map((l, k) => (
              <div key={`${l.kind}:${l.name}:${String(k)}`}>
                <div
                  className={s.hoverLabel}
                  style={{ left: l.x, top: `${String(l.row * 17)}px`, transform: labelTransform(l.anchor) }}
                >
                  <span
                    className={s.labelMark}
                    style={{
                      transform: `rotate(${l.kind === 'ms' || l.kind === 'end' ? '45deg' : '0deg'})`,
                      borderRadius: l.kind === 'start' ? '50%' : '0',
                      background:
                        l.kind === 'end' ? (risk ? 'var(--risk)' : accent) : l.kind === 'ms' && l.n < todayN ? accent : 'var(--paper)',
                      borderColor: l.kind === 'tgt' ? 'var(--ink)' : l.kind === 'end' && risk ? 'var(--risk)' : accent,
                    }}
                  />
                  <span className={s.labelName}>{l.name}</span>
                  <span className={s.labelDate}>{l.date}</span>
                </div>
                <div className={s.stem} style={{ left: l.x, top: `${String(l.row * 17 + 16)}px` }} />
              </div>
            ))}
          </div>
          <div className={s.crossLine} style={{ left: `${((hx ?? 0) * 100).toFixed(3)}%`, opacity: cLabel ? 1 : 0 }} />
          <div
            className={s.crossChip}
            style={{ left: `${((hx ?? 0) * 100).toFixed(3)}%`, transform: crosshairTransform(hx ?? 0.5), opacity: cLabel ? 1 : 0 }}
            aria-hidden="true"
          >
            {cLabel}
          </div>
          <div className={s.planBar} style={{ left: strip.bar.x, width: strip.bar.w, background: barBg }} />
          <div className={s.overBar} style={{ left: strip.over.x, width: strip.over.w }} />
          <div
            className={s.ghostBar}
            data-flash={ghostN !== null}
            style={{
              left: strip.bar.x,
              width: ghostDrawN !== null ? `calc(${pct(axis, ghostDrawN + 1)} - ${strip.bar.x})` : '0px',
              borderColor: accent,
            }}
            aria-hidden="true"
          />
          {strip.milestones.map((m) => (
            <div
              key={m.name}
              title={m.name}
              className={s.msDiamond}
              style={{ left: m.x, opacity: m.o, background: m.past ? accent : 'var(--paper)', borderColor: accent }}
            />
          ))}
          <div
            className={s.endDiamond}
            style={{ left: strip.end.x, opacity: strip.end.on ? 1 : 0, background: risk ? 'var(--risk)' : accent }}
          />
          <div className={s.targetFlag} style={{ left: strip.target }}>
            <div className={s.targetStick} />
            <div className={s.targetTick} />
          </div>
          <div className={s.todayLine} style={{ left: strip.today }} />
        </div>

        <div
          ref={trackRef}
          className={s.track}
          data-cursor={canDrag ? (drag ? 'grabbing' : 'grab') : 'default'}
          role="slider"
          tabIndex={canDrag ? 0 : -1}
          aria-label="Plan history"
          aria-valuemin={0}
          aria-valuemax={last}
          aria-valuenow={interp.nearIndex}
          aria-valuetext={`Plan as of ${nearDate}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={onKey}
        >
          <div className={s.axisLine} />
          {strip.months.map((m) => (
            <div key={m.n} className={s.month} style={{ left: m.x }}>
              {m.label}
            </div>
          ))}
          {strip.stops.map((st, k) => (
            <div key={k} className={s.stop} data-near={st.near} style={{ left: st.x }} />
          ))}
          <div className={s.handle} data-drag={drag} style={{ left: strip.handle }} />
        </div>
      </div>
    </div>
  );
}
