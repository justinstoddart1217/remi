/**
 * A small, typed fixture plan for unit tests: today Mon 5 Oct 2026 (BD3), the move on
 * Mon 4 Jan 2027 (61 business days away), one Private Credit project (the returns pipeline,
 * late by 3 BD, clear of the move by 19) and its monthly routine. Verdict "Move on track,
 * narrowly". Business-day counts come from the fixture calendar, never typed in.
 *
 * The full design sample data lives in the backend fixture (`POST /api/dev/fixtures`); this
 * is only enough plan for the API layer and shell tests. Builders take overrides so a test
 * can say exactly what differs.
 */

import type {
  AiStatusOut,
  DayLoadOut,
  HomeOut,
  MoveOut,
  Movement,
  PlanMutationOut,
  PlanOut,
  ProjectDerivedOut,
  ProjectOut,
  RotationOut,
  RoutineOut,
  SettingsOut,
  SetupStatusOut,
} from '../../api/types';
import { CalendarIndex } from '../../lib/calendar';
import { buildCalendarDays, FIXTURE_MOVE, FIXTURE_TODAY } from '../fixtures/calendar';

export { FIXTURE_MOVE, FIXTURE_TODAY };

const STAMP = '2026-10-02T09:30:00+01:00';

export const FIXTURE_CALENDAR_FROM = '2026-09-21';
export const FIXTURE_CALENDAR_TO = '2027-01-31';

/** The returns pipeline's target and forecast: it lands 3 BD late. */
const RET_TARGET = '2026-11-27';
const RET_FORECAST = '2026-12-02';
/** The key routine's last run before the move (BD3 of December). */
const KEY_RUN = '2026-12-03';

let calendarIndex: CalendarIndex | null = null;

/**
 * Business-day counts from the fixture's own calendar (holidays included), so the plan's
 * numbers agree with its `calendar.days` and never have to be typed in by hand.
 */
function fixtureCalendar(): CalendarIndex {
  calendarIndex ??= new CalendarIndex(buildCalendarDays(FIXTURE_CALENDAR_FROM, FIXTURE_CALENDAR_TO));
  return calendarIndex;
}

function counted(value: number | null, what: string): number {
  if (value === null) throw new Error(`fixture: ${what} is outside the fixture calendar`);
  return value;
}

/** Business days strictly between `a` and `b` (the engine's `bd_between`). */
function bdBetween(a: string, b: string): number {
  return counted(fixtureCalendar().bdBetween(a, b), `${a}..${b}`);
}

/** Signed business days from `a` to `b` (the engine's `bd_diff`). */
function bdDiff(a: string, b: string): number {
  return counted(fixtureCalendar().bdDiff(a, b), `${a}→${b}`);
}

export function fixtureSettings(overrides: Partial<SettingsOut> = {}): SettingsOut {
  return {
    setupComplete: true,
    setupCompletedAt: '2026-09-01T09:00:00+01:00',
    moveDate: FIXTURE_MOVE,
    moveTaper: 'hard',
    capacityHoursPerDay: 8,
    timezone: 'Europe/London',
    holidayRegion: 'GB-ENG',
    staleThresholdDays: 7,
    overloadLookaheadBd: 10,
    newProjectHorizonBd: 20,
    nowMsOffsetBd: 5,
    nextMsOffsetBd: 10,
    keyProjectId: 'ret',
    keyRoutineId: 'r-ret',
    keyRunDateOverride: null,
    motionPreference: 'system',
    accentPc: '#009D80',
    accentFi: '#2F6B9A',
    serifDisplay: true,
    aiProvider: 'none',
    aiModel: null,
    aiSendRecentNotes: false,
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    aiKeyConfigured: false,
    uiPrefs: { collapsedPageIds: [], lastTextbookPageId: null, textbookSidebarOpen: true, timelineZoom: '3m' },
    updatedAt: STAMP,
    ...overrides,
  };
}

export function fixtureAiStatus(overrides: Partial<AiStatusOut> = {}): AiStatusOut {
  return {
    provider: 'none',
    available: true,
    egress: false,
    keySet: false,
    keySource: null,
    model: null,
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    reason: null,
    sdkInstalled: false,
    sendsNotes: false,
    ...overrides,
  };
}

