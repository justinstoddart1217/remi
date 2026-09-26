import { useToday, useUpdateSettings } from '../../../api';
import { SegmentedControl } from '../../../components';
import { l as longDate } from '../../../lib/format';
import type { MotionSetting } from '../../../lib/reducedMotion';
import { useOsReducedMotion } from '../../../lib/reducedMotion';
import { useUi } from '../../../stores/ui';
import type { Appearance } from '../../../stores/ui';
import { FieldRow, SaveNote, Section } from '../../setup/frame/Section';
import { useSaveFeedback } from '../../setup/frame/useSaveFeedback';
import f from '../../setup/fields/Fields.module.css';
import { AccentField } from '../fields/AccentField';
import m from '../fields/SettingsFields.module.css';
import { accentById, MOTION_LABELS } from '../model';

export interface AppearanceSectionProps {
  index: number;
}

const MOTIONS: readonly MotionSetting[] = ['system', 'full', 'reduced'];

/**
 * 05 Appearance: the Ninety One accent pairs, the display face for goals and motion (the
 * design's Brand and Motion tweaks). A change applies to :root at once (ui store) and is
 * saved; a failed save puts it back.
 */
export function AppearanceSection({ index }: AppearanceSectionProps) {
  const feedback = useSaveFeedback();
  const update = useUpdateSettings();
  const appearance = useUi((s) => s.appearance);
  const setAppearance = useUi((s) => s.setAppearance);
  const osReduced = useOsReducedMotion();
  const today = useToday();

  const apply = (next: Partial<Appearance>, body: Parameters<typeof update.mutateAsync>[0]) => {
    const before = useUi.getState().appearance;
    setAppearance(next);
    feedback.track(update.mutateAsync(body)).catch(() => {
      setAppearance(before);
    });
  };

  const motionNote =
    appearance.motion === 'system'
      ? osReduced
        ? 'Your system asks for reduced motion, so Remi keeps movement to fades.'
        : 'Your system allows full motion.'
      : appearance.motion === 'reduced'
        ? 'Movement resolves at once; fades remain.'
        : 'Bars glide, dates roll and the plan moves.';

  return (
    <Section
      id="appearance"
      number="05"
      title="Appearance"
      note="The Ninety One accents, the display face, and how much moves."
      index={index}
      status={<SaveNote state={feedback.state} />}
    >
      <FieldRow label="Accents" note="One colour for Private Credit, one for Fixed Income.">
        <AccentField
          value={appearance.accent}
          onChange={(id) => {
            const pair = accentById(id);
            apply({ accent: id }, { accentPc: pair.pc, accentFi: pair.fi });
          }}
        />
      </FieldRow>
      <FieldRow
        label="Display face for goals"
        note="Goal statements and day headings in Visuelt Display. Off sets them in Visuelt."
      >
        <span className={m.inlineGroup}>
          <SegmentedControl
            label="Display face for goals"
            className={f.seg}
            variant="pill"
            itemWidth={72}
            value={appearance.serif ? 'on' : 'off'}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(v) => {
              const serif = v === 'on';
              apply({ serif }, { serifDisplay: serif });
            }}
          />
          <span className={m.sample} aria-hidden="true">
            {today ? longDate(today.iso) : 'A notebook that recalculates itself'}
          </span>
        </span>
      </FieldRow>
      <FieldRow label="Motion" note="Alive, never busy. Motion explains a change.">
        <SegmentedControl
          label="Motion"
          className={f.seg}
          variant="pill"
          itemWidth={96}
          value={appearance.motion}
          options={MOTIONS.map((v) => ({ value: v, label: MOTION_LABELS[v] }))}
          onChange={(motion) => {
            apply({ motion }, { motionPreference: motion });
          }}
        />
        <span className={m.muted}>{motionNote}</span>
      </FieldRow>
    </Section>
  );
}
