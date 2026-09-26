/**
 * Query keys. Every key starts with its resource root, so invalidating a root (`keys.notes.all`)
 * reaches every variant under it. Parameter objects are hashed by TanStack Query, so the
 * order of their keys does not matter.
 */

export interface RangeParams {
  from?: string | null;
  to?: string | null;
}

export interface CalendarParams extends RangeParams {
  holidayRegion?: 'GB-ENG' | 'ZA' | null;
}

export interface PageParams {
  limit?: number | null;
  before?: string | null;
}

export interface EventParams {
  since?: number | null;
  limit?: number | null;
}

export interface OccurrenceParams extends RangeParams {
  after?: string | null;
  limit?: number | null;
}

/** `T` with null and undefined dropped from every value. */
export type Compact<T> = { [K in keyof T]?: Exclude<T[K], null | undefined> };

/** Drops null/undefined so `{from: undefined}` and `{}` share a cache entry and query string. */
export function compact<T extends object>(params: T | undefined): Compact<T> {
  const out: Record<string, unknown> = {};
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) out[k] = v;
    }
  }
  return out as Compact<T>;
}

export const keys = {
  /** GET /plan: the one bundle every Control Panel screen reads. */
  plan: ['plan'] as const,

  setup: {
    all: ['setup'] as const,
    /** GET /setup (SetupGate). */
    status: ['setup', 'status'] as const,
    /** GET /setup/countdown (the wizard's live Roll). */
    countdown: (moveDate: string, holidayRegion?: string | null) =>
      ['setup', 'countdown', moveDate, holidayRegion ?? null] as const,
  },

  settings: ['settings'] as const,

  ai: {
    all: ['ai'] as const,
    status: ['ai', 'status'] as const,
    audit: (params?: PageParams) => ['ai', 'audit', compact(params)] as const,
  },

  health: ['health'] as const,

  calendar: {
    all: ['calendar'] as const,
    range: (params?: CalendarParams) => ['calendar', compact(params)] as const,
  },
  loads: {
    all: ['loads'] as const,
    range: (params?: RangeParams) => ['loads', compact(params)] as const,
  },
  holidays: {
    all: ['holidays'] as const,
    range: (params?: RangeParams) => ['holidays', compact(params)] as const,
  },
  leave: {
    all: ['leave'] as const,
    range: (params?: RangeParams) => ['leave', compact(params)] as const,
  },

  /** GET /day/{iso}. */
  day: {
    all: ['day'] as const,
    detail: (iso: string) => ['day', iso] as const,
  },
  /** GET /month-snapshot?month= (null: today's month). */
  monthSnapshot: {
    all: ['month-snapshot'] as const,
    detail: (month?: string | null) => ['month-snapshot', month ?? null] as const,
  },
  /** GET /home. */
  home: ['home'] as const,

  projects: {
    all: ['projects'] as const,
    list: ['projects', 'list'] as const,
    detail: (projectId: string) => ['projects', 'detail', projectId] as const,
    snapshots: (projectId: string) => ['projects', 'snapshots', projectId] as const,
    replanPreview: (projectId: string, input: object) => ['projects', 'replan-preview', projectId, input] as const,
  },

  routines: {
    all: ['routines'] as const,
    list: ['routines', 'list'] as const,
    detail: (routineId: string) => ['routines', 'detail', routineId] as const,
    occurrences: (routineId: string, params?: OccurrenceParams) =>
      ['routines', 'occurrences', routineId, compact(params)] as const,
  },

  rotation: ['rotation'] as const,

  checkins: {
    all: ['checkins'] as const,
    preview: (changes: readonly object[]) => ['checkins', 'preview', changes] as const,
  },

  notes: {
    all: ['notes'] as const,
    days: (params?: RangeParams) => ['notes', 'days', compact(params)] as const,
    day: (day: string) => ['notes', 'day', day] as const,
    recent: (businessDays?: number | null) => ['notes', 'recent', businessDays ?? null] as const,
    dayText: (day: string) => ['notes', 'day-text', day] as const,
    tags: (text: string) => ['notes', 'tags', text] as const,
  },

  textbook: {
    all: ['textbook'] as const,
    tree: ['textbook', 'tree'] as const,
    home: ['textbook', 'home'] as const,
    pages: ['textbook', 'page'] as const,
    page: (pageId: string) => ['textbook', 'page', pageId] as const,
    searches: ['textbook', 'search'] as const,
    search: (q: string) => ['textbook', 'search', q] as const,
  },

  feed: {
    all: ['feed'] as const,
    page: (params?: PageParams) => ['feed', compact(params)] as const,
  },
  events: {
    all: ['events'] as const,
    page: (params?: EventParams) => ['events', compact(params)] as const,
  },
  aliases: ['aliases'] as const,
} as const;
