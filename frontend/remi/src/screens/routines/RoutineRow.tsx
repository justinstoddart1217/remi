import { memo, useState } from 'react';
import type { CSSProperties } from 'react';

import type { ProjectOut, RoutineOut, Schemas } from '../../api';
import {
  BdStepper,
  HandoverStepper,
  InlineField,
  SegmentedControl,
  TextLink,
  TwoStepConfirmButton,
  WeekdayPicker,
} from '../../components';
import { hoverHandlers, hoverKey } from '../../stores/hover';
import { COPY, effortWidth, KIND_OPTIONS, monthlyEffort, nextMessage, nextRun, projectLink, ruleLine, STAGES } from './model';
import type { RoutineKind, RoutineStage } from './model';
import { RoutineChecklist } from './RoutineChecklist';
import s from './Routines.module.css';
import { useScreenDimmed } from '../linkedHover';

export type RoutinePatch = Schemas['RoutinePatch'];

export interface RoutineActions {
  /** PATCH the routine; the promise settles once the new plan has landed (rejects on failure). */
  update: (routineId: string, patch: RoutinePatch) => Promise<unknown>;
  remove: (routineId: string) => void;
  openProject: (projectId: string) => void;
  addItem: (routineId: string, label: string) => Promise<unknown>;
  renameItem: (itemId: string, label: string) => Promise<unknown>;
  removeItem: (itemId: string) => Promise<unknown>;
}

export interface RoutineRowProps {
  routine: RoutineOut;
  project: ProjectOut | null;
  /** Hours per run are clamped to the day's capacity. */
  capacity: number;
  /** The row flashes the accent tint (a new routine, or a deep link). */
  fresh: boolean;
  actions: RoutineActions;
  style?: CSSProperties;
}

/** The rule and stage fields that change on a click: shown at once, until the plan lands. */
type Instant = Pick<RoutinePatch, 'kind' | 'bd' | 'weekday' | 'stage'>;

/**
 * One Private Credit routine (Routines.dc.html:25-88): name and rule, effort, the next three
 * runs and the handover. The checklist (decision 10) opens from a quiet control at the end of
 * the rule line, in the Charter list language.
 */
export const RoutineRow = memo(function RoutineRow({ routine: r, project, capacity, fresh, actions, style }: RoutineRowProps) {
  const own = hoverKey('routine', r.id);
  const dimmed = useScreenDimmed(own);
  const [hoursDraft, setHoursDraft] = useState<string | undefined>(undefined);
  const [instant, setInstant] = useState<Instant>({});

  const rule = { kind: instant.kind ?? r.rule.kind, bd: instant.bd ?? r.rule.bd, weekday: instant.weekday ?? r.rule.weekday };
  const stage: RoutineStage = instant.stage ?? r.stage;
  const next = r.derived.next.map(nextRun);
  const message = nextMessage(stage, next);
  const link = projectLink(project);
  const hoursText = hoursDraft ?? String(r.hours);

  const update = (patch: RoutinePatch) => actions.update(r.id, patch);

  /** A click control: show the new value now, drop it once the request settles. */
  const pick = (patch: Instant) => {
    setInstant((cur) => ({ ...cur, ...patch }));
    const clear = () => {
      // Drop the fields this click set, unless a later click has changed them since.
      setInstant((cur) => Object.fromEntries(Object.entries(cur).filter(([k, v]) => patch[k as keyof Instant] !== v)));
    };
    update(patch).then(clear, clear);
  };

  return (
    <div
      className={s.row}
      data-rid={r.id}
      data-fresh={fresh ? '' : undefined}
      data-dimmed={dimmed ? '' : undefined}
      style={style}
      {...hoverHandlers(own)}
    >
      <div className={s.cell}>
        <InlineField
          value={r.name}
          placeholder={COPY.namePlaceholder}
          aria-label="Routine name"
          data-fk={`name.${r.id}`}
          className={s.name}
          onCommit={(name) => update({ name })}
        />
        <div className={s.controls}>
          <SegmentedControl<RoutineKind>
            variant="compact"
            label="How often it runs"
            options={KIND_OPTIONS}
            value={rule.kind}
            onChange={(kind) => {
              pick({ kind });
            }}
          />
          {rule.kind === 'monthly' && (
            <BdStepper
              className={s.stepper}
              value={rule.bd}
              onChange={(bd) => {
                pick({ bd });
              }}
            />
          )}
          {rule.kind === 'weekly' && (
            <WeekdayPicker
              value={rule.weekday}
              onChange={(weekday) => {
                pick({ weekday });
              }}
            />
          )}
        </div>
        <RoutineChecklist routineId={r.id} ruleLine={ruleLine(rule, r.detail)} items={r.checklistItems} actions={actions} />
      </div>

      <div>
        <span className={s.effort}>
          <InlineField
            value={r.hours}
            numeric={{ max: capacity }}
            inputMode="decimal"
            aria-label="Hours per run"
            data-fk={`h.${r.id}`}
            className={s.hours}
            style={{ width: effortWidth(hoursText) }}
            onDraftChange={setHoursDraft}
            onCommit={(h: number) => update({ hours: h })}
          />
          <span className={s.unit}>h</span>
        </span>
        <div className={s.perRun}>{COPY.perRun}</div>
        <div className={s.monthly}>{monthlyEffort(r.rule.kind, r.derived)}</div>
      </div>

      <div className={s.next}>
        {next.map((n) => (
          <div key={n.iso} className={s.run} data-today={n.today ? '' : undefined}>
            <span className={s.tick} />
            <div className={s.runText}>
              <div className={s.runDate}>{n.date}</div>
              <div className={s.runNote}>{n.note}</div>
            </div>
          </div>
        ))}
        {message && <div className={s.nextMessage}>{message}</div>}
      </div>

      <div className={s.cell}>
        <HandoverStepper
          steps={STAGES}
          current={stage}
          onPick={(k) => {
            pick({ stage: k as RoutineStage });
          }}
        />
        <InlineField
          multiline
          cpl={44}
          value={r.statusNote}
          placeholder={COPY.notePlaceholder}
          aria-label="Handover note"
          data-fk={`note.${r.id}`}
          className={s.note}
          onCommit={(statusNote) => update({ statusNote })}
        />
        <div className={s.footer}>
          {link && project && (
            <TextLink
              onClick={() => {
                actions.openProject(project.id);
              }}
            >
              {link}
            </TextLink>
          )}
          <span className={s.spacer} />
          <TwoStepConfirmButton
            label={COPY.remove}
            armedLabel={COPY.removeArmed}
            tone="faint"
            size={12}
            onConfirm={() => {
              actions.remove(r.id);
            }}
          />
        </div>
      </div>
    </div>
  );
});
