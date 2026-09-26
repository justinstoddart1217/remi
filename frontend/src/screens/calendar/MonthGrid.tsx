import { memo } from 'react';
import type { KeyboardEvent } from 'react';

import { BauChip, CapacityBar, MilestoneDiamond } from '../../components';
import { formatHours } from '../../components';
import type { IsoDate } from '../../lib/calendar';
import { hoverHandlers } from '../../stores/hover';
import s from './Calendar.module.css';
import type { BarModel, CellModel, ChipModel, MarkModel } from './model';
import { cellLabel, moveFocus, rovingFocus } from './model';
import { useScreenDimmed } from '../linkedHover';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Mon–Fri in ink-muted, Sat/Sun in ink-faint, over a 1px ink rule (Calendar.dc.html:32-36). */
export function WeekdayHeads() {
  return (
    <div className={s.heads}>
      {WEEKDAYS.map((label, k) => (
        <div key={label} className={s.headCell} data-weekend={k > 4}>
          {label}
        </div>
      ))}
    </div>
  );
}

interface GridProps {
  cells: readonly CellModel[];
  sel: IsoDate | null;
  fading: boolean;
  /** Grid transform while fading (none under reduced motion). */
  shift: string;
  onPick: (iso: IsoDate) => void;
}

/**
 * The month grid (Calendar.dc.html:38-70). Cells are keyed by position, as the prototype's
 * sc-for, so a month change reuses them; the meters' pulse is keyed by date so it replays on
 * an overloaded day when it first appears.
 *
 * Keyboard: one in-month day is in the tab order (the selected day, else today, else the 1st);
 * the arrow keys move between days (±1 day, ±1 week), Home/End to the week's ends, and Enter
 * or Space opens or closes the day, as a click does.
 */
export const MonthGrid = memo(function MonthGrid({ cells, sel, fading, shift, onPick }: GridProps) {
  const focusIso = rovingFocus(cells, sel);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const from = (e.target as HTMLElement).closest<HTMLElement>('[data-idx]');
    if (!from) return;
    const k = Number(from.dataset.idx);
    const cell = cells[k];
    if (!cell) return;
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.target !== from || !cell.inMonth) return;
      e.preventDefault();
      onPick(cell.iso);
      return;
    }
    const to = moveFocus(cells, k, e.key);
    if (to === null) return;
    e.preventDefault();
    e.currentTarget.querySelector<HTMLElement>(`[data-idx="${String(to)}"]`)?.focus();
  };
  return (
    <div className={s.grid} data-fading={fading} style={{ transform: shift }} onKeyDown={onKeyDown}>
      {cells.map((c, k) => (
        <DayCell key={k} idx={k} cell={c} selected={c.iso === sel} tabbable={c.iso === focusIso} onPick={onPick} />
      ))}
    </div>
  );
});

const DayCell = memo(function DayCell({
  idx,
  cell,
  selected,
  tabbable,
  onPick,
}: {
  idx: number;
  cell: CellModel;
  selected: boolean;
  tabbable: boolean;
  onPick: (iso: IsoDate) => void;
}) {
  const pick = cell.inMonth
    ? () => {
        onPick(cell.iso);
      }
    : undefined;
  return (
    <div
      className={s.cell}
      data-in-month={cell.inMonth}
      data-sunday={cell.sunday}
      data-tinted={cell.tinted}
      data-selected={selected}
      data-iso={cell.iso}
      data-idx={idx}
      onClick={pick}
      {...(cell.inMonth
        ? { role: 'button', tabIndex: tabbable ? 0 : -1, 'aria-pressed': selected, 'aria-label': cellLabel(cell) }
        : { 'aria-hidden': true })}
    >
      <div className={s.cellTop}>
        <span className={s.dayNum} data-weekend={cell.weekend} data-today={cell.isToday}>
          {cell.dayOfMonth}
        </span>
        <span className={s.bdLabel}>{cell.bd}</span>
      </div>
      {cell.holiday && <span className={s.holiday}>{cell.holiday}</span>}
      {cell.chips.map((ch) => (
        <Chip key={ch.key} chip={ch} />
      ))}
      {cell.marks.map((m) => (
        <Mark key={m.key} mark={m} />
      ))}
      {(cell.bars.length > 0 || cell.load) && (
        <div className={s.foot}>
          {cell.bars.map((b) => (
            <Bar key={b.key} bar={b} />
          ))}
          {cell.load && (
            <div className={s.meterRow}>
              <CapacityBar load={cell.load} variant="cell" pulse={cell.load.over} pulseKey={cell.iso} />
              <span className={s.meterLabel} data-over={cell.load.over}>
                {formatHours(cell.load.total)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

/** A BAU chip: 'Returns · 6h'. Hover lights up its routine (or the rotation) everywhere. */
function Chip({ chip }: { chip: ChipModel }) {
  const dim = useScreenDimmed(chip.hover);
  return (
    <BauChip domain={chip.domain} className={s.chip} dimmed={dim} {...hoverHandlers(chip.hover)}>
      {chip.label}
    </BauChip>
  );
}

/** A milestone or forecast-end line: a 7px diamond and the name. */
function Mark({ mark }: { mark: MarkModel }) {
  const dim = useScreenDimmed(mark.hover);
  return (
    <span className={s.mark} data-dim={dim} {...hoverHandlers(mark.hover)}>
      <MilestoneDiamond size={7} color={mark.color} passed={mark.filled} />
      <span className={s.markName}>{mark.name}</span>
    </span>
  );
}

/** A project's hours: a 4px bar (h / capacity × 62%) and '{short} {h}h', titled with the full name. */
function Bar({ bar }: { bar: BarModel }) {
  const dim = useScreenDimmed(bar.hover);
  return (
    <div className={s.barRow} title={bar.title} data-dim={dim} {...hoverHandlers(bar.hover)}>
      <span className={s.bar} style={{ width: `${String(bar.width)}%`, background: bar.color }} />
      <span className={s.barLabel}>{bar.label}</span>
    </div>
  );
}