export function fixtureSetupStatus(overrides: Partial<SetupStatusOut> = {}): SetupStatusOut {
  return {
    needsSetup: false,
    missing: [],
    today: FIXTURE_TODAY,
    ai: fixtureAiStatus(),
    defaults: {
      aiProvider: 'none',
      capacityHoursPerDay: 8,
      holidayRegion: 'GB-ENG',
      rotationHoursPerDay: 4,
      timezone: 'Europe/London',
    },
    regions: [
      { code: 'GB-ENG', label: 'England and Wales' },
      { code: 'ZA', label: 'South Africa' },
    ],
    ...overrides,
  };
}

function fixtureProjectDerived(overrides: Partial<ProjectDerivedOut> = {}): ProjectDerivedOut {
  return {
    status: 'risk',
    deltaBd: bdDiff(RET_TARGET, RET_FORECAST),
    planFrom: FIXTURE_TODAY,
    sinceDays: 3,
    stale: false,
    started: true,
    addedH: 0,
    growthPct: 0,
    workLeft: 120,
    workLeftDisplay: 120,
    bdLeft: 42,
    bdToTarget: 39,
    totalBd: 66,
    doneBd: 24,
    progressPct: 36,
    need: { rate: 3.8, state: 'ok' },
    avgPlan: 3,
    // bd_diff(forecast, target): negative, the project is late.
    bufferBd: bdDiff(RET_FORECAST, RET_TARGET),
    absorbH: null,
    cutH: null,
    cutBeforeMoveH: null,
    landsAfterMove: false,
    startsInBd: null,
    overDays: [],
    nowEstimateH: 0,
    readinessPct: null,
    sentence: {
      case: 'late',
      // The `late` case sends no buffer and no move date (services/views.py sentence_out).
      params: {
        bufferBd: null,
        cutH: null,
        firstOverDay: null,
        lateBd: bdDiff(RET_TARGET, RET_FORECAST),
        moveDate: null,
        needRate: 3.8,
        overDayCount: 0,
        rate: 3,
        scopeH: null,
        staleDays: null,
        startsInBd: null,
        targetDate: RET_TARGET,
        workLeftH: 120,
      },
    },
    milestones: [],
    nextMilestone: null,
    dayHours: {},
    ...overrides,
  };
}

export function fixtureProject(overrides: Partial<ProjectOut> = {}): ProjectOut {
  const { derived, ...rest } = overrides;
  return {
    id: 'ret',
    domain: 'pc',
    name: 'Returns pipeline',
    short: 'returns',
    goal: 'The monthly returns run end to end without me.',
    whyNow: '',
    endName: 'Hand over',
    laterIntent: '',
    phase: 2,
    sortOrder: 0,
    startDate: '2026-09-01',
    targetDate: RET_TARGET,
    targetLabel: null,
    forecastDate: RET_FORECAST,
    prevForecastDate: null,
    rate: 3,
    rateAfterMove: 0,
    baselineHours: 180,
    unplacedH: 0,
    confidence: 3,
    blocker: null,
    readiness: null,
    afterDayOneNote: null,
    exitRoutes: null,
    lastCheckinDate: '2026-10-02',
    bauDayHours: {},
    overrides: {},
    charter: { success: [], inScope: [], outScope: [], constraints: [] },
    milestones: [],
    readinessItems: [],
    scopeChanges: [],
    risks: [],
    checklists: [],
    createdAt: '2026-09-01T09:00:00+01:00',
    updatedAt: STAMP,
    derived: fixtureProjectDerived(derived),
    ...rest,
  };
}

