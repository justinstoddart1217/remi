import { useEffect, useEffectEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';

import { useCompleteSetup, useSetupCountdown } from '../../api';
import type { SetupStatusOut } from '../../api';
import { paths } from '../../app/screens';
import { useSetupStatus } from '../../app/useSetupStatus';
import { Button } from '../../components';
import { bd as formatBd, monthYear, s as shortDate } from '../../lib/format';
import { MoveDateField } from './fields/MoveDateField';
import { HoursField } from './fields/HoursField';
import { ProviderField, ProviderStatus, RegionField } from './fields/ChoiceFields';
import f from './fields/Fields.module.css';
import { TimezoneField } from './fields/TimezoneField';
import { usePickerCalendar } from './fields/usePickerCalendar';
import { HeaderFacts, PageFrame } from './frame/PageFrame';
import { FieldRow, Section, WideRow } from './frame/Section';
import { StepRail } from './frame/StepRail';
import type { RailStep } from './frame/StepRail';
import { saveErrorMessage } from './frame/useSaveFeedback';
import { useScrollSpy } from './frame/useScrollSpy';
import {
  blockingReason,
  DEFAULT_REGIONS,
  initialDraft,
  PROVIDER_NOTE,
  regionLabel,
  STEPS,
  stepStates,
  stepSummaries,
  toSetupIn,
} from './model';
import type { AiProvider, SetupDraft } from './model';
import { RotationEditor } from './rotation/RotationEditor';
import st from './Setup.module.css';

const STEP_IDS = STEPS.map((step) => step.id);

/**
 * `/setup`, the first-run wizard (ADR-0006, ADR-0010). SetupGate sends every route here until
 * setup is done; once it is, this route hands over to Settings ('Edit setup').
 */
export function SetupScreen() {
  const status = useSetupStatus();
  const [started, setStarted] = useState(false);
  if (status.isPending) return <div className={st.blank} data-screen-label="Setup" />;
  const done = status.data?.source === 'api' && !status.data.required;
  if (done && !started) return <Navigate to={paths.settings()} replace />;
  return (
    <SetupWizard
      status={status.data?.data ?? null}
      onStarting={() => {
        setStarted(true);
      }}
      onFailed={() => {
        setStarted(false);
      }}
    />
  );
}

interface WizardProps {
  status: SetupStatusOut | null;
  onStarting: () => void;
  onFailed: () => void;
}

function providerLine(
  provider: AiProvider,
  status: SetupStatusOut | null,
): { tone: 'ok' | 'wait' | 'off'; text: string } | null {
  if (provider === 'none') return null;
  if (provider === 'anthropic') {
    return status?.ai.keySet
      ? { tone: 'ok', text: 'An Anthropic key is already set. Check-ins you send go to Anthropic to be read.' }
      : { tone: 'wait', text: 'Add your Anthropic key in Settings once you are in. Until then Remi reads simply.' };
  }
  const base = status?.ai.ollamaBaseUrl.replace(/^https?:\/\//, '') ?? '127.0.0.1:11434';
  return { tone: 'ok', text: `Remi asks the Ollama model running on this computer at ${base}.` };
}

function SetupWizard({ status, onStarting, onFailed }: WizardProps) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<SetupDraft>(() => initialDraft(status?.defaults));
  const [error, setError] = useState<string | null>(null);
  const complete = useCompleteSetup();
  const today = status?.today ?? null;
  const regions = status?.regions.length ? status.regions : DEFAULT_REGIONS;
  const calendar = usePickerCalendar(today, draft.region);
  const countdown = useSetupCountdown(draft.moveDate, draft.region);
  const spy = useScrollSpy(STEP_IDS);

  const set = <K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const countdownBd = draft.moveDate ? (countdown.data?.countdownBd ?? null) : null;
  const serverMove = draft.moveDate && countdown.data ? countdown.data.moveDate : draft.moveDate;
  const moveBdm = serverMove ? (calendar.index?.bdOfMonth(serverMove) ?? null) : null;
  const regionName = regionLabel(regions.find((r) => r.code === draft.region)?.label ?? draft.region);
  const todayBdm = today ? (calendar.index?.bdOfMonth(today) ?? null) : null;

  const states = stepStates(draft);
  const summaries = stepSummaries(draft, {
    countdownBd,
    moveLabel: serverMove ? `${shortDate(serverMove)} ${serverMove.slice(0, 4)}` : null,
    regionName,
  });
  const railSteps: RailStep[] = STEPS.map((step) => ({ ...step, summary: summaries[step.id], state: states[step.id] }));
  const blocked = blockingReason(draft);
  const busy = complete.isPending;

  const start = () => {
    if (blocked || busy) return;
    setError(null);
    onStarting();
    complete.mutateAsync(toSetupIn(draft)).then(
      () => {
        void navigate(paths.home(), { replace: true });
      },
      (e: unknown) => {
        onFailed();
        setError(saveErrorMessage(e));
      },
    );
  };

  // ⌘↵ / Ctrl+↵ starts from anywhere on the page (as the drawer's apply).
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
      e.preventDefault();
      start();
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      onKey(e);
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, []);

  const moveSub = serverMove ? (
    countdown.data?.snapped && countdown.data.moveDate !== draft.moveDate ? (
      <span className={st.snapped}>
        {`${shortDate(countdown.data.moveDate)} is the next business day in ${regionName}, so the move lands there.`}
      </span>
    ) : (
      `${monthYear(serverMove)}${moveBdm != null ? ` · ${formatBd(moveBdm)}` : ''}`
    )
  ) : (
    'Pick your first day in Fixed Income. Weekends and holidays move to the next business day.'
  );
  const provider = providerLine(draft.provider, status);

  const rail = (
    <StepRail
      title="Your plan"
      steps={railSteps}
      current={spy.current}
      onJump={spy.jump}
      footer={
        <div className={st.start}>
          <Button
            size="l"
            className={st.startButton}
            onClick={start}
            disabled={blocked !== null || busy}
            kbd="⌘↵"
          >
            Start with an empty plan
          </Button>
          <p className={error ? st.startError : st.startNote} role={error ? 'alert' : undefined}>
            {error ??
              blocked ??
              'Remi starts empty. Add your projects and routines once you are in; change any of this later in Settings.'}
          </p>
        </div>
      }
    />
  );

  return (
    <PageFrame
      screenLabel="Setup"
      eyebrow="First run"
      title="Set up your plan"
      lead="Four short steps. Remi counts every business day to your move and plans around your working day. Nothing here is shared."
      headerRight={<HeaderFacts today={today ? shortDate(today) : ''} bd={todayBdm != null ? formatBd(todayBdm) : ''} countdown={countdownBd} />}
      rail={rail}
    >
      <Section id="move" number="01" title="The move" note="Your first day in Fixed Income." index={1}>
        <FieldRow label="Move date" note="Everything counts down to it." htmlFor="setup-move">
          <MoveDateField
            id="setup-move"
            value={draft.moveDate}
            today={today ?? '1970-01-01'}
            calendar={today ? calendar.picker : null}
            countdownBd={countdownBd}
            onPick={(iso) => {
              set('moveDate', iso);
            }}
            sub={moveSub}
          />
        </FieldRow>
      </Section>

      <Section id="day" number="02" title="Your working day" note="What a day holds, and which days count." index={2}>
        <FieldRow label="Hours a day" note="Your capacity. A day that holds more is flagged." htmlFor="setup-hours">
          <HoursField
            id="setup-hours"
            label="Hours a day"
            value={draft.hoursPerDay}
            unit="a working day"
            onCommit={(h) => {
              set('hoursPerDay', h);
            }}
          />
        </FieldRow>
        <FieldRow label="Holidays" note="Business days skip these public holidays.">
          <RegionField
            value={draft.region}
            regions={regions}
            onChange={(region) => {
              set('region', region);
            }}
          />
        </FieldRow>
        <FieldRow label="Time zone" note="Today turns over at midnight here." htmlFor="setup-tz">
          <TimezoneField
            id="setup-tz"
            value={draft.timezone}
            onCommit={(zone) => {
              set('timezone', zone);
            }}
          />
        </FieldRow>
      </Section>

      <Section
        id="rotation"
        number="03"
        title="Fixed Income rotation"
        note="Optional. You can do this later."
        index={3}
      >
        <FieldRow label="Hours a day" note="Given to the rotation once you have moved." htmlFor="setup-rot-hours">
          <HoursField
            id="setup-rot-hours"
            label="Rotation hours a day"
            value={draft.rotationHoursPerDay}
            min={0}
            unit="on the rotation"
            onCommit={(h) => {
              set('rotationHoursPerDay', h);
            }}
          />
        </FieldRow>
        <WideRow>
          <div className={st.rotationHead}>
            <span className={st.rotationLabel}>Countries, in order</span>
            <span className={st.rotationNote}>Build passes make the first loop; Refresh passes come after it.</span>
          </div>
          <RotationEditor
            segments={draft.segments}
            onChange={(segments) => {
              set('segments', segments);
            }}
            emptyText="No rotation yet. Add the countries in the order you will cover them after the move, or skip this and set it up later in Settings."
          />
        </WideRow>
      </Section>

      <Section id="ai" number="04" title="Tell Remi" note="How your check-ins are read." index={4}>
        <FieldRow label="Provider" note="None is the default. You can switch any time.">
          <ProviderField
            value={draft.provider}
            onChange={(p) => {
              set('provider', p);
            }}
          />
          <span className={f.providerNote}>{PROVIDER_NOTE[draft.provider]}</span>
          {provider && <ProviderStatus tone={provider.tone}>{provider.text}</ProviderStatus>}
        </FieldRow>
      </Section>
    </PageFrame>
  );
}
