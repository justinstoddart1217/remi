/**
 * `GET /plan`: the one bundle every Control Panel screen reads, and the selectors over it.
 *
 * - **ETag.** The server answers `ETag: "<revision>"`. Refetches send it back as
 *   `If-None-Match`; a 304 returns the cached plan object itself, so nothing re-renders.
 * - **Stable references.** `structuralSharing` keeps every unchanged subtree's identity across
 *   refetches and mutation commits, so persistent nodes animate from their old values
 *   (arch-frontend-core §5). Selectors get the same treatment.
 * - **Day rollover.** The plan refetches when the page becomes visible again
 *   (`visibilitychange`, via TanStack's focus manager) and at `today.nextRolloverAt`, the next
 *   local midnight in the plan's timezone. Once that moment has passed the request goes out
 *   without `If-None-Match`: the revision does not change at midnight, but `today` does. When
 *   `today` moves, every other query is invalidated too (day, month, home, notes …).
 */

import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Query, QueryClient, UseQueryResult } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { useCalendarIndex as useIndexOverDays } from '../../lib/calendar';
import type { CalendarDay, CalendarIndex } from '../../lib/calendar';
import { api, parseApiError, RemiApiError, retryApi, toNetworkError } from '../client';
import type { ApiResult } from '../client';
import { keys } from '../keys';
import type {
  AliasOut,
  CountsOut,
  DayLoadOut,
  FlagsOut,
  MoveOut,
  PlanOut,
  ProjectDomain,
  ProjectOut,
  RotationOut,
  RoutineOut,
  SettingsOut,
  TodayOut,
  VerdictOut,
} from '../types';
import { calendarRangeQuery } from './calendar';

/** Refetch this long after `nextRolloverAt`, so the server is surely on the new day. */
export const ROLLOVER_SLACK_MS = 1_000;
/** Never poll faster than this while waiting for a rollover that has already passed. */
export const ROLLOVER_RETRY_MS = 60_000;
/** setTimeout's ceiling (about 24.8 days). */
const MAX_TIMER_MS = 2_147_483_647;

// ---------------------------------------------------------------------------------------------
// Fetching

const etags = new WeakMap<QueryClient, { revision: number; etag: string }>();