export function fixtureRoutine(overrides: Partial<RoutineOut> = {}): RoutineOut {
  return {
    id: 'r-ret',
    domain: 'pc',
    name: 'Monthly returns run',
    short: 'Returns',
    label: null,
    detail: '',
    hours: 6,
    rule: { kind: 'monthly', bd: 3, weekday: 1 },
    projectId: 'ret',
    coTagWithProject: true,
    stage: 0,
    statusNote: '',
    transitionNote: null,
    sortOrder: 0,
    checklistItems: [],
    createdAt: '2026-09-01T09:00:00+01:00',
    updatedAt: STAMP,
    derived: {
      countsToday: true,
      runsToday: true,
      handedOver: false,
      lastBeforeMove: '2026-12-03',
      monthlyEffortApprox: false,
      monthlyEffortH: 6,
      next: [
        { iso: '2026-10-05', bdm: 3, bdAway: 0, today: true, afterMove: false },
        { iso: '2026-11-04', bdm: 3, bdAway: 22, today: false, afterMove: false },
        { iso: '2026-12-03', bdm: 3, bdAway: 43, today: false, afterMove: false },
      ],
      occurrences: ['2026-10-05', '2026-11-04', '2026-12-03'],
      todayRun: null,
    },
    ...overrides,
  };
}

export function fixtureRotation(overrides: Partial<RotationOut> = {}): RotationOut {
  return {
    id: 'rotation',
    domain: 'fi',
    title: 'Fixed Income rotation',
    hoursPerDay: 4,
    startDate: null,
    startFollowsMove: true,
    segments: [],
    loopBd: 0,
    loopEnd: null,
    refresh: null,
    totalBd: 0,
    current: { status: 'none', order: null, segmentId: null, bdToStart: null },
    updatedAt: null,
    ...overrides,
  };
}

function load(bau: number, proj: number, capacity = 8): DayLoadOut {
  const total = bau + proj;
  return {
    items: [
      { refType: 'routine', refId: 'r-ret', domain: 'pc', h: bau, name: 'Monthly returns run' },
      { refType: 'project', refId: 'ret', domain: 'pc', h: proj, name: 'Returns pipeline' },
    ].filter((item) => item.h > 0) as DayLoadOut['items'],
    bau,
    proj,
    total,
    free: Math.max(0, capacity - total),
    capacity,
    over: total > capacity,
  };
}

type MoveFlag = MoveOut['flags'][number];

/** Label lift and stick height by sorted index parity (engine `FLAG_LIFT_PX`, `FLAG_STICK_PX`). */
const FLAG_LIFT_PX = [2, 18] as const;
const FLAG_STICK_PX = [10, 26] as const;

/**
 * The Transition strip as the engine builds it (`move_strip`): one block per business day
 * strictly between today and the move, and the flags sorted by the boundary they stand on.
 */
export function fixtureMove(): MoveOut {
  const cal = fixtureCalendar();
  const days = cal.businessDays(FIXTURE_TODAY, FIXTURE_MOVE);
  if (days === null) throw new Error('fixture: the move is outside the fixture calendar');
  const remaining = days
    .filter((iso) => iso > FIXTURE_TODAY && iso < FIXTURE_MOVE)
    .map((iso) => ({ iso, bdm: cal.bdOfMonth(iso) ?? 0, pcRunning: iso <= RET_FORECAST }));
  const rem = remaining.map((d) => d.iso);
  const placed: Omit<MoveFlag, 'index' | 'liftPx' | 'stickPx'>[] = [
    // A project stands after its forecast day's block; the key run before its own block.
    { kind: 'project', projectId: 'ret', iso: RET_FORECAST, atRisk: true, slot: rem.filter((d) => d <= RET_FORECAST).length },
    { kind: 'key_run', projectId: null, iso: KEY_RUN, atRisk: false, slot: rem.filter((d) => d < KEY_RUN).length },
    { kind: 'move', projectId: null, iso: FIXTURE_MOVE, atRisk: false, slot: rem.length },
  ];
  // Array.prototype.sort is stable: ties keep this order (projects, key run, move).
  placed.sort((a, b) => a.slot - b.slot);
  const flags = placed.map((f, index) => ({
    ...f,
    index,
    liftPx: FLAG_LIFT_PX[index % 2] ?? FLAG_LIFT_PX[0],
    stickPx: FLAG_STICK_PX[index % 2] ?? FLAG_STICK_PX[0],
  }));
  return { date: FIXTURE_MOVE, countdownBd: bdBetween(FIXTURE_TODAY, FIXTURE_MOVE), remaining, flags };
}

