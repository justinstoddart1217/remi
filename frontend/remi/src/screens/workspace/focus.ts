/**
 * `/app/projects/<id>?focus=goal` opens the workspace with the goal sentence focused (the
 * prototype's `focusGoal`, set when a project is created). The workspace consumes the
 * parameter once and removes it from the URL.
 */
export const WORKSPACE_FOCUS_PARAM = 'focus';

/** The workspace URL that focuses the goal: used after creating a project. */
export function workspaceGoalPath(projectPath: string): string {
  return `${projectPath}?${WORKSPACE_FOCUS_PARAM}=goal`;
}
