import clsx from 'clsx';
import type { CSSProperties } from 'react';

import { Checkbox, Icon, Roll } from '../../components';
import { hoverHandlers, hoverKey, ROTATION_KEY } from '../../stores/hover';
import type { HoverKey } from '../../stores/hover';
import {
  asDomain,
  bauRowRule,
  checklistUnit,
  DOMAIN_LABEL,
  FOCUS_EMPTY,
  hrs,
  milestoneLine,
  runCardNote,
  runCardRule,
  taskKey,
  tickKey,
} from './model';
import type { BauRowOut, FocusBlockOut, ProjectOut, RoutineOut } from './types';
import s from './Today.module.css';
import { useScreenDimmed } from '../linkedHover';

/**
 * The linked highlight: one dim value everywhere (`--linked-dim`, Foundations 0.28), set by
 * `[data-dim='true']` (styles/motion.css). The prototype's Today used 0.3 here.
 */
function useRowDim(own: HoverKey): 'true' | undefined {
  return useScreenDimmed(own) ? 'true' : undefined;
}

export interface PlanActions {
  /** The shown done state (server value, or an optimistic tick in flight). */
  done: (key: string, server: boolean) => boolean;
  tick: (row: BauRowOut, itemId: string, next: boolean) => void;
  toggleTask: (taskId: string, next: boolean) => void;
  openRoutine: (row: BauRowOut) => void;
  openProject: (projectId: string) => void;
}

// ---------------------------------------------------------------------------------------------
// BAU: the checklist run card (Today.dc.html:61-91)

