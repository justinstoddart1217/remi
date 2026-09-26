import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import { dayQuery, useDay } from '../../api';
import type { DayLoadOut, PlanOut } from '../../api';
import { Button, CapacityBar, Eyebrow, IconButton, MilestoneDiamond, SidePanel } from '../../components';
import type { LoadItem } from '../../components/shared/domain';
import { useIsActiveScreen } from '../../lib/arrival';
import type { CalendarIndex, IsoDate } from '../../lib/calendar';
import { hoverHandlers, isDimmed, useHover } from '../../stores/hover';
import { useOverlayLayer } from '../../stores/overlays';
import s from './Calendar.module.css';
import {
  capacityLabel,
  dayFacts,
  dayFactsFromDay,
  dueItems,
  emptyCopy,
  itemHoverKey,
  kicker,
  panelSub,
  panelTitle,
  planRows,
  stepBusinessDay,
} from './model';
import type { Loads, PlanRowModel } from './model';
import { useScreenDimmed, useScreenHoverKey } from '../linkedHover';

/** The Calendar day panel's layer in the Escape order (stores/overlays). */
export const PANEL_LAYER = 'calendar-panel';

const DOMAIN_TONE = { pc: 'pc', fi: 'fi' } as const;

/**
 * The prototype's 30px panel buttons keep the browser's default button padding (1px 6px), so
 * their 18px and 20px glyphs overflow the content box and Chrome aligns them to its start: the
 * glyph sits 1px right of centre. Kept for pixel parity.
 */
const PANEL_BUTTON_PADDING = { padding: '1px 6px' } as const;

export interface DayPanelProps {
  sel: IsoDate | null;
  plan: PlanOut;
  index: CalendarIndex | undefined;
  /** Loads for the month on screen (the plan's, or `GET /loads` outside the plan window). */
  loads: Loads | undefined;
  onClose: () => void;
  onStep: (iso: IsoDate) => void;
  onOpenDay: (iso: IsoDate) => void;
  onOpenProject: (projectId: string) => void;
}

/**
 * The 440px day panel (Calendar.dc.html:72-122): no scrim, slides in on the spring. It keeps
 * its content through the exit (the prototype blanked it at once), and Escape closes it when
 * it is the topmost layer and the Calendar is on screen.
 */
export function DayPanel({ sel, plan, index, loads, onClose, onStep, onOpenDay, onOpenProject }: DayPanelProps) {
  const active = useIsActiveScreen();
  useOverlayLayer(PANEL_LAYER, sel !== null && active, onClose);
  return (
    <SidePanel item={sel} width={440} zIndex={5} label="Day plan" scroll>
      {(iso) => (
        <PanelContent
          iso={iso}
          plan={plan}
          index={index}
          loads={loads}
          onClose={onClose}
          onStep={onStep}
          onOpenDay={onOpenDay}
          onOpenProject={onOpenProject}
        />
      )}
    </SidePanel>
  );
}

