/**
 * The eight app screens, their routes and their chrome metadata (Remi.dc.html SCREENS and
 * the <main> sections). Routes replace the prototype's `screen` state, `dayReq` and
 * `routineReq` tokens (arch-frontend-core §3).
 */

import type { IconName } from '../components/Icon';

export const SCREEN_IDS = ['today', 'notes', 'timeline', 'calendar', 'projects', 'workspace', 'routines', 'transition'] as const;

export type ScreenId = (typeof SCREEN_IDS)[number];

export interface ScreenMeta {
  id: ScreenId;
  /** Nav and palette label. */
  label: string;
  /** The prototype's `data-screen-label` on the screen's <section>. */
  sectionLabel: string;
  /**
   * Section overflow: Notes and Timeline scroll internally ('hidden'); Calendar scrolls
   * vertically only ('y': the redesign's `overflow-y:auto; overflow-x:hidden`).
   */
  overflow: 'auto' | 'hidden' | 'y';
}

export const SCREENS: Readonly<Record<ScreenId, ScreenMeta>> = {
  today: { id: 'today', label: 'Today', sectionLabel: 'Today', overflow: 'auto' },
  notes: { id: 'notes', label: 'Notes', sectionLabel: 'Notes', overflow: 'hidden' },
  timeline: { id: 'timeline', label: 'Timeline', sectionLabel: 'Timeline', overflow: 'hidden' },
  calendar: { id: 'calendar', label: 'Calendar', sectionLabel: 'Calendar', overflow: 'y' },
  projects: { id: 'projects', label: 'Projects', sectionLabel: 'Projects', overflow: 'auto' },
  workspace: { id: 'workspace', label: 'Project workspace', sectionLabel: 'Project workspace', overflow: 'auto' },
  routines: { id: 'routines', label: 'Routines', sectionLabel: 'Routines', overflow: 'auto' },
  transition: { id: 'transition', label: 'Transition', sectionLabel: 'Transition', overflow: 'auto' },
};

/** The seven top-bar tabs, in order (the workspace has no tab; Projects lights up for it). */
export const NAV_ITEMS: readonly { id: Exclude<ScreenId, 'workspace'>; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Today', icon: 'today' },
  { id: 'notes', label: 'Notes', icon: 'notes' },
  { id: 'timeline', label: 'Timeline', icon: 'view_timeline' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar_month' },
  { id: 'projects', label: 'Projects', icon: 'stacks' },
  { id: 'routines', label: 'Routines', icon: 'repeat' },
  { id: 'transition', label: 'Transition', icon: 'arrow_forward' },
];

/** The route's `handle`, which tells ScreenStack which section is active. */
export interface ScreenHandle {
  screen: ScreenId;
}

export function isScreenHandle(value: unknown): value is ScreenHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'screen' in value &&
    typeof value.screen === 'string' &&
    (SCREEN_IDS as readonly string[]).includes(value.screen)
  );
}

const enc = encodeURIComponent;

/** The Settings page's sections; each is an anchor (`/settings#rotation`). */
export type SettingsSection = 'move' | 'day' | 'rotation' | 'ai' | 'appearance';

/** URL builders. Every app URL is made here. */
export const paths = {
  home: () => '/',
  setup: () => '/setup',
  /** `section` opens the page at that section: `/settings#rotation`. */
  settings: (section?: SettingsSection | null) => (section ? `/settings#${section}` : '/settings'),
  today: (day?: string | null) => (day ? `/app/today/${enc(day)}` : '/app/today'),
  notes: (day?: string | null) => (day ? `/app/notes/${enc(day)}` : '/app/notes'),
  timeline: () => '/app/timeline',
  calendar: (month?: string | null, day?: string | null) =>
    `${month ? `/app/calendar/${enc(month)}` : '/app/calendar'}${day ? `?day=${enc(day)}` : ''}`,
  projects: () => '/app/projects',
  project: (projectId: string) => `/app/projects/${enc(projectId)}`,
  /** `focus` deep-links a routine row; `rotation` jumps to the FI rotation block (crit Shell:581). */
  routines: (opts?: { focus?: string; rotation?: boolean }) =>
    `/app/routines${opts?.focus ? `?focus=${enc(opts.focus)}` : ''}${opts?.rotation ? '#rotation' : ''}`,
  transition: () => '/app/transition',
  textbook: (pageId?: string | null) => (pageId ? `/textbook/${enc(pageId)}` : '/textbook'),
  foundations: () => '/foundations',
} as const;

/** The default URL for a screen (no params). */
export function screenPath(id: ScreenId, projectId?: string | null): string {
  switch (id) {
    case 'workspace':
      return projectId ? paths.project(projectId) : paths.projects();
    case 'today':
      return paths.today();
    case 'notes':
      return paths.notes();
    case 'timeline':
      return paths.timeline();
    case 'calendar':
      return paths.calendar();
    case 'projects':
      return paths.projects();
    case 'routines':
      return paths.routines();
    case 'transition':
      return paths.transition();
  }
}

/** The screen a pathname shows, or null outside the app shell. */
export function screenFromPath(pathname: string): ScreenId | null {
  const m = /^\/app\/([^/]+)(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!m) return null;
  const [, first, second] = m;
  if (first === 'projects') return second ? 'workspace' : 'projects';
  if (first === 'workspace') return null;
  return (SCREEN_IDS as readonly string[]).includes(first ?? '') ? (first as ScreenId) : null;
}
