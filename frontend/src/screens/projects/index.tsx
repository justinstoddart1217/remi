import type { CSSProperties, MouseEvent } from 'react';
import { useNavigate } from 'react-router';

import { useCreateProject, usePlanSettings, usePlanStatus, useProjects } from '../../api';
import type { ProjectDomain, ProjectOut } from '../../api';
import { paths } from '../../app/screens';
import {
  AddButton,
  Button,
  ConfidencePips,
  DeltaChip,
  DOMAIN_ACCENT,
  EmptyState,
  Eyebrow,
  Icon,
  Roll,
  StaleBadge,
  Toast,
  useToast,
} from '../../components';
import { useArrival } from '../../lib/arrival';
import { GOAL_TRANSITION_NAME, openProjectViaCard } from '../../lib/viewTransition';
import { hoverKey, useHover } from '../../stores/hover';
import type { HoverKey } from '../../stores/hover';
import { useScreenDimmed, useScreenIsHovered } from '../linkedHover';
import { useOverlays } from '../../stores/overlays';
import { useUi } from '../../stores/ui';
import { WORKSPACE_FOCUS_PARAM } from '../workspace/focus';
import { projectGroups, projectsHelper, rowDelayMs } from './model';
import type { ProjectGroupModel, ProjectRowModel } from './model';
import s from './Projects.module.css';

const COLUMNS = ['Goal', 'Forecast · target', 'Scope growth', 'Confidence', 'Last check-in', ''] as const;
const GROUP_DELAY: Record<ProjectDomain, string> = { pc: '20ms', fi: '120ms' };
const EMPTY_PROJECTS: readonly ProjectOut[] = [];

/**
 * Projects (Projects.dc.html): every project leads with its goal, grouped Private Credit then
 * Fixed Income. A row opens the workspace with the shared-element goal transition; "Check in
 * now" opens the drawer; "+ New project" creates one and opens it with the goal focused.
 */
export default function ProjectsScreen() {
  const { status, error, refetch } = usePlanStatus();
  const projects = useProjects();
  const settings = usePlanSettings();
  const { attrs } = useArrival();

  const groups = projectGroups(projects ?? EMPTY_PROJECTS, settings?.moveDate);

  return (
    <div className={s.root} {...attrs} aria-busy={status === 'loading' || undefined}>
      <div className={s.head}>
        <div>
          <Eyebrow>Projects</Eyebrow>
          <h1 className={s.title} tabIndex={-1}>
            Every project leads with what it is for
          </h1>
        </div>
        <div className={s.helper}>{projectsHelper(projects?.length ?? 1)}</div>
      </div>

      <div className={s.cols} role="presentation">
        {COLUMNS.map((c, i) => (
          <span key={i}>{c}</span>
        ))}
      </div>

      {status === 'error' ? (
        <div className={s.status}>
          <EmptyState>The projects could not be loaded. {error?.message}</EmptyState>
          <Button variant="raised" size="s" onClick={refetch}>
            Try again
          </Button>
        </div>
      ) : status === 'ready' ? (
        groups.map((g) => <Group key={g.domain} group={g} />)
      ) : null}
    </div>
  );
}

function Group({ group }: { group: ProjectGroupModel }) {
  const navigate = useNavigate();
  const create = useCreateProject();
  const toast = useToast();

  const onCreate = () => {
    if (create.isPending) return;
    create.mutate(
      { domain: group.domain },
      {
        onSuccess: (out) => {
          void navigate(`${paths.project(out.entity.id)}?${WORKSPACE_FOCUS_PARAM}=goal`);
        },
        onError: (e) => {
          toast.show(`Couldn’t create the project. ${e.message}`);
        },
      },
    );
  };

  return (
    <section aria-labelledby={`projects-group-${group.domain}`}>
      <div className={s.group} style={{ '--delay': GROUP_DELAY[group.domain] } as CSSProperties}>
        <span className={s.groupDot} style={{ background: DOMAIN_ACCENT[group.domain] }} aria-hidden="true" />
        <h2 id={`projects-group-${group.domain}`} className={s.groupLabel}>
          {group.label}
        </h2>
        <span className={s.groupNote}>{group.note}</span>
        <span className={s.spacer} />
        <AddButton size="bordered" className={s.newProject} disabled={create.isPending} onClick={onCreate}>
          New project
        </AddButton>
      </div>
      {group.rows.length === 0 ? (
        <EmptyState className={s.groupEmpty}>{group.empty}</EmptyState>
      ) : (
        group.rows.map((row) => <ProjectRow key={row.id} row={row} />)
      )}
      <Toast message={toast.message} />
    </section>
  );
}

function ProjectRow({ row }: { row: ProjectRowModel }) {
  const navigate = useNavigate();
  const key: HoverKey = hoverKey('project', row.id);
  const hovered = useScreenIsHovered(key);
  const dimmed = useScreenDimmed(key);
  const vtFrom = useUi((st) => st.vtPhase === 'from' && st.vtId === row.id);
  const goalId = `project-goal-${row.id}`;

  const open = () => {
    openProjectViaCard(row.id, navigate);
  };
  const onLinkClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Modified clicks keep the browser's own behaviour (new tab, new window).
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    open();
  };

  return (
    <div
      className={s.row}
      data-project={row.id}
      data-hovered={hovered}
      data-dimmed={dimmed}
      style={{ '--delay': `${String(rowDelayMs(row.index))}ms` } as CSSProperties}
      onMouseEnter={() => {
        useHover.getState().set(key);
      }}
      onMouseLeave={() => {
        useHover.getState().clear();
      }}
    >
      <div className={s.goalCell}>
        <div className={s.nameLine}>
          <a href={paths.project(row.id)} className={s.link} aria-describedby={goalId} onClick={onLinkClick}>
            {row.name}
          </a>
          {row.stale && row.sinceDays != null ? <StaleBadge days={row.sinceDays} /> : null}
        </div>
        <div
          id={goalId}
          className={s.goal}
          data-muted={row.goalMuted}
          style={{ viewTransitionName: vtFrom ? GOAL_TRANSITION_NAME : 'none' }}
        >
          {row.goal}
        </div>
      </div>

      <div className={s.forecastCell}>
        <span className={s.forecastLine}>
          <span className={s.rollBox}>
            <Roll value={row.forecast} />
          </span>
          <DeltaChip tone={row.chipTone} size="m" weight={500} label={row.chip} />
        </span>
        <span className={s.targetLine}>{row.target}</span>
      </div>

      <div className={s.growthCell}>
        <span className={s.growth} data-risk={row.growthRisk}>
          {row.growth}
        </span>
        <span className={s.growthBar} aria-hidden="true">
          <span className={s.growthBase} style={{ width: row.baseW }} />
          <span className={s.growthAdded} style={{ width: row.addW }} />
        </span>
      </div>

      <div className={s.confCell}>
        <ConfidencePips value={row.confidence} size="s" labelTone="muted" />
      </div>

      <div className={s.sinceCell}>
        <span className={s.since} data-stale={row.stale}>
          {row.sinceLabel}
        </span>
        {row.stale ? (
          <button
            type="button"
            className={s.checkIn}
            onClick={(e) => {
              e.stopPropagation();
              useOverlays.getState().openDrawer(row.id);
            }}
          >
            Check in now
          </button>
        ) : null}
      </div>

      <Icon name="arrow_forward" className={s.arrow} />
    </div>
  );
}
