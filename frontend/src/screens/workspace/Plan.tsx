import clsx from 'clsx';
import { useState } from 'react';
import type { MouseEvent } from 'react';

import {
  useCreateMilestone,
  useCreateTask,
  useDeleteMilestone,
  useDeleteTask,
  useUpdateMilestone,
  useUpdateProject,
  useUpdateTask,
} from '../../api';
import type { MilestoneOut, ProjectOut, TaskOut } from '../../api';
import { AddButton, Checkbox, DOMAIN_ACCENT, Icon, InlineField, SectionTitleRow } from '../../components';
import type { CalendarIndex } from '../../lib/calendar';
import { s as short } from '../../lib/format';
import { dueLabel, nowWindow, planNote } from './copy';
import { byOrder, horizons, msKey, NEW_NEXT_BD, NEW_NOW_BD, taskKey } from './model';
import type { PickerRequest } from './picker';
import type { Guard } from './types';
import s from './Workspace.module.css';

interface PlanProps {
  project: ProjectOut;
  today: string;
  cal: CalendarIndex;
  openPicker: (req: PickerRequest, trigger: HTMLElement) => void;
  /** Focus the field with this data-fk once it renders (a freshly added line). */
  requestFocus: (fk: string) => void;
  guard: Guard;
}

/**
 * The rolling-wave Plan (Workspace.dc.html:168-218): Now (milestones with tasks, the next two
 * weeks), Next (milestones only, 2-6 weeks) and Later (one line of intent). Every line edits in
 * place; a blank line removes itself; each date button opens the business-day picker.
 */
export function Plan({ project: p, today, cal, openPicker, requestFocus, guard }: PlanProps) {
  const createMilestone = useCreateMilestone();
  const update = useUpdateProject();
  const { now, next } = horizons(p.milestones);
  const nowEnd = cal.addBD(today, NEW_NOW_BD);
  const accent = DOMAIN_ACCENT[p.domain];

  const addMilestone = (horizon: 'now' | 'next') => {
    const due = cal.addBD(today, horizon === 'now' ? NEW_NOW_BD : NEW_NEXT_BD);
    guard(createMilestone.mutateAsync({ projectId: p.id, body: { horizon, name: '', dueDate: due } })).then(
      (out) => {
        requestFocus(msKey(out.entity.id));
      },
      () => undefined,
    );
  };

  return (
    <div className={s.plan}>
      <div>
        <SectionTitleRow title="Plan" note={planNote(p)} as="h2" />
        <div className={s.planCols}>
          <div className={s.planCol}>
            <div className={s.colHead}>
              <h3 className={s.colName}>Now</h3>
              <span className={s.colSub}>{nowWindow(today, nowEnd)}</span>
            </div>
            {now.map((m) => (
              <NowMilestone
                key={m.id}
                milestone={m}
                accent={accent}
                openPicker={openPicker}
                requestFocus={requestFocus}
                guard={guard}
              />
            ))}
            {now.length === 0 ? <div className={s.nowEmpty}>Nothing scheduled for the next two weeks yet.</div> : null}
            <AddButton
              size="m"
              className={s.addMilestone}
              onClick={() => {
                addMilestone('now');
              }}
            >
              Add milestone
            </AddButton>
          </div>

          <div className={s.planCol}>
            <div className={s.colHead}>
              <h3 className={s.colName}>Next</h3>
              <span className={s.colSub}>2–6 weeks · milestones only</span>
            </div>
            <div className={s.nextList}>
              {next.map((m) => (
                <NextMilestone key={m.id} milestone={m} accent={accent} openPicker={openPicker} guard={guard} />
              ))}
              <AddButton
                size="m"
                className={s.addNext}
                onClick={() => {
                  addMilestone('next');
                }}
              >
                Add milestone
              </AddButton>
            </div>
          </div>

          <div className={s.planCol}>
            <div className={s.colHead}>
              <h3 className={s.colName}>Later</h3>
              <span className={s.colSub}>one line of intent</span>
            </div>
            <InlineField
              multiline
              cpl={30}
              value={p.laterIntent}
              placeholder="Where does this end up?"
              aria-label="Later: where this ends up"
              data-fk="later"
              className={s.later}
              onCommit={(laterIntent) => guard(update.mutateAsync({ projectId: p.id, patch: { laterIntent } }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface MilestoneProps {
  milestone: MilestoneOut;
  accent: string;
  openPicker: (req: PickerRequest, trigger: HTMLElement) => void;
  guard: Guard;
}

/** The date button: 'Thu 15 Oct', or 'Set date' (critique :182). */
function DueButton({ milestone: m, openPicker, guard }: Omit<MilestoneProps, 'accent'>) {
  const update = useUpdateMilestone();
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    openPicker(
      {
        key: msKey(m.id),
        value: m.dueDate,
        label: `Date for ${m.name || 'the milestone'}`,
        onPick: (dueDate) => {
          if (dueDate !== m.dueDate) void guard(update.mutateAsync({ milestoneId: m.id, patch: { dueDate } }));
        },
      },
      e.currentTarget,
    );
  };
  return (
    <span className={s.dueWrap}>
      <button type="button" className={s.dueButton} title="Change date" aria-label={dueLabel(m)} onClick={onClick}>
        <Icon name="calendar_month" className={s.dueIcon} />
        {m.dueDate ? short(m.dueDate) : 'Set date'}
      </button>
    </span>
  );
}

function useMilestoneName(m: MilestoneOut, guard: Guard) {
  const update = useUpdateMilestone();
  const remove = useDeleteMilestone();
  return {
    onCommit: (name: string) => guard(update.mutateAsync({ milestoneId: m.id, patch: { name } })),
    onRemove: () => guard(remove.mutateAsync({ milestoneId: m.id })),
  };
}

function NowMilestone({
  milestone: m,
  accent,
  openPicker,
  requestFocus,
  guard,
}: MilestoneProps & { requestFocus: (fk: string) => void }) {
  const name = useMilestoneName(m, guard);
  const createTask = useCreateTask();
  const tasks = [...m.tasks].sort(byOrder);
  return (
    <div className={s.msBlock}>
      <div className={s.msRow}>
        <span className={s.diamond} style={{ borderColor: accent }} aria-hidden="true" />
        <InlineField
          value={m.name}
          placeholder="Milestone"
          aria-label="Milestone"
          data-fk={msKey(m.id)}
          className={s.msName}
          onCommit={name.onCommit}
          onRemove={name.onRemove}
        />
        <DueButton milestone={m} openPicker={openPicker} guard={guard} />
      </div>
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} guard={guard} />
      ))}
      <AddButton
        size="s"
        className={s.addTask}
        onClick={() => {
          guard(createTask.mutateAsync({ milestoneId: m.id, body: { text: '', hours: 1 } })).then(
            (out) => {
              requestFocus(taskKey(out.entity.id));
            },
            () => undefined,
          );
        }}
      >
        Add task
      </AddButton>
    </div>
  );
}