/** The `If-None-Match` value for the cached plan: the server's ETag, else `"<revision>"`. */
export function planEtag(queryClient: QueryClient, plan: PlanOut): string {
  const stored = etags.get(queryClient);
  return stored?.revision === plan.revision ? stored.etag : `"${String(plan.revision)}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A cheap shape check, so a stray body (a stub, a proxy page) never reaches the selectors. */
export function isPlanOut(body: unknown): body is PlanOut {
  if (!isRecord(body)) return false;
  const { revision, today, calendar, projects, routines, move, verdict } = body;
  return (
    typeof revision === 'number' &&
    isRecord(today) &&
    typeof today.iso === 'string' &&
    isRecord(calendar) &&
    Array.isArray(calendar.days) &&
    Array.isArray(projects) &&
    Array.isArray(routines) &&
    isRecord(move) &&
    isRecord(verdict)
  );
}

/**
 * Epoch ms of the next local midnight in `timeZone` after `now`. Only a fallback: the server
 * sends `today.nextRolloverAt`.
 */
export function nextMidnightIn(timeZone: string, now: number = Date.now()): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(now));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 'NaN');
    const elapsed = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + (now % 1000);
    if (!Number.isFinite(elapsed)) return null;
    return now + 86_400_000 - elapsed;
  } catch {
    return null;
  }
}

/** Epoch ms when the plan's day ends: `today.nextRolloverAt`, else midnight in `today.tz`. */
export function rolloverAt(today: TodayOut, now: number = Date.now()): number | null {
  const at = Date.parse(today.nextRolloverAt);
  return Number.isNaN(at) ? nextMidnightIn(today.tz, now) : at;
}

/** True once the cached plan's day is over. */
export function hasRolledOver(plan: PlanOut, now: number = Date.now()): boolean {
  const at = rolloverAt(plan.today, now);
  return at !== null && now >= at;
}

/** How long until the rollover refetch; `false` when there is no plan yet. */
export function rolloverDelay(plan: PlanOut | undefined, now: number = Date.now()): number | false {
  if (!plan) return false;
  const at = rolloverAt(plan.today, now);
  if (at === null) return false;
  const ms = at - now + ROLLOVER_SLACK_MS;
  return Math.min(ms > 0 ? ms : ROLLOVER_RETRY_MS, MAX_TIMER_MS);
}

/** Marks everything but the plan stale: a new day changes every read model. */
export function invalidateDayScoped(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== keys.plan[0] });
}

async function requestPlan(signal: AbortSignal | undefined, ifNoneMatch: string | null): Promise<ApiResult<PlanOut>> {
  try {
    return await api.GET('/plan', {
      signal,
      // We manage revalidation ourselves; the browser's HTTP cache must not answer for us.
      cache: 'no-store',
      ...(ifNoneMatch ? { params: { header: { 'If-None-Match': ifNoneMatch } } } : {}),
    });
  } catch (error) {
    throw toNetworkError(error);
  }
}

/**
 * Fetches the plan, conditionally when a same-day plan is cached. Resolves to the cached
 * object on 304. Throws `RemiApiError` (409 `SETUP_REQUIRED` before setup).
 */
export async function fetchPlan(queryClient: QueryClient, signal?: AbortSignal): Promise<PlanOut> {
  const cached = queryClient.getQueryData<PlanOut>(keys.plan);
  const conditional = cached !== undefined && !hasRolledOver(cached);
  let result = await requestPlan(signal, conditional ? planEtag(queryClient, cached) : null);

  if (result.response.status === 304) {
    const current = queryClient.getQueryData<PlanOut>(keys.plan);
    if (current !== undefined) return current;
    // The cache was cleared while we asked: ask again without the condition.
    result = await requestPlan(signal, null);
  }

  const { response } = result;
  if (!response.ok) throw parseApiError(response.status, result.error, response.statusText);
  const plan = result.data;
  if (!isPlanOut(plan)) {
    throw new RemiApiError({ status: response.status, code: 'BAD_RESPONSE', message: 'The plan came back in an unexpected shape.' });
  }

  const etag = response.headers.get('ETag');
  if (etag) etags.set(queryClient, { revision: plan.revision, etag });
  if (cached !== undefined && cached.today.iso !== plan.today.iso) {
    // A new day: refresh the other read models once this plan is in the cache.
    queueMicrotask(() => {
      void invalidateDayScoped(queryClient);
    });
  }
  return plan;
}

/** Query options for `GET /plan` (also used by prefetches and mutation commits). */
export function planQueryOptions(queryClient: QueryClient) {
  return queryOptions<PlanOut, RemiApiError, PlanOut, typeof keys.plan>({
    queryKey: keys.plan,
    queryFn: ({ signal }) => fetchPlan(queryClient, signal),
    structuralSharing: true,
    // Coming back to the tab always revalidates; with the ETag that is one cheap 304.
    refetchOnWindowFocus: 'always',
    refetchInterval: (query: Query<PlanOut, RemiApiError, PlanOut, typeof keys.plan>) => rolloverDelay(query.state.data),
    retry: retryApi,
  });
}

// ---------------------------------------------------------------------------------------------
// Hooks

/** The whole plan query. Before setup it fails with 409 `SETUP_REQUIRED`. */
export function usePlan(): UseQueryResult<PlanOut, RemiApiError> {
  const queryClient = useQueryClient();
  return useQuery(planQueryOptions(queryClient));
}

/**
 * A slice of the plan. `select` should be stable (module level or `useCallback`); its result is
 * structurally shared, so equal slices keep their identity across refetches.
 */
export function usePlanSelect<T>(select: (plan: PlanOut) => T): UseQueryResult<T, RemiApiError> {
  const queryClient = useQueryClient();
  return useQuery({ ...planQueryOptions(queryClient), select });
}

// Selectors return `undefined` until the plan has been read: while it loads, before setup
// (409 SETUP_REQUIRED) and when it cannot be read (500, NETWORK_ERROR …). An empty list or
// `null` therefore always means the plan really is empty, never "no answer". Screens tell the
// three no-data cases apart with `usePlanStatus()` (or `usePlan()`), and show start-empty copy
// only for a plan that was actually read.

export type PlanStatus = 'ready' | 'loading' | 'setup' | 'error';

/**
 * Where the plan read stands. Data wins: a background refetch that fails keeps the last plan
 * on screen, so it stays `ready`.
 */
export function planStatusOf(query: { data?: unknown; error: RemiApiError | null }): PlanStatus {
  if (query.data !== undefined) return 'ready';
  if (query.error) return query.error.code === 'SETUP_REQUIRED' ? 'setup' : 'error';
  return 'loading';
}

export interface PlanStatusResult {
  status: PlanStatus;
  /** The read's error while there is no plan to show, else null. */
  error: RemiApiError | null;
  /** Refetches the plan (a Retry button). */
  refetch: () => void;
}

const selectPresent = (): true => true;

/**
 * The plan read's status, without re-rendering when the plan's contents change. Use it next to
 * the selectors: `undefined` from a selector is `loading`, `setup` or `error` here.
 */
export function usePlanStatus(): PlanStatusResult {
  const query = usePlanSelect(selectPresent);
  const status = planStatusOf(query);
  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  return { status, error: status === 'ready' ? null : query.error, refetch: retry };
}

const selectProjects = (p: PlanOut) => p.projects;
const selectRoutines = (p: PlanOut) => p.routines;
const selectRotation = (p: PlanOut) => p.rotation;
const selectVerdict = (p: PlanOut) => p.verdict;
const selectLoads = (p: PlanOut) => p.loads;
const selectToday = (p: PlanOut) => p.today;
const selectMove = (p: PlanOut) => p.move;
const selectSettings = (p: PlanOut) => p.settings;
const selectCounts = (p: PlanOut) => p.counts;
const selectFlags = (p: PlanOut) => p.flags;
const selectAliases = (p: PlanOut) => p.aliases;
const selectCalendar = (p: PlanOut) => p.calendar;

/** One project: `null` for an id the plan does not have; `undefined` until the plan is read. */
export function useProject(projectId: string | null | undefined): ProjectOut | null | undefined {
  const select = useCallback((p: PlanOut) => p.projects.find((x) => x.id === projectId) ?? null, [projectId]);
  return usePlanSelect(select).data;
}

/**
 * The plan's projects (PC first, then FI, each in sort order), optionally one domain.
 * `undefined` until the plan is read; `[]` only when the plan really has none.
 */
export function useProjects(domain?: ProjectDomain): readonly ProjectOut[] | undefined {
  const select = useCallback(
    (p: PlanOut) => (domain ? p.projects.filter((x) => x.domain === domain) : selectProjects(p)),
    [domain],
  );
  return usePlanSelect(select).data;
}

/** The plan's routines; `undefined` until the plan is read. */
export function useRoutines(): readonly RoutineOut[] | undefined {
  return usePlanSelect(selectRoutines).data;
}

/** One routine: `null` for an id the plan does not have; `undefined` until the plan is read. */
export function useRoutine(routineId: string | null | undefined): RoutineOut | null | undefined {
  const select = useCallback((p: PlanOut) => p.routines.find((x) => x.id === routineId) ?? null, [routineId]);
  return usePlanSelect(select).data;
}

/** The Fixed Income rotation and its derived schedule; `undefined` until the plan is read. */
export function useRotation(): RotationOut | undefined {
  return usePlanSelect(selectRotation).data;
}

/** The move verdict (`state`, buffer, key run …); `undefined` until the plan is read. */
export function useVerdict(): VerdictOut | undefined {
  return usePlanSelect(selectVerdict).data;
}

/** Loads per business day, keyed by ISO date; `undefined` until the plan is read. */
export function useLoads(): Readonly<Record<string, DayLoadOut>> | undefined {
  return usePlanSelect(selectLoads).data;
}

/** Today as the server sees it (business timezone, or `REMI_TODAY`). */
export function useToday(): TodayOut | undefined {
  return usePlanSelect(selectToday).data;
}

/** The move: date, countdown, remaining business days, flags. */
export function useMove(): MoveOut | undefined {
  return usePlanSelect(selectMove).data;
}

/** Settings as embedded in the plan. */
export function usePlanSettings(): SettingsOut | undefined {
  return usePlanSelect(selectSettings).data;
}

export function useCounts(): CountsOut | undefined {
  return usePlanSelect(selectCounts).data;
}

export function useFlags(): FlagsOut | undefined {
  return usePlanSelect(selectFlags).data;
}

/** Stored aliases (names and short names always match too); `undefined` until the plan is read. */
export function usePlanAliases(): readonly AliasOut[] | undefined {
  return usePlanSelect(selectAliases).data;
}

export interface CalendarRange {
  from: string;
  to: string;
}

function covers(days: readonly CalendarDay[], range: CalendarRange): boolean {
  const first = days[0];
  const last = days[days.length - 1];
  return first !== undefined && last !== undefined && first.iso <= range.from && last.iso >= range.to;
}

function mergeDays(base: readonly CalendarDay[], extra: readonly CalendarDay[] | undefined): readonly CalendarDay[] {
  if (!extra || extra.length === 0) return base;
  const byIso = new Map<string, CalendarDay>();
  for (const d of extra) byIso.set(d.iso, d);
  for (const d of base) byIso.set(d.iso, d);
  return [...byIso.values()].sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
}

const EMPTY_DAYS: readonly CalendarDay[] = [];

/**
 * A memoised `CalendarIndex` over `plan.calendar.days`, or `undefined` until the plan is read.
 * Pass `range` when a screen needs days outside the plan window (Calendar months after the
 * move): those are fetched from `GET /calendar` in the plan's holiday region and merged in.
 * Lookups outside every fetched day still return null (never clamped).
 */
export function useCalendarIndex(range?: CalendarRange | null): CalendarIndex | undefined {
  const calendar = usePlanSelect(selectCalendar).data;
  const days = calendar?.days ?? EMPTY_DAYS;
  const needsMore = range != null && calendar !== undefined && !covers(days, range);
  const extra = useQuery({
    ...calendarRangeQuery({ from: range?.from, to: range?.to, holidayRegion: calendar?.region }),
    enabled: needsMore,
  });
  const extraDays = needsMore ? extra.data?.days : undefined;
  const merged = useMemo(() => mergeDays(days, extraDays), [days, extraDays]);
  const index = useIndexOverDays(merged);
  return calendar === undefined ? undefined : index;
}