/** The fixture plan. `revision` is the ETag; `today.nextRolloverAt` is Tue 6 Oct 00:00 BST. */
export function fixturePlan(overrides: Partial<PlanOut> = {}): PlanOut {
  const settings = fixtureSettings();
  return {
    revision: 1,
    today: {
      iso: FIXTURE_TODAY,
      tz: 'Europe/London',
      overridden: true,
      w: 1,
      isBd: true,
      bdm: 3,
      monthBds: 22,
      nextRolloverAt: '2026-10-06T00:00:00+01:00',
    },
    settings,
    calendar: {
      from: FIXTURE_CALENDAR_FROM,
      to: FIXTURE_CALENDAR_TO,
      region: 'GB-ENG',
      days: buildCalendarDays(FIXTURE_CALENDAR_FROM, FIXTURE_CALENDAR_TO),
    },
    loads: {
      '2026-10-05': load(6, 2),
      '2026-11-04': load(6, 3.5),
    },
    projects: [fixtureProject()],
    routines: [fixtureRoutine()],
    rotation: fixtureRotation(),
    move: fixtureMove(),
    verdict: {
      state: 'on_track_narrowly',
      // bd_between(last PC exit, move): 19, with 25 and 28 Dec and 1 Jan off.
      bufferBd: bdBetween(RET_FORECAST, FIXTURE_MOVE),
      lastPcExit: RET_FORECAST,
      keyProjectId: 'ret',
      keyRun: KEY_RUN,
      toRunBd: bdDiff(RET_FORECAST, KEY_RUN),
      anyRisk: true,
    },
    flags: {
      upcomingOverloads: [{ iso: '2026-11-04', bdm: 3, total: 9.5, overBy: 1.5 }],
      attention: [],
      promptProjectId: null,
      nextDueProjectId: 'ret',
    },
    aliases: [],
    counts: { projects: 1, routines: 1, notesTotal: 0, noteDays: 0, notesToday: 0, recentNotes: 0 },
    ...overrides,
  };
}

/** A copy of `plan` one revision on, with `ret`'s forecast moved (what a +6h scope does). */
export function fixturePlanAfterScope(plan: PlanOut = fixturePlan()): PlanOut {
  return {
    ...plan,
    revision: plan.revision + 1,
    projects: plan.projects.map((p) =>
      p.id === 'ret'
        ? {
            ...p,
            prevForecastDate: p.forecastDate,
            forecastDate: '2026-12-07',
            derived: { ...p.derived, deltaBd: 6 },
          }
        : p,
    ),
  };
}

export function fixtureMovement(overrides: Partial<Movement> = {}): Movement {
  return {
    projectId: 'ret',
    fromForecast: '2026-12-02',
    toForecast: '2026-12-07',
    deltaBd: 3,
    fromTarget: '2026-11-27',
    toTarget: '2026-11-27',
    cause: 'checkin',
    label: '+3 BD',
    flash: true,
    moved: true,
    ...overrides,
  };
}

export function fixtureMutationOut(plan: PlanOut, movements: Movement[] = []): PlanMutationOut {
  return { plan, movements };
}

export function fixtureHome(overrides: Partial<HomeOut> = {}): HomeOut {
  return {
    needsSetup: false,
    today: FIXTURE_TODAY,
    isBd: true,
    bdm: 3,
    moveDate: FIXTURE_MOVE,
    countdownBd: bdBetween(FIXTURE_TODAY, FIXTURE_MOVE),
    projectCount: 1,
    routineCount: 1,
    notesToday: 0,
    keyProject: {
      id: 'ret',
      name: 'Returns pipeline',
      short: 'returns',
      domain: 'pc',
      status: 'risk',
      forecastDate: RET_FORECAST,
      targetDate: RET_TARGET,
      deltaBd: bdDiff(RET_TARGET, RET_FORECAST),
    },
    textbook: { pages: 0, liveCharts: 0 },
    ...overrides,
  };
}