function RunCard({
  row,
  routine,
  isToday,
  aheadBd,
  actions,
}: {
  row: BauRowOut;
  routine: RoutineOut | undefined;
  isToday: boolean;
  aheadBd: number;
  actions: PlanActions;
}) {
  const routineId = row.routineId ?? '';
  const iso = row.run?.occurrenceDate ?? '';
  const own = hoverKey('routine', routineId);
  const dim = useRowDim(own);
  const domain = asDomain(row.domain);
  const items = row.checklist.map((i) => ({ ...i, done: actions.done(tickKey(routineId, iso, i.id), i.done) }));
  const done = items.filter((i) => i.done).length;
  const n = items.length;
  const note = runCardNote(aheadBd, isToday, row.editable);
  return (
    <div className={s.row} data-dim={dim} {...hoverHandlers(own)}>
      <div className={s.gutter}>{hrs(row.hours)}</div>
      <div className={s.body}>
        <div className={s.line1} data-wrap="">
          <span className={s.kind} data-domain={domain}>
            BAU · {DOMAIN_LABEL[domain]}
          </span>
          {routine && <span className={s.mono12}>{runCardRule(routine.rule)}</span>}
          {note && <span className={s.note}>{note}</span>}
          <span className={s.spacer} />
          <button
            type="button"
            className={s.link}
            onClick={() => {
              actions.openRoutine(row);
            }}
          >
            Routine <Icon name="north_east" className={s.linkIcon} />
          </button>
        </div>
        <div className={s.line2}>
          <span className={s.name}>{row.name}</span>
          <span className={s.runCount}>
            <span className={s.runRoll}>
              <Roll value={String(done)} />
            </span>
            <span className={s.runOf}>
              of {n} {checklistUnit(routine?.detail, n)}
            </span>
          </span>
        </div>
        <div className={s.track}>
          <div className={s.trackFill} data-domain={domain} style={{ width: `${String(n ? (done / n) * 100 : 0)}%` }} />
        </div>
        <div className={s.items}>
          {items.map((i) => (
            <Checkbox
              key={i.id}
              checked={i.done}
              size={18}
              className={s.item}
              labelClassName={s.itemLabel}
              aria-disabled={row.editable ? undefined : true}
              onChange={
                row.editable
                  ? (next) => {
                      actions.tick(row, i.id, next);
                    }
                  : undefined
              }
            >
              {i.label}
            </Checkbox>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Other BAU rows: routines without a checklist, and the FI rotation after the move (:93-101)

function BauRow({ row, routine, actions }: { row: BauRowOut; routine: RoutineOut | undefined; actions: PlanActions }) {
  const own = row.kind === 'rotation' ? ROTATION_KEY : hoverKey('routine', row.routineId ?? '');
  const dim = useRowDim(own);
  const domain = asDomain(row.domain);
  return (
    <div className={s.row} data-dim={dim} {...hoverHandlers(own)}>
      <div className={s.gutter}>{hrs(row.hours)}</div>
      <div className={s.body}>
        <div className={s.line1}>
          <span className={s.kind} data-domain={domain}>
            BAU · {DOMAIN_LABEL[domain]}
          </span>
          <span className={s.mono12}>{bauRowRule(routine?.rule ?? null, row.stage ?? null, row.hours)}</span>
        </div>
        <div className={s.line2}>
          <span className={s.name}>{row.name}</span>
          <button
            type="button"
            className={s.link}
            onClick={() => {
              actions.openRoutine(row);
            }}
          >
            Routine <Icon name="north_east" className={s.linkIcon} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// A quiet row: "0h" in the gutter and one line of copy (No BAU, no focus blocks, a day off)

export function QuietRow({ text }: { text: string }) {
  return (
    <div className={s.row}>
      <div className={s.gutter} data-faint="">
        0h
      </div>
      <div className={s.noBau}>{text}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Focus blocks (:109-138)

function FocusBlock({
  block,
  project,
  actions,
}: {
  block: FocusBlockOut;
  project: ProjectOut | undefined;
  actions: PlanActions;
}) {
  const own = hoverKey('project', block.projectId);
  const dim = useRowDim(own);
  const domain = asDomain(project?.domain ?? 'pc');
  const empty = block.tasks.length === 0 ? FOCUS_EMPTY[block.emptyReason ?? 'no_tasks'] : null;
  const ms = milestoneLine(block.nextMilestone);
  return (
    <div className={s.row} data-dim={dim} {...hoverHandlers(own)}>
      <div className={s.gutter}>{hrs(block.hours)}</div>
      <div className={s.body}>
        <div className={s.line1}>
          <span className={s.kind} data-domain={domain}>
            Project · {DOMAIN_LABEL[domain]}
          </span>
          <span className={s.mono12}>Focus block</span>
        </div>
        <div className={s.line2}>
          <span className={s.name}>{project?.name ?? block.projectId}</span>
          <button
            type="button"
            className={s.link}
            onClick={() => {
              actions.openProject(block.projectId);
            }}
          >
            Workspace <Icon name="north_east" className={s.linkIcon} />
          </button>
        </div>
        <p className={s.goal}>{project?.goal ?? ''}</p>
        {empty && <div className={s.noTasks}>{empty}</div>}
        {block.tasks.map((t) => {
          const done = actions.done(taskKey(t.id), t.done);
          return (
            <Checkbox
              key={t.id}
              checked={done}
              size={18}
              className={s.task}
              labelClassName={s.taskLabel}
              onChange={(next) => {
                actions.toggleTask(t.id, next);
              }}
              trailing={<span className={s.taskHours}>{hrs(t.hours)}</span>}
            >
              {t.text || 'Untitled task'}
            </Checkbox>
          );
        })}
        {ms && (
          <div className={s.milestone}>
            <span className={s.diamond} data-domain={domain} aria-hidden="true" />
            <span>{ms}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export interface PlanListProps {
  title: string;
  note: string;
  bauRows: readonly BauRowOut[];
  focusBlocks: readonly FocusBlockOut[];
  /** Replaces the rows on a weekend or holiday. */
  dayOff: string | null;
  /** 'No BAU on this day. …' when the day has no BAU rows. */
  noBau: string;
  noFocus: string;
  isToday: boolean;
  aheadBd: number;
  routines: readonly RoutineOut[];
  projects: readonly ProjectOut[];
  actions: PlanActions;
  style?: CSSProperties;
}

/** Today.dc.html:55-139: BAU first (the checklist run, other BAU or none), then focus blocks. */
export function PlanList({
  title,
  note,
  bauRows,
  focusBlocks,
  dayOff,
  noBau,
  noFocus,
  isToday,
  aheadBd,
  routines,
  projects,
  actions,
  style,
}: PlanListProps) {
  const routine = (id: string | null | undefined) => (id ? routines.find((r) => r.id === id) : undefined);
  const project = (id: string) => projects.find((p) => p.id === id);
  return (
    <div className={clsx(s.plan, s.arrive)} style={style}>
      <div className={s.sectionHead}>
        <span className={s.sectionTitle}>{title}</span>
        <span className={s.sectionNote}>{note}</span>
      </div>
      {dayOff ? (
        <QuietRow text={dayOff} />
      ) : (
        <>
          {bauRows.map((row) =>
            row.kind === 'routine' && row.checklist.length > 0 ? (
              <RunCard
                key={`run:${row.routineId ?? ''}`}
                row={row}
                routine={routine(row.routineId)}
                isToday={isToday}
                aheadBd={aheadBd}
                actions={actions}
              />
            ) : (
              <BauRow
                key={`${row.kind}:${row.routineId ?? row.rotation?.segmentId ?? row.name}`}
                row={row}
                routine={routine(row.routineId)}
                actions={actions}
              />
            ),
          )}
          {bauRows.length === 0 && <QuietRow text={noBau} />}
          {focusBlocks.map((b) => (
            <FocusBlock key={b.projectId} block={b} project={project(b.projectId)} actions={actions} />
          ))}
          {focusBlocks.length === 0 && <QuietRow text={noFocus} />}
        </>
      )}
    </div>
  );
}
