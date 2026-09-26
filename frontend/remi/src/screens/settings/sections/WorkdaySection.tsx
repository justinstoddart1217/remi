import { useState } from 'react';

import { useUpdateSettings } from '../../../api';
import type { SettingsOut } from '../../../api';
import { HoursField } from '../../setup/fields/HoursField';
import { RegionField } from '../../setup/fields/ChoiceFields';
import { TimezoneField } from '../../setup/fields/TimezoneField';
import { FieldError, FieldRow, SaveNote, Section } from '../../setup/frame/Section';
import { useSaveFeedback } from '../../setup/frame/useSaveFeedback';
import type { HolidayRegion, RegionOption } from '../../setup/model';
import { movedNote } from '../model';

export interface WorkdaySectionProps {
  settings: SettingsOut;
  regions: readonly RegionOption[];
  index: number;
}

/** 02 Your working day: capacity, holiday region and time zone (each re-derives the plan). */
export function WorkdaySection({ settings, regions, index }: WorkdaySectionProps) {
  const feedback = useSaveFeedback();
  const update = useUpdateSettings();
  const [pendingRegion, setPendingRegion] = useState<HolidayRegion | null>(null);

  const patch = (body: Parameters<typeof update.mutateAsync>[0], field: string) =>
    feedback.track(update.mutateAsync(body), movedNote, field);

  const chooseRegion = (region: HolidayRegion) => {
    if (region === settings.holidayRegion) {
      setPendingRegion(null);
      return;
    }
    setPendingRegion(region);
    const done = () => {
      setPendingRegion((cur) => (cur === region ? null : cur));
    };
    patch({ holidayRegion: region }, 'region').then(done, done);
  };

  return (
    <Section
      id="day"
      number="02"
      title="Your working day"
      note="What a day holds, and which days count."
      index={index}
      status={<SaveNote state={feedback.state} />}
    >
      <FieldRow label="Hours a day" note="Your capacity. A day that holds more is flagged." htmlFor="settings-hours">
        <HoursField
          id="settings-hours"
          label="Hours a day"
          value={settings.capacityHoursPerDay}
          unit="a working day"
          onCommit={(h) =>
            h === settings.capacityHoursPerDay ? undefined : patch({ capacityHoursPerDay: h }, 'hours')
          }
        />
        <FieldError state={feedback.state} field="hours" />
      </FieldRow>
      <FieldRow label="Holidays" note="Business days skip these public holidays.">
        <RegionField value={pendingRegion ?? settings.holidayRegion} regions={regions} onChange={chooseRegion} />
        <FieldError state={feedback.state} field="region" />
      </FieldRow>
      <FieldRow label="Time zone" note="Today turns over at midnight here." htmlFor="settings-tz">
        <TimezoneField
          id="settings-tz"
          value={settings.timezone}
          onCommit={(zone) => patch({ timezone: zone }, 'timezone')}
        />
        <FieldError state={feedback.state} field="timezone" />
      </FieldRow>
    </Section>
  );
}