function PanelContent({
  iso,
  plan,
  index,
  loads,
  onClose,
  onStep,
  onOpenDay,
  onOpenProject,
}: Omit<DayPanelProps, 'sel'> & { iso: IsoDate }) {
  const today = plan.today.iso;
  const move = plan.settings.moveDate ?? plan.move.date;
  const indexed = dayFacts(index, iso);
  const knownLoad: DayLoadOut | null = loads?.[iso] ?? plan.loads[iso] ?? null;

  // GET /day/{iso}: the task allocation from today on, and the day itself when no fetched
  // calendar range covers it.
  const needDay = indexed === null || (indexed.bd && (iso >= today || knownLoad === null));
  const dayRead = useDay(needDay ? iso : null);
  const day = dayRead.data?.day === iso ? dayRead.data : null;

  const facts = indexed ?? (day ? dayFactsFromDay(day) : null);
  const ahead = index?.bdDiff(today, iso) ?? day?.aheadBd ?? null;
  const load = facts?.bd ? (knownLoad ?? day?.load ?? null) : null;
  const showTasks = facts?.bd === true && iso >= today;

  const prev = stepBusinessDay(index, iso, -1);
  const next = stepBusinessDay(index, iso, 1);
  usePrefetchDays(prev, next, today);

  const rows = load ? planRows(load, { projects: plan.projects, routines: plan.routines, day, showTasks }) : [];
  const due = dueItems(iso, plan.projects, move);
  const empty = facts ? emptyCopy(facts, load) : null;

  return (
    <>
      <div className={s.panelTop}>
        <Eyebrow as="span">{facts ? kicker(facts, today, ahead, plan.calendar.region) : ''}</Eyebrow>
        <div className={s.spacer} />
        <IconButton
          icon="chevron_left"
          label="Previous day"
          variant="raised"
          size={30}
          iconSize={18}
          style={PANEL_BUTTON_PADDING}
          onClick={() => {
            if (prev) onStep(prev);
          }}
        />
        <IconButton
          icon="chevron_right"
          label="Next day"
          variant="raised"
          size={30}
          iconSize={18}
          style={PANEL_BUTTON_PADDING}
          onClick={() => {
            if (next) onStep(next);
          }}
        />
        <IconButton
          icon="close"
          label="Close"
          variant="plain"
          size={30}
          iconSize={20}
          style={PANEL_BUTTON_PADDING}
          onClick={onClose}
        />
      </div>
      <h2 className={s.panelTitle}>{panelTitle(iso)}</h2>
      <div className={s.panelSub}>{facts ? panelSub(facts, move) : ''}</div>

      {load && (
        <>
          <div className={s.capacity}>
            <div className={s.capacityHead}>
              <Eyebrow as="span">Capacity</Eyebrow>
              <span className={s.capacityValue} data-over={load.over}>
                {capacityLabel(load)}
              </span>
            </div>
            <PanelCapacity load={load} iso={iso} />
          </div>
          {/* Always drawn with a load, as Calendar.dc.html:95: a free day keeps the brand-deep rule. */}
          <div className={s.rows}>
            {rows.map((r) => (
              <PlanRow key={r.key} row={r} onOpenProject={onOpenProject} />
            ))}
          </div>
        </>
      )}

      {due.length > 0 && (
        <div className={s.due}>
          <Eyebrow>Due this day</Eyebrow>
          <ul className={s.dueList}>
            {due.map((x) => (
              <li key={x.key} className={s.dueItem}>
                <MilestoneDiamond size={8} color={x.color} passed={x.filled} />
                <span>{x.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {empty && <p className={s.empty}>{empty}</p>}
      <div className={s.panelSpacer} />
      {facts?.bd && iso >= today && (
        <Button
          variant="primary"
          size="l"
          className={s.cta}
          onClick={() => {
            onOpenDay(iso);
          }}
        >
          Open the day’s plan in Today
        </Button>
      )}
    </>
  );
}

/** Warms `GET /day` for the neighbouring business days, so stepping shows their tasks at once. */
function usePrefetchDays(prev: IsoDate | null, next: IsoDate | null, today: string): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    for (const iso of [prev, next]) {
      if (iso && iso >= today) queryClient.query(dayQuery(iso)).catch(() => undefined);
    }
  }, [queryClient, prev, next, today]);
}

/**
 * The 12px capacity bar (Calendar.dc.html:87-93): per-hour BAU ticks, soft project fills and
 * the outlined free hours; red and pulsing once (200ms) when the day is over. Segments light
 * up their routine or project on hover; the free segment does nothing.
 */
function PanelCapacity({ load, iso }: { load: DayLoadOut; iso: string }) {
  const hovered = useScreenHoverKey();
  const itemDimmed = useCallback((item: LoadItem) => isDimmed(hovered, itemHoverKey(item)), [hovered]);
  const onEnter = useCallback((item: LoadItem) => {
    useHover.getState().set(itemHoverKey(item));
  }, []);
  const onLeave = useCallback(() => {
    useHover.getState().clear();
  }, []);
  return (
    <CapacityBar
      load={load}
      variant="panel"
      pulse={load.over}
      pulseKey={iso}
      itemDimmed={itemDimmed}
      onItemEnter={onEnter}
      onItemLeave={onLeave}
    />
  );
}

/**
 * One plan row: hours, 'PROJECT · PRIVATE CREDIT', the name and the day's tasks. Project rows
 * open the workspace; BAU rows are not clickable (crit :203).
 */
function PlanRow({ row, onOpenProject }: { row: PlanRowModel; onOpenProject: (projectId: string) => void }) {
  const dim = useScreenDimmed(row.hover);
  const body = (
    <>
      <span className={s.rowHours}>{row.hours}</span>
      <span className={s.rowBody}>
        <Eyebrow as="span" tone={DOMAIN_TONE[row.domain]} className={s.rowKind}>
          {row.kind}
        </Eyebrow>
        <span className={s.rowName}>{row.name}</span>
        {row.tasks.map((t) => (
          <span key={t.key} className={s.task}>
            <span>{t.text}</span>
            <span className={s.taskHours}>{t.hours}</span>
          </span>
        ))}
      </span>
    </>
  );
  const common = { className: s.row, 'data-dim': dim, ...hoverHandlers(row.hover) };
  const projectId = row.projectId;
  if (projectId === null) return <div {...common}>{body}</div>;
  return (
    <button
      type="button"
      {...common}
      onClick={() => {
        onOpenProject(projectId);
      }}
    >
      {body}
    </button>
  );
}
