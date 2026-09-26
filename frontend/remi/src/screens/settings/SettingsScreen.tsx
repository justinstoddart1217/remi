import { useEffect, useEffectEvent, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useRotation, useSettings } from '../../api';
import type { SettingsOut } from '../../api';
import { paths } from '../../app/screens';
import { useSetupStatus } from '../../app/useSetupStatus';
import { Button, EmptyState } from '../../components';
import { useHeaderModel } from '../../shell/HeaderBar/headerModel';
import { useUi } from '../../stores/ui';
import { HeaderFacts, PageFrame } from '../setup/frame/PageFrame';
import { StepRail } from '../setup/frame/StepRail';
import type { RailStep } from '../setup/frame/StepRail';
import { useScrollSpy } from '../setup/frame/useScrollSpy';
import { DEFAULT_REGIONS } from '../setup/model';
import { fromServer } from '../setup/rotation/model';
import { appearanceFromSettings, SETTINGS_SECTIONS, settingsRail } from './model';
import type { SettingsSectionId } from './model';
import { AiSection } from './sections/AiSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { MoveSection } from './sections/MoveSection';
import { RotationSection } from './sections/RotationSection';
import { WorkdaySection } from './sections/WorkdaySection';
import s from './Settings.module.css';

const SECTION_IDS = SETTINGS_SECTIONS.map((x) => x.id);

function isSectionId(value: string): value is SettingsSectionId {
  return (SECTION_IDS as readonly string[]).includes(value);
}

/** True when a key press belongs to a field, a menu or a dialog rather than the page. */
function ownedByControl(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  if (t.closest('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="dialog"]')) return true;
  return document.querySelector('[role="dialog"]') !== null;
}

/**
 * `/settings` (ADR-0010, ⌘K 'Edit setup'): the setup's choices, editable, in the same frame
 * as the wizard. Each section saves as you go and says so quietly; Escape or Done goes back.
 */
export function SettingsScreen() {
  const settings = useSettings();
  const navigate = useNavigate();
  const location = useLocation();

  const leave = () => {
    if (location.key !== 'default') void navigate(-1);
    else void navigate(paths.home());
  };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || ownedByControl(e)) return;
    e.preventDefault();
    leave();
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

  if (settings.isPending) return <div className={s.blank} data-screen-label="Settings" />;
  if (!settings.data) {
    return (
      <PageFrame screenLabel="Settings" eyebrow="Settings" title="Edit your setup" homeLink brandNote="‹ Home · Settings">
        <div className={s.problem}>
          <EmptyState>
            {`Remi could not read your settings. ${settings.error.message}`.trim()}
          </EmptyState>
          <Button
            variant="outline"
            size="s"
            onClick={() => {
              void settings.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      </PageFrame>
    );
  }
  return <SettingsPage settings={settings.data} onDone={leave} />;
}

interface SettingsPageProps {
  settings: SettingsOut;
  onDone: () => void;
}

function SettingsPage({ settings, onDone }: SettingsPageProps) {
  const header = useHeaderModel();
  const setup = useSetupStatus();
  const rotation = useRotation();
  const spy = useScrollSpy(SECTION_IDS);
  const location = useLocation();
  const regions = setup.data?.data?.regions.length ? setup.data.data.regions : DEFAULT_REGIONS;
  const regionName = regions.find((r) => r.code === settings.holidayRegion)?.label ?? settings.holidayRegion;

  // :root follows what is saved. The app root (app/useAppearance.ts) hydrates it from settings
  // too; this keeps the page right on its own (the choices below read the ui store).
  const { accentPc, accentFi, serifDisplay, motionPreference } = settings;
  useEffect(() => {
    useUi.getState().setAppearance(appearanceFromSettings({ accentPc, accentFi, serifDisplay, motionPreference }));
  }, [accentPc, accentFi, serifDisplay, motionPreference]);

  // '/settings#rotation' opens at that section.
  const jumped = useRef(false);
  const { jump } = spy;
  useEffect(() => {
    if (jumped.current) return;
    jumped.current = true;
    const hash = location.hash.replace(/^#/, '');
    if (isSectionId(hash)) {
      requestAnimationFrame(() => {
        jump(hash);
      });
    }
  }, [location.hash, jump]);

  const rail = settingsRail({
    settings,
    regionName,
    countdownBd: header.countdownBd,
    segments: rotation ? fromServer(rotation.segments) : [],
  });
  const steps: RailStep[] = SETTINGS_SECTIONS.map((x) => ({ ...x, ...rail[x.id] }));

  return (
    <PageFrame
      screenLabel="Settings"
      eyebrow="Settings"
      title="Edit your setup"
      lead="Everything the first run asked, and how Remi looks. Changes save as you make them, and anything that shapes the plan recalculates it at once."
      homeLink
      brandNote="‹ Home · Settings"
      headerRight={<HeaderFacts today={header.today} bd={header.bd} countdown={header.countdownBd} />}
      rail={
        <StepRail
          title="On this page"
          steps={steps}
          current={spy.current}
          onJump={spy.jump}
          footer={
            <div className={s.done}>
              <Button variant="outline" size="l" className={s.doneButton} onClick={onDone} kbd="esc">
                Done
              </Button>
              <p className={s.doneNote}>Nothing here leaves this computer unless you choose a provider.</p>
            </div>
          }
        />
      }
    >
      <MoveSection settings={settings} index={1} />
      <WorkdaySection settings={settings} regions={regions} index={2} />
      <RotationSection index={3} />
      <AiSection settings={settings} index={4} />
      <AppearanceSection index={5} />
    </PageFrame>
  );
}