function TaskRow({ task: t, guard }: { task: TaskOut; guard: Guard }) {
  const update = useUpdateTask();
  const remove = useDeleteTask();
  // The tick shows at once; the server's answer (or a failure) replaces it.
  const [tick, setTick] = useState<{ base: boolean; done: boolean } | null>(null);
  if (tick && tick.base !== t.done) setTick(null);
  const done = tick?.done ?? t.done;
  return (
    <div className={s.task}>
      <Checkbox
        size={15}
        checked={done}
        aria-label={`Done: ${t.text || 'untitled task'}`}
        className={s.taskCheck}
        onChange={(next) => {
          setTick({ base: t.done, done: next });
          guard(update.mutateAsync({ taskId: t.id, patch: { done: next } })).then(
            () => undefined,
            () => {
              setTick(null);
            },
          );
        }}
      />
      <InlineField
        multiline
        cpl={34}
        value={t.text}
        placeholder="Task"
        aria-label="Task"
        data-fk={taskKey(t.id)}
        className={clsx(s.taskText, done && s.taskDone)}
        onCommit={(text) => guard(update.mutateAsync({ taskId: t.id, patch: { text } }))}
        onRemove={() => guard(remove.mutateAsync({ taskId: t.id }))}
      />
      <span className={s.hours}>
        <InlineField
          value={t.hours}
          numeric={{ max: 24 }}
          inputMode="decimal"
          aria-label={`Hours for ${t.text || 'this task'}`}
          className={s.hoursInput}
          onCommit={(hours: number) => guard(update.mutateAsync({ taskId: t.id, patch: { hours } }))}
        />
        <span className={s.hoursUnit}>h</span>
      </span>
    </div>
  );
}

function NextMilestone({ milestone: m, accent, openPicker, guard }: MilestoneProps) {
  const name = useMilestoneName(m, guard);
  return (
    <div className={s.nextRow}>
      <span className={s.diamond} style={{ borderColor: accent }} aria-hidden="true" />
      <InlineField
        multiline
        cpl={22}
        value={m.name}
        placeholder="Milestone"
        aria-label="Milestone"
        data-fk={msKey(m.id)}
        className={s.nextName}
        onCommit={name.onCommit}
        onRemove={name.onRemove}
      />
      <DueButton milestone={m} openPicker={openPicker} guard={guard} />
    </div>
  );
}
