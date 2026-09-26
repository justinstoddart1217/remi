import type { ComponentType } from 'react';

import type { ScreenId } from '../../app/screens';
import CalendarScreen from '../../screens/calendar';
import NotesScreen from '../../screens/notes';
import ProjectsScreen from '../../screens/projects';
import RoutinesScreen from '../../screens/routines';
import TimelineScreen from '../../screens/timeline';
import TodayScreen from '../../screens/today';
import TransitionScreen from '../../screens/transition';
import WorkspaceScreen from '../../screens/workspace';

/**
 * The eight app screens. Each `src/screens/<id>/index.tsx` default-exports a component with
 * no props; it reads its route through `useScreenRoute()` and its activity through
 * `useIsActiveScreen()` / `useArrival()`.
 */
export const SCREEN_COMPONENTS: Readonly<Record<ScreenId, ComponentType>> = {
  today: TodayScreen,
  notes: NotesScreen,
  timeline: TimelineScreen,
  calendar: CalendarScreen,
  projects: ProjectsScreen,
  workspace: WorkspaceScreen,
  routines: RoutinesScreen,
  transition: TransitionScreen,
};
