import { Link } from 'react-router';

import { useSettings } from '../../api/queries/settings';
import { useGo } from '../../app/navigation';
import { paths } from '../../app/screens';
import { Icon } from '../../components/Icon';
import { useOverlays } from '../../stores/overlays';
import { useUi } from '../../stores/ui';
import { useActiveScreen } from '../useActiveScreen';
import { useGoHome } from '../useGoHome';
import { BusinessClock } from './BusinessClock';
import { clockZone } from './clock';
import { dateLineParts, flagsPinnedDate, pinnedDateTitle, PINNED_DATE_TEXT, useHeaderModel } from './headerModel';
import s from './HeaderBar.module.css';
import { LogoMark } from './LogoMark';
import { NavTabs } from './NavTabs';

/** The top bar's Settings link: its accessible name and tooltip. */
export const SETTINGS_LINK_LABEL = 'Settings';

/**
 * The 66px dark-teal top bar (Remi.dc.html <header>, the Ninety One redesign), left to right:
 * - the REMI bar mark and wordmark, "‹ Home · Workflow": back to Home (a 180ms fade);
 * - a hairline, then the seven screen tabs (NavTabs, `nav[aria-label="Screens"]`);
 * - on the right, the status cluster: date · BD · verdict in small mono caps over the countdown
 *   (both go to Transition), a hairline, the live clock in the business timezone, the round
 *   ⌘K search button and the green "Tell Remi" button, which focuses the drawer on the
 *   workspace's project when the workspace is showing;
 * - the dashed mint strip flowing along the bottom edge.
 *
 * Remi adds two things the design has no data for, both at the left of the status cluster, where
 * the spacer absorbs them and nothing in the design's cluster moves:
 * - the round Settings link (ADR-0010: the one always-visible way to Settings);
 * - in a built app with `REMI_TODAY` set, the "Pinned date" flag (see `flagsPinnedDate`).
 *
 * Before the plan is read (loading, before setup, an error) the date line is empty and has no
 * verdict dot, and the countdown is a dash: calm placeholders, never sample numbers.
 */
export function HeaderBar() {
  const model = useHeaderModel();
  const settingsTz = useSettings().data?.timezone;
  const go = useGo();
  const goHome = useGoHome();
  const active = useActiveScreen();
  const workspaceId = useUi((st) => st.lastWorkspaceId);
  const openPalette = useOverlays((st) => st.openPalette);
  const openDrawer = useOverlays((st) => st.openDrawer);
  const ready = model.status === 'ready';
  const line = dateLineParts(model);

  return (
    <header className={s.header} aria-busy={model.status === 'loading' ? true : undefined}>
      <button type="button" className={s.home} title="Back to home" onClick={goHome}>
        <span className={s.markBox}>
          <LogoMark />
        </span>
        <span className={s.brand}>
          <span className={s.wordmark}>REMI</span>
          <span className={s.homeSub}>‹ Home · Workflow</span>
        </span>
      </button>
      <span className={s.rule} aria-hidden="true" />
      <NavTabs />
      <div className={s.spacer} />
      <div className={s.status}>
        <Link to={paths.settings()} className={s.round} title={SETTINGS_LINK_LABEL} aria-label={SETTINGS_LINK_LABEL}>
          <Icon name="settings" className={s.roundIcon} />
        </Link>
        {flagsPinnedDate(model) && (
          <span className={s.pinned} title={pinnedDateTitle(model.today)}>
            <span className={s.pinnedDot} aria-hidden="true" />
            {PINNED_DATE_TEXT}
          </span>
        )}
        <button
          type="button"
          className={s.countdown}
          title="Transition"
          onClick={() => {
            go('transition');
          }}
        >
          <span className={s.kicker}>
            {ready && (
              <span className={s.dotBox} aria-hidden="true">
                <span className={s.dot} style={{ background: model.verdict.dot }} />
                <span className={s.ping} style={{ borderColor: model.verdict.dot }} />
              </span>
            )}
            {line.date !== '' && <span>{line.date}</span>}
            {line.verdict !== '' && <span>{line.verdict}</span>}
          </span>
          <span className={s.countRow}>
            <span className={s.countValue}>{model.countdown}</span>
            <span className={s.countLabel}>business days to Fixed Income</span>
          </span>
        </button>
        <span className={s.statusRule} aria-hidden="true" />
        <BusinessClock tz={clockZone(model.tz, settingsTz)} />
        <button
          type="button"
          className={s.round}
          title="Search or add (⌘K)"
          aria-label="Search or add"
          aria-keyshortcuts="Meta+K Control+K"
          onClick={() => {
            openPalette();
          }}
        >
          <Icon name="search" className={s.roundIcon} />
        </button>
        <button
          type="button"
          className={s.primary}
          onClick={() => {
            openDrawer(active === 'workspace' ? workspaceId : null);
          }}
        >
          <Icon name="edit_note" className={s.primaryIcon} />
          <span>Tell Remi</span>
        </button>
      </div>
      <span className={s.flow} aria-hidden="true" />
    </header>
  );
}
