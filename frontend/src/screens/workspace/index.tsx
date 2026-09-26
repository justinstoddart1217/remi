import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { useCalendarIndex, usePlanStatus, useProject, useToday } from '../../api';
import { useScreenRoute, useWorkspaceProjectId } from '../../app/screenLocation';
import { paths } from '../../app/screens';
import { Button, EmptyState } from '../../components';
import { useIsActiveScreen } from '../../lib/arrival';
import { WORKSPACE_FOCUS_PARAM } from './focus';
import { Workspace } from './Workspace';
import s from './Workspace.module.css';

/**
 * The Project workspace (Workspace.dc.html), `/app/projects/:projectId`. It stays mounted in
 * ScreenStack's "Project workspace" section. An id the plan does not have redirects to the
 * Projects list (arch-frontend-screens, workspace); `?focus=goal` (after "+ New project")
 * focuses the goal once and is removed from the URL.
 */
export default function WorkspaceScreen() {
  const active = useIsActiveScreen();
  const route = useScreenRoute();
  const lastId = useWorkspaceProjectId();
  // The live route's id while active: the shell records `lastWorkspaceId` in an effect, one
  // render late, and the card → workspace transition snapshots this very render.
  const projectId = (active ? route.params.projectId : undefined) ?? lastId;
  const navigate = useNavigate();
  const { status, error, refetch } = usePlanStatus();
  const project = useProject(projectId);
  const today = useToday()?.iso;
  const cal = useCalendarIndex();
  const wantsGoal = active && route.searchParams.get(WORKSPACE_FOCUS_PARAM) === 'goal';
  // The focus request is latched per navigation, so stripping it from the URL keeps it.
  const [focusFor, setFocusFor] = useState<{ key: string; id: string } | null>(null);
  if (wantsGoal && projectId && focusFor?.key !== route.key) setFocusFor({ key: route.key, id: projectId });

  useEffect(() => {
    if (active && status === 'ready' && project === null) void navigate(paths.projects(), { replace: true });
  }, [active, status, project, navigate]);

  useEffect(() => {
    if (wantsGoal && projectId) void navigate(paths.project(projectId), { replace: true });
  }, [wantsGoal, projectId, navigate]);

  if (status === 'error') {
    return (
      <div className={s.root}>
        <h1 className={s.srTitle} tabIndex={-1} aria-label="Project workspace" />
        <div className={s.status}>
          <EmptyState>Remi couldn’t read this project. {error?.message}</EmptyState>
          <Button variant="raised" size="s" onClick={refetch}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!project || !today || !cal) {
    return (
      <div className={s.root} aria-busy={status === 'loading' || undefined}>
        <h1 className={s.srTitle} tabIndex={-1} aria-label="Project workspace" />
      </div>
    );
  }
  return (
    <Workspace
      key={project.id}
      project={project}
      today={today}
      cal={cal}
      goalFocusRequest={focusFor?.id === project.id ? focusFor.key : null}
      onBack={() => {
        void navigate(paths.projects());
      }}
    />
  );
}
