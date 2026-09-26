import { useState } from 'react';

import { useMove, useProjects, useRoutines, useSetupCountdown, useToday, useUpdateSettings, useVerdict } from '../../../api';
import type { SettingsOut } from '../../../api';
import { bd as formatBd, count, monthYear, s as shortDate } from '../../../lib/format';
import { NO_PC_SENTENCE, VERDICT_CHROME } from '../../../shell/HeaderBar/headerModel';
import { MoveDateField } from '../../setup/fields/MoveDateField';
import { usePickerCalendar } from '../../setup/fields/usePickerCalendar';
import { FieldError, FieldRow, SaveNote, Section } from '../../setup/frame/Section';
import { useSaveFeedback } from '../../setup/frame/useSaveFeedback';
import { ChoiceMenu } from '../fields/ChoiceMenu';
import m from '../fields/SettingsFields.module.css';
import { keyProjectChoices, keyRoutineChoices, movedNote } from '../model';

export interface MoveSectionProps {
  settings: SettingsOut;
  index: number;
}

/** 01 The move: the date, and the key project and routine that decide the verdict. */
export function MoveSection({ settings, index }: MoveSectionProps) {
  const feedback = useSaveFeedback();
  const update = useUpdateSettings();
  const today = useToday();
  const move = useMove();
  const verdict = useVerdict();
  const projects = useProjects();
  const routines = useRoutines();
  const region = settings.holidayRegion;
  const calendar = usePickerCalendar(today?.iso, region);

  // The chosen date shows at once; its countdown comes from the preview until the plan answers.
  const [pending, setPending] = useState<string | null>(null);
  const preview = useSetupCountdown(pending, region);
  const shown = pending ?? settings.moveDate;
  const countdownBd = pending ? (preview.data?.countdownBd ?? null) : (move?.countdownBd ?? null);
  const bdm = shown ? (calendar.index?.bdOfMonth(shown) ?? null) : null;

  const pickMove = (iso: string) => {
    if (iso === settings.moveDate) return;
    setPending(iso);
    const done = () => {
      setPending((cur) => (cur === iso ? null : cur));
    };
    feedback.track(update.mutateAsync({ moveDate: iso }), movedNote, 'move').then(done, done);
  };

  const patch = (body: Parameters<typeof update.mutateAsync>[0], field: string) =>
    feedback.track(update.mutateAsync(body), movedNote, field);

  const keyProject = projects?.find((p) => p.id === settings.keyProjectId) ?? null;
  const projectChoices = keyProjectChoices(projects ?? [], settings.keyProjectId);
  const routineChoices = keyRoutineChoices(routines ?? []);
  const chrome = verdict ? VERDICT_CHROME[verdict.state] : null;
  const verdictSub = !verdict
    ? ''
    : verdict.state === 'no_pc'
      ? NO_PC_SENTENCE
      : verdict.bufferBd != null
        ? `${count(verdict.bufferBd, 'business day')} of buffer between the last Private Credit exit and the move.`
        : '';

  return (
    <Section
      id="move"
      number="01"
      title="The move"
      note="Your first day in Fixed Income."
      index={index}
      status={<SaveNote state={feedback.state} />}
    >
      <FieldRow label="Move date" note="Everything counts down to it." htmlFor="settings-move">
        <MoveDateField
          id="settings-move"
          value={shown}
          today={today?.iso ?? '1970-01-01'}
          calendar={today ? calendar.picker : null}
          countdownBd={countdownBd}
          onPick={pickMove}
          sub={shown ? `${monthYear(shown)}${bdm != null ? ` · ${formatBd(bdm)}` : ''}` : undefined}
        />
        <FieldError state={feedback.state} field="move" />
      </FieldRow>
      <FieldRow
        label="Key project"
        note="The Private Credit exit the move hangs on. It must land before the key run."
        htmlFor="settings-key-project"
      >
        <ChoiceMenu
          id="settings-key-project"
          label="Key project"
          value={settings.keyProjectId}
          choices={projectChoices}
          emptyText="No Private Credit projects yet. Add one on Projects, then choose it here."
          onChoose={(value) => patch({ keyProjectId: value }, 'key-project')}
        />
        {keyProject && (
          <span className={m.muted}>
            {keyProject.forecastDate ? `Forecast ${shortDate(keyProject.forecastDate)}` : 'No forecast yet'}
          </span>
        )}
        <FieldError state={feedback.state} field="key-project" />
      </FieldRow>
      <FieldRow
        label="Key routine"
        note="Its last run before the move is the key run, the one to hand over."
        htmlFor="settings-key-routine"
      >
        <ChoiceMenu
          id="settings-key-routine"
          label="Key routine"
          value={settings.keyRoutineId}
          choices={routineChoices}
          emptyText="No routines yet. Add the BAU that repeats on Routines, then choose it here."
          onChoose={(value) => patch({ keyRoutineId: value }, 'key-routine')}
        />
        {settings.keyRoutineId && (
          <span className={m.muted}>
            {verdict?.keyRun ? `Key run ${shortDate(verdict.keyRun)}` : 'No run before the move'}
          </span>
        )}
        <FieldError state={feedback.state} field="key-routine" />
      </FieldRow>
      {chrome && (
        <FieldRow label="Verdict" note="Worked out again with every change.">
          <span className={m.verdict}>
            <span className={m.verdictDot} style={{ background: chrome.dot }} aria-hidden="true" />
            {chrome.word}
          </span>
          {verdictSub && <span className={m.muted}>{verdictSub}</span>}
        </FieldRow>
      )}
    </Section>
  );
}
