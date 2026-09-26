import { useCallback } from 'react';

import { Button, DomainTag, EmptyState, IconButton, MilestoneDiamond, SidePanel } from '../../components';
import type { ProjectOut } from '../../api';
import { useIsActiveScreen } from '../../lib/arrival';
import * as F from '../../lib/format';
import { useOverlayLayer } from '../../stores/overlays';
import { targetText } from './model';
import s from './Timeline.module.css';

export const PANEL_LAYER = 'timeline-panel';

interface Props {
  /** The open project, or null (the last one stays rendered through the exit). */
  project: ProjectOut | null;
  onClose: () => void;
  onOpenWorkspace: (projectId: string) => void;
  onTellRemi: (projectId: string) => void;
}

/**
 * The 460px project panel (Timeline.dc.html:178-209): no scrim, slides in over 440ms. It
 * keeps its content through the exit (the prototype blanked it), and Escape closes it when it
 * is the topmost layer and the Timeline is on screen: the screen stays mounted with the panel
 * open while another screen shows, and an Escape there must not close it unseen (as the
 * Calendar's day panel).
 */
export function ProjectPanel({ project, onClose, onOpenWorkspace, onTellRemi }: Props) {
  const active = useIsActiveScreen();
  useOverlayLayer(PANEL_LAYER, project !== null && active, onClose);
  const render = useCallback(
    (p: ProjectOut) => <PanelContent p={p} onClose={onClose} onOpenWorkspace={onOpenWorkspace} onTellRemi={onTellRemi} />,
    [onClose, onOpenWorkspace, onTellRemi],
  );
  return (
    <SidePanel item={project} width={460} zIndex={12} label="Project details">
      {render}
    </SidePanel>
  );
}

function PanelContent({
  p,
  onClose,
  onOpenWorkspace,
  onTellRemi,
}: {
  p: ProjectOut;
  onClose: () => void;
  onOpenWorkspace: (projectId: string) => void;
  onTellRemi: (projectId: string) => void;
}) {
  const ms = p.derived.milestones;
  return (
    <>
      <div className={s.panelHead}>
        <DomainTag domain={p.domain} />
        <div className={s.spacer} />
        <IconButton icon="close" label="Close" variant="plain" size={32} iconSize={20} onClick={onClose} />
      </div>
      <h2 className={s.panelName}>{p.name}</h2>
      <p className={s.panelGoal}>{p.goal}</p>
      <dl className={s.facts}>
        <dt>Forecast</dt>
        <dd className={s.factStrong}>{p.forecastDate ? F.s(p.forecastDate) : 'Not yet'}</dd>
        <dt>Target</dt>
        <dd>{targetText(p)}</dd>
        <dt>Against target</dt>
        <dd className={s.factNumeric}>{F.delta(p.derived.deltaBd)}</dd>
        <dt>Confidence</dt>
        <dd>{p.confidence ? `${String(p.confidence)} of 5` : 'Not set'}</dd>
        <dt>Last check-in</dt>
        <dd>{F.since(p.derived.sinceDays)}</dd>
      </dl>
      <h3 className={s.panelEyebrow}>Milestones</h3>
      <ul className={s.msList}>
        {ms.map((m) => (
          <li key={`${m.name}:${m.date}`} className={s.msRow}>
            <MilestoneDiamond size={8} color={p.domain} passed={m.passed} />
            <span className={s.msName}>{m.name}</span>
            <span className={s.msDate}>{F.s(m.date)}</span>
          </li>
        ))}
        {p.forecastDate && (
          <li className={s.msRow}>
            <MilestoneDiamond size={8} color={p.domain} />
            <span className={s.msName}>{p.endName}</span>
            <span className={s.msDate}>{F.s(p.forecastDate)}</span>
          </li>
        )}
      </ul>
      {ms.length === 0 && (
        <EmptyState className={s.msEmpty}>
          No milestones yet. They arrive once the charter is finished and the plan is drafted.
        </EmptyState>
      )}
      <div className={s.spacer} />
      <div className={s.panelActions}>
        <Button
          variant="primary"
          size="l"
          className={s.panelButton}
          onClick={() => {
            onOpenWorkspace(p.id);
          }}
        >
          Open workspace
        </Button>
        <Button
          variant="raised"
          size="l"
          className={s.panelSecondary}
          onClick={() => {
            onTellRemi(p.id);
          }}
        >
          Tell Remi
        </Button>
      </div>
    </>
  );
}
