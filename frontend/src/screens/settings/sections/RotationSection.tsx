import { useCallback } from 'react';

import { usePutRotationSegments, useRotation, useUpdateRotation } from '../../../api';
import type { RotationOut } from '../../../api';
import { dm, s as shortDate } from '../../../lib/format';
import { HoursField } from '../../setup/fields/HoursField';
import { FieldError, FieldRow, SaveNote, Section, WideRow } from '../../setup/frame/Section';
import { useSaveFeedback } from '../../setup/frame/useSaveFeedback';
import { RotationEditor } from '../../setup/rotation/RotationEditor';
import type { segmentsIn } from '../../setup/rotation/model';
import st from '../../setup/Setup.module.css';
import m from '../fields/SettingsFields.module.css';
import { movedNote, segmentDates } from '../model';
import { useRotationDraft } from '../useRotationDraft';

export interface RotationSectionProps {
  index: number;
}

/**
 * 03 Fixed Income rotation: hours a day (`PATCH /rotation`) and the ordered countries
 * (`PUT /rotation/segments`, saved as you go). The server lays out the dates.
 */
export function RotationSection({ index }: RotationSectionProps) {
  const feedback = useSaveFeedback();
  const rotation = useRotation();
  const updateRotation = useUpdateRotation();
  const putSegments = usePutRotationSegments();
  const { track } = feedback;
  const { mutateAsync: putAsync } = putSegments;

  const save = useCallback(
    (segments: ReturnType<typeof segmentsIn>): Promise<{ entity: RotationOut }> =>
      track(putAsync(segments), movedNote, 'segments'),
    [track, putAsync],
  );
  const { draft, change } = useRotationDraft(rotation, save);

  const dates = rotation ? segmentDates(draft, rotation.segments, dm) : {};
  const currentKey =
    rotation?.current.segmentId != null ? (draft.find((s) => s.id === rotation.current.segmentId)?.key ?? null) : null;
  const start = rotation?.startDate ?? null;

  return (
    <Section
      id="rotation"
      number="03"
      title="Fixed Income rotation"
      note="The countries you cover after the move, in order."
      index={index}
      status={<SaveNote state={feedback.state} />}
    >
      <FieldRow label="Hours a day" note="Given to the rotation once you have moved." htmlFor="settings-rot-hours">
        {rotation ? (
          <HoursField
            id="settings-rot-hours"
            label="Rotation hours a day"
            value={rotation.hoursPerDay}
            min={0}
            unit="on the rotation"
            onCommit={(h) =>
              h === rotation.hoursPerDay
                ? undefined
                : track(updateRotation.mutateAsync({ hoursPerDay: h }), movedNote, 'rot-hours')
            }
          />
        ) : (
          <span className={m.muted}>…</span>
        )}
        <FieldError state={feedback.state} field="rot-hours" />
      </FieldRow>
      <FieldRow label="Starts" note={rotation?.startFollowsMove !== false ? 'With the move, and moves with it.' : undefined}>
        <span className={m.value}>{start ? shortDate(start) : 'With the move'}</span>
      </FieldRow>
      <WideRow>
        <div className={st.rotationHead}>
          <span className={st.rotationLabel}>Countries, in order</span>
          <span className={st.rotationNote}>
            Build passes make the first loop; Refresh passes come after it. Changes save as you make them.
          </span>
        </div>
        <RotationEditor
          segments={draft}
          onChange={change}
          dates={dates}
          currentKey={currentKey}
          footNote={rotation?.loopEnd ? `Loop 1 ends ${shortDate(rotation.loopEnd)}` : undefined}
          emptyText="No rotation yet. Add the countries in the order you will cover them after the move, and Remi lays them out on business days."
        />
        <FieldError state={feedback.state} field="segments" />
      </WideRow>
    </Section>
  );
}
