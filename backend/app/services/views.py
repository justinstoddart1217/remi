"""Read models: the ``GET /plan`` bundle and the parameterised reads built on it.

``get_plan_state`` loads everything in one read-only unit of work, adapts it to the engine and
derives every number the Control Panel shows. The result is cached per database by
``(revision, today)``, where the revision is the ``seq`` of the latest event that can change the
plan: every mutation records an event, so the next read recomputes, except for the event types
in ``PLAN_NEUTRAL_EVENTS`` (Textbook edits and note text edits, which the bundle does not
show), so typing in the Textbook or a note never invalidates the plan or its ``ETag``. The AI
key is not in the database, so the key endpoints drop the cache themselves
(``invalidate_plan_cache``).

Reads that need the move date raise ``SetupRequired`` (409) until setup completes. When the
engine runs out of calendar (``OutOfCalendar``) the covered years are widened, their holidays
generated (a ``system`` unit of work, one ``holidays.generated`` event) and the read retried, up
to the horizon (``OUT_OF_RANGE`` past it). A day a read asks about must be within ten years of
today (``calendar.read_span``); the plan's own dates may widen the calendar further.

The other reads (``day_view``, ``month_snapshot_view``, ``home_view``, ``calendar_view``,
``loads_view``, ``holidays_view``, ``project_snapshots``) reuse the cached plan state.
"""

import datetime as dt
import threading
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Final, cast
from weakref import WeakKeyDictionary
from zoneinfo import ZoneInfo

from app.core.clock import Clock, clock_overridden, resolve_zone
from app.core.errors import OutOfRange, SetupRequired, ValidationFailed
from app.core.uow import UnitOfWork, UnitOfWorkFactory
from app.repositories import models as orm
from app.repositories.registry import (
    ALIASES,
    EVENTS,
    HOLIDAYS,
    LEAVE,
    NOTES,
    PROJECTS,
    ROTATION,
    ROUTINES,
    SETTINGS,
    TEXTBOOK,
)
from app.schemas.aliases import AliasOut
from app.schemas.calendar import (
    CalendarDayOut,
    CalendarOut,
    DayLoadItemOut,
    DayLoadOut,
    HolidayOut,
    LeaveDayOut,
    LoadsOut,
)
from app.schemas.day import (
    BauChecklistItemOut,
    BauRotationOut,
    BauRowOut,
    DayOut,
    FocusBlockOut,
    FocusMilestoneOut,
    FocusTaskOut,
    NextRunOut,
)
from app.schemas.home import HomeKeyProjectOut, HomeOut, HomeTextbookOut
from app.schemas.month import (
    MonthSnapshotBarOut,
    MonthSnapshotOut,
    MonthSnapshotRowOut,
    MonthSnapshotTotalsOut,
)
from app.schemas.plan import (
    AttentionItemOut,
    CountsOut,
    FlagsOut,
    MoveFlagOut,
    MoveOut,
    MoveRemainingDayOut,
    PlanOut,
    TodayOut,
    UpcomingOverloadOut,
    VerdictOut,
)
from app.schemas.project import (
    CharterItemOut,
    CharterOut,
    ChecklistItemOut,
    ChecklistOut,
    DerivedMilestoneOut,
    MilestoneOut,
    NeedOut,
    ProjectDerivedOut,
    ProjectOut,
    ProjectSnapshotOut,
    ReadinessItemOut,
    RiskOut,
    ScopeChangeOut,
    SentenceOut,
    SentenceParamsOut,
    SnapshotMilestoneOut,
    TaskOut,
)
from app.schemas.rotation import (
    RotationCurrentOut,
    RotationOut,
    RotationRefreshOut,
    RotationSegmentOut,
)
from app.schemas.routine import (
    OccurrenceOut,
    RoutineChecklistItemOut,
    RoutineDerivedOut,
    RoutineOut,
    RoutineRuleOut,
    RoutineRunOut,
)
from app.schemas.settings import SettingsOut, TimelineZoom, UiPrefsOut
from app.services import holidays
from app.services.adapters import engine_ctx, plan_of, project_of, rotation_of, routine_of
from app.services.calendar import (
    MAX_ATTEMPTS,
    YearSpan,
    build_calendar,
    calendar_for,
    check_in_range,
    check_within_horizon,
    default_span,
    extend_for,
    horizon_year,
    read_span,
    walk_span,
)
from app.services.engine.allocation import (
    RunState,
    focus_tasks,
    month_snapshot,
    next_run_after,
)
from app.services.engine.calendar import BusinessCalendar, OutOfCalendar
from app.services.engine.derive import DerivedProject, derive_project
from app.services.engine.flags import Attention, attention, checkin_prompt, upcoming_overloads
from app.services.engine.forecast import plan_from
from app.services.engine.loads import DayLoad, build_loads, plan_window
from app.services.engine.model import EngineCtx, Project, ProjectPlan, RoutineDef
from app.services.engine.rotation import current as rotation_current
from app.services.engine.routines import (
    counts_on,
    last_occurrence_before,
    monthly_effort_h,
    next_occurrences,
    occurs,
)
from app.services.engine.verdict import move_strip, verdict
from app.services.settings_keys_bridge import api_key_configured
from app.utils.dates import add_months, fmt_dm, js_weekday, monday_of, month_end
from app.utils.text import hr1

RECENT_NOTE_BDS: Final = 5
"""Business days of notes Tell Remi may send (``counts.recentNotes``)."""
MAX_RANGE_DAYS: Final = 3 * 366
"""The longest ``from``..``to`` range the calendar, loads and holidays reads accept."""

_ROUND: Final = 6


def _h(x: float) -> float:
    """Hours without float noise (``7.000000000000001`` -> ``7.0``)."""
    return round(x, _ROUND)


# ---------------------------------------------------------------------------- plan state
@dataclass(frozen=True, slots=True)
class RoutineInfo:
    """What the reads need about a routine beyond the engine's ``RoutineDef``."""

    id: str
    name: str
    short: str
    domain: orm.Domain
    stage: int
    project_id: str | None
    checklist: tuple[tuple[str, str], ...]
    """``(item id, label)`` in checklist order."""


@dataclass(frozen=True, slots=True)
class PlanState:
    """The cached plan: the ``PlanOut`` bundle plus the engine inputs behind it."""

    key: tuple[int, dt.date]
    """``(revision, today)``: what the cache is keyed by (the revision is the latest
    plan-affecting event, ``EventRepository.latest_plan_seq``)."""
    span: YearSpan
    out: PlanOut
    ctx: EngineCtx
    plans: tuple[ProjectPlan, ...]
    projects: tuple[Project, ...]
    derived: Mapping[str, DerivedProject]
    loads: Mapping[dt.date, DayLoad]
    window: tuple[dt.date, dt.date]
    region: orm.HolidayRegion
    timezone: str
    routines: Mapping[str, RoutineInfo]
    task_milestone: Mapping[str, str] = field(default_factory=dict[str, str])

    @property
    def revision(self) -> int:
        return self.key[0]

    @property
    def today(self) -> dt.date:
        return self.key[1]

    @property
    def cal(self) -> BusinessCalendar:
        return self.ctx.cal

    def plan(self, project_id: str) -> ProjectPlan | None:
        return next((p for p in self.plans if p.id == project_id), None)

    def project_out(self, project_id: str) -> ProjectOut | None:
        return next((p for p in self.out.projects if p.id == project_id), None)

    def routine_out(self, routine_id: str) -> RoutineOut | None:
        return next((r for r in self.out.routines if r.id == routine_id), None)


class _PlanCache:
    """The latest plan state per database (keyed weakly by its session factory)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._states: WeakKeyDictionary[object, PlanState] = WeakKeyDictionary()

    def get(self, owner: object) -> PlanState | None:
        with self._lock:
            return self._states.get(owner)

    def put(self, owner: object, state: PlanState) -> None:
        with self._lock:
            self._states[owner] = state

    def clear(self, owner: object | None = None) -> None:
        with self._lock:
            if owner is None:
                self._states.clear()
            else:
                self._states.pop(owner, None)


_CACHE = _PlanCache()


def invalidate_plan_cache(uow_factory: UnitOfWorkFactory | None = None) -> None:
    """Drop the cached plan (for changes that record no event, such as the AI key)."""
    _CACHE.clear(None if uow_factory is None else uow_factory.session_factory)


class _NeedSpan(Exception):
    def __init__(self, span: YearSpan) -> None:
        super().__init__(f"needs {span.first}-{span.last}")
        self.span = span


class _NeedHolidays(Exception):
    def __init__(self, region: orm.HolidayRegion) -> None:
        super().__init__(region)
        self.region: orm.HolidayRegion = region


def setup_complete(settings: orm.Settings) -> bool:
    return settings.setup_completed_at is not None and settings.move_date is not None


def require_setup(settings: orm.Settings) -> dt.date:
    """The move date, or ``SetupRequired`` (409) before first-run setup."""
    if not setup_complete(settings) or settings.move_date is None:
        raise SetupRequired
    return settings.move_date


@dataclass(frozen=True, slots=True)
class SettingsInfo:
    """The settings a read needs, copied out of its read-only unit of work."""

    complete: bool
    region: orm.HolidayRegion
    move_date: dt.date | None
    timezone: str


def settings_info(uow_factory: UnitOfWorkFactory) -> SettingsInfo:
    with uow_factory.read() as uow:
        row = uow.repo(SETTINGS).get()
        return SettingsInfo(
            complete=setup_complete(row),
            region=row.holiday_region,
            move_date=row.move_date,
            timezone=row.timezone,
        )


@dataclass(frozen=True, slots=True)
class RunRow:
    """A routine run, copied out of the session."""

    routine_id: str
    occurrence_date: dt.date
    completed_on: dt.date | None
    completed_at: dt.datetime | None


@dataclass(frozen=True, slots=True)
class TickRow:
    """A checklist tick, copied out of the session."""

    routine_id: str
    occurrence_date: dt.date
    item_id: str
    done_at: dt.datetime


def run_rows(runs: Iterable[orm.RoutineRun]) -> list[RunRow]:
    return [RunRow(r.routine_id, r.occurrence_date, r.completed_on, r.completed_at) for r in runs]


def tick_rows(ticks: Iterable[orm.RoutineRunTick]) -> list[TickRow]:
    return [TickRow(t.routine_id, t.occurrence_date, t.item_id, t.done_at) for t in ticks]


def get_plan_state(
    uow_factory: UnitOfWorkFactory, clock: Clock, *, min_span: YearSpan | None = None
) -> PlanState:
    """The current plan (cached by revision and today). ``SetupRequired`` before setup."""
    today = clock.today()
    owner = uow_factory.session_factory
    with uow_factory.read() as uow:
        revision = uow.repo(EVENTS).latest_plan_seq()
        settings = uow.repo(SETTINGS).get()
        move = require_setup(settings)
        region: orm.HolidayRegion = settings.holiday_region
    key = (revision, today)
    cached = _CACHE.get(owner)
    if (
        cached is not None
        and cached.key == key
        and (min_span is None or cached.span.contains(min_span))
    ):
        return cached
    span = default_span(today, move).union(min_span)
    key_ok = api_key_configured()
    for _ in range(MAX_ATTEMPTS):
        holidays.ensure_years(uow_factory, clock, region, span.years)
        with uow_factory.read() as uow:
            try:
                state = _compute_plan(uow, clock, today, span, key_ok)
            except _NeedSpan as need:
                span = need.span
                continue
            except _NeedHolidays as need:
                region = need.region
                continue
            except OutOfCalendar as error:
                span = extend_for(span, error, today, limit_year=_limit(span, today))
                continue
        _CACHE.put(owner, state)
        return state
    msg = "That is too far out for Remi's calendar."
    raise OutOfRange(msg)


def _limit(span: YearSpan, today: dt.date) -> int:
    """Automatic extension stops at the horizon, or where the plan's own dates already took
    the span (read requests never reach past ``walk_span``)."""
    return max(horizon_year(today), span.last)


def with_plan_state[T](
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    fn: Callable[[PlanState], T],
    *,
    days: Iterable[dt.date] = (),
) -> T:
    """Run ``fn`` on the plan state whose calendar covers ``days``; widen and retry on
    ``OutOfCalendar``.

    ``days`` must be within ten years of today (``OUT_OF_RANGE`` otherwise), and the calendar
    is widened for ``fn``'s walks only within ``walk_span`` (a year more either side), so a
    read never stores holiday years beyond the horizon."""
    wanted = [d for d in days]
    today = clock.today()
    for d in wanted:
        check_within_horizon(d, today)
    walks = walk_span(today)
    min_span: YearSpan | None = (
        YearSpan(today.year, today.year).including(wanted) if wanted else None
    )
    for _ in range(MAX_ATTEMPTS):
        state = get_plan_state(uow_factory, clock, min_span=min_span)
        try:
            return fn(state)
        except OutOfCalendar as error:
            min_span = extend_for(
                state.span, error, today, limit_year=walks.last, first_year=walks.first
            )
    msg = "That is too far out for Remi's calendar."
    raise OutOfRange(msg)


def _dates_of(projects: Sequence[orm.Project], rotation: orm.Rotation | None) -> list[dt.date]:
    out: list[dt.date] = []
    for p in projects:
        out.extend(
            d
            for d in (p.start_date, p.target_date, p.forecast_date, p.prev_forecast_date)
            if d is not None
        )
        out.extend(m.due_date for m in p.milestones if m.due_date is not None)
        out.extend(t.due_date for t in p.tasks if t.due_date is not None)
        out.extend(t.done_on for t in p.tasks if t.done_on is not None)
        out.extend(m.done_on for m in p.milestones if m.done_on is not None)
    if rotation is not None and rotation.start_date is not None:
        out.append(rotation.start_date)
    return out


def _compute_plan(
    uow: UnitOfWork, clock: Clock, today: dt.date, span: YearSpan, key_ok: bool
) -> PlanState:
    revision = uow.repo(EVENTS).latest_plan_seq()
    settings = uow.repo(SETTINGS).get()
    move = require_setup(settings)
    region = settings.holiday_region
    projects_orm = uow.repo(PROJECTS).list()
    routines_orm = uow.repo(ROUTINES).list()
    rotation_orm = uow.repo(ROTATION).get_active()

    needed = span.including(
        [today - dt.timedelta(weeks=8), move, *_dates_of(projects_orm, rotation_orm)]
    )
    if not span.contains(needed):
        raise _NeedSpan(span.union(needed))
    if holidays.years_to_generate(uow.repo(HOLIDAYS), region, span.years, today):
        raise _NeedHolidays(region)
    cal = build_calendar(uow.repo(HOLIDAYS).effective(region, span.start, span.end), span)

    routine_defs = [routine_of(r) for r in routines_orm]
    ctx = engine_ctx(
        settings,
        cal,
        today=today,
        routines=routine_defs,
        rotation=rotation_of(rotation_orm),
        leave=uow.repo(LEAVE).as_mapping(),
    )
    plans = [plan_of(p) for p in projects_orm]
    engine_projects = [project_of(p, plan) for p, plan in zip(projects_orm, plans, strict=True)]
    window = plan_window(ctx, plans)
    loads = build_loads(window[0], window[1], plans, ctx)
    derived = {p.id: derive_project(p, ctx, loads) for p in engine_projects}

    runs = run_rows(uow.repo(ROUTINES).runs_between(today, today))
    ticks = tick_rows(uow.repo(ROUTINES).ticks_between(today, today))
    notes = uow.repo(NOTES)
    recent_days = _recent_bds(cal, today)
    counts = CountsOut(
        projects=len(projects_orm),
        routines=len(routines_orm),
        notes_total=notes.count_total(),
        note_days=notes.count_days(),
        notes_today=notes.count_on(today),
        recent_notes=notes.count_in(recent_days),
    )
    aliases = [_alias_out(a) for a in uow.repo(ALIASES).list()]

    settings_dto = settings_out(settings, key_configured=key_ok)
    project_dtos = [
        _project_out(p, plan, derived[p.id], ctx)
        for p, plan in zip(projects_orm, plans, strict=True)
    ]
    routine_dtos = [
        _routine_out(r, rd, ctx, window, runs, ticks)
        for r, rd in zip(routines_orm, routine_defs, strict=True)
    ]
    out = PlanOut(
        revision=revision,
        today=_today_out(ctx, settings.timezone, clock),
        settings=settings_dto,
        calendar=_calendar_out(cal, window[0], window[1], region),
        loads={d: _load_out(load) for d, load in loads.items()},
        projects=project_dtos,
        routines=routine_dtos,
        rotation=_rotation_out(rotation_orm, ctx, move),
        move=_move_out(plans, ctx),
        verdict=_verdict_out(plans, ctx),
        flags=_flags_out(list(derived.values()), loads, ctx),
        aliases=aliases,
        counts=counts,
    )
    return PlanState(
        key=(revision, today),
        span=span,
        out=out,
        ctx=ctx,
        plans=tuple(plans),
        projects=tuple(engine_projects),
        derived=derived,
        loads=loads,
        window=window,
        region=region,
        timezone=settings.timezone,
        routines={r.id: _routine_info(r) for r in routines_orm},
        task_milestone={
            t.id: t.milestone_id for p in projects_orm for t in p.tasks if t.milestone_id
        },
    )


def build_plan(uow_factory: UnitOfWorkFactory, clock: Clock) -> PlanOut:
    """``GET /plan``: the whole bootstrap read model."""
    return get_plan_state(uow_factory, clock).out


def plan_etag(state: PlanState) -> str:
    """The ``ETag`` of a plan: its revision, plus the business date (a new day is a new plan)."""
    return f'"{state.revision}-{state.today.isoformat()}"'


# ---------------------------------------------------------------------------- DTO builders
def _recent_bds(cal: BusinessCalendar, today: dt.date) -> list[dt.date]:
    days: list[dt.date] = []
    if cal.covers(today) and cal.is_bd(today):
        days.append(today)
    if cal.covers(today):
        for d in cal.iter_bds_before(today):
            if len(days) >= RECENT_NOTE_BDS:
                break
            days.append(d)
    return days


def settings_out(row: orm.Settings, *, key_configured: bool) -> SettingsOut:
    """``SettingsOut`` for the settings row (never includes a key)."""
    prefs: Mapping[str, Any] = row.ui_prefs or {}
    zoom_raw = prefs.get("timeline_zoom")
    zoom: TimelineZoom = "2w" if zoom_raw == "2w" else "3m"
    last_page = prefs.get("last_textbook_page_id")
    collapsed = cast(list[Any], prefs.get("collapsed_page_ids") or [])
    return SettingsOut(
        setup_complete=setup_complete(row),
        setup_completed_at=row.setup_completed_at,
        move_date=row.move_date,
        move_taper=row.move_taper,
        capacity_hours_per_day=row.capacity_hours_per_day,
        timezone=row.timezone,
        holiday_region=row.holiday_region,
        stale_threshold_days=row.stale_threshold_days,
        overload_lookahead_bd=row.overload_lookahead_bd,
        new_project_horizon_bd=row.new_project_horizon_bd,
        now_ms_offset_bd=row.now_ms_offset_bd,
        next_ms_offset_bd=row.next_ms_offset_bd,
        key_project_id=row.key_project_id,
        key_routine_id=row.key_routine_id,
        key_run_date_override=row.key_run_date_override,
        motion_preference=row.motion_preference,
        accent_pc=row.accent_pc,
        accent_fi=row.accent_fi,
        serif_display=row.serif_display,
        ai_provider=row.ai_provider,
        ai_model=row.ai_model,
        ai_send_recent_notes=row.ai_send_recent_notes,
        ollama_base_url=row.ollama_base_url,
        ai_key_configured=key_configured,
        ui_prefs=UiPrefsOut(
            textbook_sidebar_open=bool(prefs.get("textbook_sidebar_open", True)),
            timeline_zoom=zoom,
            last_textbook_page_id=last_page if isinstance(last_page, str) else None,
            collapsed_page_ids=[str(x) for x in collapsed],
        ),
        updated_at=row.updated_at,
    )


def next_rollover(today: dt.date, timezone: str) -> dt.datetime:
    """The next local midnight in the business timezone (when "today" changes)."""
    zone = resolve_zone(timezone)
    local = dt.datetime.combine(today + dt.timedelta(days=1), dt.time(0), tzinfo=zone)
    return local.astimezone(ZoneInfo("UTC"))


def _today_out(ctx: EngineCtx, timezone: str, clock: Clock) -> TodayOut:
    cal, today = ctx.cal, ctx.today
    return TodayOut(
        iso=today,
        tz=timezone,
        overridden=clock_overridden(clock),
        w=js_weekday(today),
        is_bd=cal.is_bd(today),
        bdm=cal.bdm(today),
        month_bds=len(cal.month_bds(today.year, today.month)),
        next_rollover_at=next_rollover(today, timezone),
    )


def _calendar_days(cal: BusinessCalendar, frm: dt.date, to: dt.date) -> list[CalendarDayOut]:
    days: list[CalendarDayOut] = []
    d = frm
    while d <= to:
        info = cal.day_info(d)
        days.append(
            CalendarDayOut(
                iso=d, w=info.w, bd=info.bd, bdm=info.bdm, hol=info.holiday, week=info.week
            )
        )
        d += dt.timedelta(days=1)
    return days


def _calendar_out(
    cal: BusinessCalendar, frm: dt.date, to: dt.date, region: orm.HolidayRegion
) -> CalendarOut:
    return CalendarOut(from_=frm, to=to, region=region, days=_calendar_days(cal, frm, to))


def _load_out(load: DayLoad) -> DayLoadOut:
    return DayLoadOut(
        items=[
            DayLoadItemOut(
                ref_type=i.ref_type, ref_id=i.ref_id, domain=i.domain, h=_h(i.hours), name=i.name
            )
            for i in load.items
        ],
        bau=_h(load.bau),
        proj=_h(load.proj),
        total=_h(load.total),
        free=_h(load.free),
        capacity=_h(load.capacity),
        over=load.over,
    )


def _alias_out(a: orm.EntityAlias) -> AliasOut:
    if a.project_id is not None:
        return AliasOut(id=a.id, entity_type="project", entity_id=a.project_id, alias=a.alias)
    return AliasOut(id=a.id, entity_type="routine", entity_id=a.routine_id or "", alias=a.alias)


def _task_out(t: orm.Task) -> TaskOut:
    return TaskOut(
        id=t.id,
        project_id=t.project_id,
        milestone_id=t.milestone_id or "",
        text=t.text,
        hours=t.hours,
        due_date=t.due_date,
        sort_order=t.sort_order,
        done=t.done,
        done_on=t.done_on,
    )


def _charter_out(p: orm.Project) -> CharterOut:
    def items(name: orm.CharterList) -> list[CharterItemOut]:
        return [
            CharterItemOut(
                id=c.id,
                project_id=c.project_id,
                list=c.list_name,
                text=c.text,
                sort_order=c.sort_order,
            )
            for c in sorted(p.charter_items, key=lambda c: c.sort_order)
            if c.list_name == name
        ]

    return CharterOut(
        success=items("success"),
        in_scope=items("inScope"),
        out_scope=items("outScope"),
        constraints=items("constraints"),
    )


def _milestone_out(m: orm.Milestone) -> MilestoneOut:
    tasks = sorted(m.tasks, key=lambda t: t.sort_order) if m.horizon == "now" else []
    return MilestoneOut(
        id=m.id,
        project_id=m.project_id,
        horizon=m.horizon,
        name=m.name,
        due_date=m.due_date,
        sort_order=m.sort_order,
        done=m.done,
        done_on=m.done_on,
        tasks=[_task_out(t) for t in tasks],
    )


def _sentence_out(d: DerivedProject, plan: ProjectPlan) -> SentenceOut:
    s = d.sentence
    has_forecast = plan.forecast is not None
    case = s.case
    return SentenceOut(
        case=case,
        params=SentenceParamsOut(
            rate=s.rate if case in ("after_move", "late") else None,
            work_left_h=hr1(d.work_left) if d.work_left is not None and has_forecast else None,
            cut_h=s.cut_h if case in ("after_move", "late") else None,
            late_bd=s.late_bd,
            need_rate=s.need_rate if case == "late" else None,
            buffer_bd=s.buffer_bd if case in ("buffer", "no_buffer") else None,
            scope_h=s.absorb_h if case == "buffer" else None,
            target_date=s.target if case in ("late", "no_buffer") else None,
            move_date=s.move if case == "after_move" else None,
            over_day_count=s.over_days,
            first_over_day=s.first_over_day,
            stale_days=s.stale_days,
            starts_in_bd=s.starts_in_bd,
        ),
    )


def _readiness_pct(p: orm.Project) -> float | None:
    if p.readiness is not None:
        return _h(p.readiness * 100)
    total = sum(t.hours for t in p.tasks)
    if total <= 0:
        return None
    return _h(sum(t.hours for t in p.tasks if t.done) / total * 100)


def project_derived_out(
    p: orm.Project, plan: ProjectPlan, d: DerivedProject, ctx: EngineCtx
) -> ProjectDerivedOut:
    by_id = {m.id: m for m in p.milestones}
    frm = plan_from(plan, ctx)
    milestones = [
        DerivedMilestoneOut(
            milestone_id=m.id or None,
            name=m.name,
            date=m.day,
            horizon=m.horizon,
            done=bool(by_id[m.id].done) if m.id in by_id else False,
            passed=m.passed,
        )
        for m in d.milestones
    ]
    next_ms = next((m for m in milestones if not m.done and m.date >= ctx.today), None)
    now_estimate = sum(
        t.hours for m in p.milestones if m.horizon == "now" for t in m.tasks if not t.done
    )
    return ProjectDerivedOut(
        status=d.status,
        delta_bd=d.delta_bd,
        plan_from=frm,
        started=d.started,
        since_days=d.since_days,
        stale=d.stale,
        added_h=_h(d.added_h),
        growth_pct=d.growth_pct,
        work_left=_h(d.work_left) if d.work_left is not None else None,
        work_left_display=d.work_left_display,
        bd_left=d.bd_left,
        bd_to_target=d.bd_to_target,
        total_bd=(ctx.cal.bd_diff(plan.start, plan.forecast) + 1) if plan.forecast else 0,
        done_bd=(max(0, ctx.cal.bd_diff(plan.start, ctx.today)) if d.started else 0),
        progress_pct=_h(d.progress_pct),
        need=NeedOut(rate=d.need.rate, state=d.need.state),
        avg_plan=_h(d.avg_plan) if plan.forecast is not None else None,
        buffer_bd=d.buffer_bd,
        absorb_h=_h(d.absorb_h) if d.absorb_h is not None else None,
        cut_h=_h(d.cut_h) if d.cut_h is not None else None,
        cut_before_move_h=_h(d.cut_before_move_h) if d.cut_before_move_h is not None else None,
        lands_after_move=d.sentence.case == "after_move",
        starts_in_bd=d.starts_in_bd,
        over_days=list(d.over_days),
        now_estimate_h=_h(round(now_estimate, 2)),
        readiness_pct=_readiness_pct(p),
        sentence=_sentence_out(d, plan),
        milestones=milestones,
        next_milestone=next_ms,
        day_hours={day: _h(h) for day, h in d.day_hours.items() if day >= frm},
    )


def _project_out(
    p: orm.Project, plan: ProjectPlan, d: DerivedProject, ctx: EngineCtx
) -> ProjectOut:
    exit_routes = p.exit_routes
    return ProjectOut(
        id=p.id,
        domain=p.domain,
        name=p.name,
        short=p.short,
        goal=p.goal,
        why_now=p.why_now,
        later_intent=p.later_intent,
        end_name=p.end_name,
        start_date=p.start_date,
        target_date=p.target_date,
        target_label=p.target_label,
        forecast_date=p.forecast_date,
        prev_forecast_date=p.prev_forecast_date,
        rate=p.rate_hours_per_day,
        rate_after_move=p.rate_after_move,
        baseline_hours=p.baseline_hours,
        unplaced_h=_h(p.unplaced_hours),
        confidence=p.confidence,
        last_checkin_date=p.last_checkin_date,
        blocker=p.blocker,
        readiness=p.readiness,
        after_day_one_note=p.after_day_one_note,
        phase=cast(Any, p.phase),
        exit_routes=exit_routes,
        sort_order=p.sort_order,
        created_at=p.created_at,
        updated_at=p.updated_at,
        charter=_charter_out(p),
        milestones=[_milestone_out(m) for m in sorted(p.milestones, key=lambda m: _ms_order(m))],
        readiness_items=[
            ReadinessItemOut(
                id=r.id,
                project_id=r.project_id,
                text=r.text,
                done=r.done,
                due_date=r.due_date,
                done_on=r.done_on,
                sort_order=r.sort_order,
            )
            for r in sorted(p.readiness_items, key=lambda r: r.sort_order)
        ],
        scope_changes=[
            ScopeChangeOut(
                id=s.id,
                project_id=s.project_id,
                checkin_id=s.checkin_id,
                date=s.date,
                what=s.what,
                hours=s.hours,
                slip_bd=s.slip_bd,
                from_forecast=s.from_forecast,
                to_forecast=s.to_forecast,
            )
            for s in p.scope_changes
        ],
        risks=[
            RiskOut(id=r.id, risk=r.risk, mitigation=r.mitigation, sort_order=r.sort_order)
            for r in sorted(p.risks, key=lambda r: r.sort_order)
        ],
        checklists=[
            ChecklistOut(
                id=c.id,
                title=c.title,
                sort_order=c.sort_order,
                items=[
                    ChecklistItemOut(
                        id=i.id,
                        text=i.text,
                        done=i.done,
                        done_on=i.done_on,
                        sort_order=i.sort_order,
                    )
                    for i in sorted(c.items, key=lambda i: i.sort_order)
                ],
            )
            for c in sorted(p.checklists, key=lambda c: c.sort_order)
        ],
        bau_day_hours={r.routine_id: r.hours for r in p.bau_day_hours},
        overrides={o.date: o.hours for o in p.hour_overrides},
        derived=project_derived_out(p, plan, d, ctx),
    )


_HORIZON_RANK: Final[Mapping[str, int]] = {"now": 0, "next": 1, "explicit": 2}


def _ms_order(m: orm.Milestone) -> tuple[int, int]:
    return (_HORIZON_RANK.get(m.horizon, 3), m.sort_order)


def _routine_info(r: orm.Routine) -> RoutineInfo:
    return RoutineInfo(
        id=r.id,
        name=r.name,
        short=r.short,
        domain=r.domain,
        stage=r.stage,
        project_id=r.project_id,
        checklist=tuple(
            (i.id, i.label) for i in sorted(r.checklist_items, key=lambda i: i.sort_order)
        ),
    )


def run_out(
    routine_id: str,
    day: dt.date,
    item_ids: Sequence[str],
    run: RunRow | None,
    ticked: Iterable[str],
) -> RoutineRunOut:
    """One occurrence's run state (``done``: completed, or every checklist item ticked)."""
    ticked_set = set(ticked)
    ticked_ids = [i for i in item_ids if i in ticked_set]
    completed = run is not None and run.completed_on is not None
    all_ticked = bool(item_ids) and len(ticked_ids) == len(item_ids)
    return RoutineRunOut(
        routine_id=routine_id,
        occurrence_date=day,
        completed=completed,
        completed_on=run.completed_on if run is not None else None,
        completed_at=run.completed_at if run is not None else None,
        ticked_item_ids=ticked_ids,
        item_count=len(item_ids),
        done=completed or all_ticked,
    )


def _routine_out(
    r: orm.Routine,
    rd: RoutineDef,
    ctx: EngineCtx,
    window: tuple[dt.date, dt.date],
    runs: Sequence[RunRow],
    ticks: Sequence[TickRow],
) -> RoutineOut:
    cal, today = ctx.cal, ctx.today
    items = sorted(r.checklist_items, key=lambda i: i.sort_order)
    item_ids = [i.id for i in items]
    effort = monthly_effort_h(rd)
    runs_today = occurs(rd, today, cal)
    today_run: RoutineRunOut | None = None
    if runs_today:
        run = next((x for x in runs if x.routine_id == r.id and x.occurrence_date == today), None)
        ticked = [t.item_id for t in ticks if t.routine_id == r.id and t.occurrence_date == today]
        today_run = run_out(r.id, today, item_ids, run, ticked)
    return RoutineOut(
        id=r.id,
        domain=r.domain,
        name=r.name,
        short=r.short,
        label=r.label,
        detail=r.detail,
        rule=RoutineRuleOut(kind=r.kind, bd=r.bd, weekday=r.weekday),
        hours=r.hours,
        stage=cast(Any, r.stage),
        status_note=r.status_note,
        transition_note=r.transition_note,
        project_id=r.project_id,
        co_tag_with_project=r.co_tag_with_project,
        sort_order=r.sort_order,
        created_at=r.created_at,
        updated_at=r.updated_at,
        checklist_items=[
            RoutineChecklistItemOut(
                id=i.id, routine_id=i.routine_id, label=i.label, sort_order=i.sort_order
            )
            for i in items
        ],
        derived=RoutineDerivedOut(
            next=[
                OccurrenceOut(
                    iso=o.day,
                    bdm=cal.bdm(o.day) or 0,
                    today=o.today,
                    after_move=o.after_move,
                    bd_away=o.bd_away,
                )
                for o in next_occurrences(rd, ctx, today, 3)
            ],
            occurrences=[d for d in cal.bds(window[0], window[1]) if occurs(rd, d, cal)],
            monthly_effort_h=_h(effort.hours),
            monthly_effort_approx=effort.approx,
            runs_today=runs_today,
            counts_today=counts_on(rd, today, ctx),
            today_run=today_run,
            last_before_move=last_occurrence_before(rd, ctx, ctx.move),
            handed_over=r.stage >= 3,
        ),
    )


def _empty_rotation(move: dt.date) -> RotationOut:
    return RotationOut(
        id="",
        domain="fi",
        title="",
        start_date=move,
        start_follows_move=True,
        hours_per_day=0,
        segments=[],
        loop_bd=0,
        loop_end=None,
        refresh=None,
        total_bd=0,
        current=RotationCurrentOut(status="none", order=None, segment_id=None, bd_to_start=None),
        updated_at=None,
    )


def _rotation_out(r: orm.Rotation | None, ctx: EngineCtx, move: dt.date) -> RotationOut:
    if r is None:
        return _empty_rotation(move)
    plan = ctx.rotation_plan
    status = rotation_current(plan, ctx.today, ctx.cal)
    segments = (
        [
            RotationSegmentOut(
                id=s.id,
                order=s.order,
                country=s.country,
                code=s.code,
                length_bd=s.length_bd,
                pass_=s.kind,
                loop=s.loop,
                start=s.start,
                end=s.end,
            )
            for s in plan.segments
        ]
        if plan is not None
        else []
    )
    refresh = (
        RotationRefreshOut(start=plan.refresh_start, end=plan.refresh_end)
        if plan is not None and plan.refresh_start is not None and plan.refresh_end is not None
        else None
    )
    return RotationOut(
        id=r.id,
        domain="fi",
        title=r.title,
        start_date=r.start_date if r.start_date is not None else move,
        start_follows_move=r.start_date is None,
        hours_per_day=r.hours_per_day,
        segments=segments,
        loop_bd=plan.loop_bd if plan is not None else 0,
        loop_end=plan.loop_end if plan is not None else None,
        refresh=refresh,
        total_bd=plan.total_bd if plan is not None else 0,
        current=RotationCurrentOut(
            status=status.status,
            order=status.order,
            segment_id=status.segment_id,
            bd_to_start=status.bd_to_start,
        ),
        updated_at=r.updated_at,
    )


def _move_out(plans: Sequence[ProjectPlan], ctx: EngineCtx) -> MoveOut:
    strip = move_strip(plans, ctx)
    return MoveOut(
        date=ctx.move,
        countdown_bd=strip.countdown_bd,
        remaining=[
            MoveRemainingDayOut(iso=d.day, bdm=d.bdm, pc_running=d.pc_running)
            for d in strip.remaining
        ],
        flags=[
            MoveFlagOut(
                kind=f.kind,
                project_id=f.project_id,
                iso=f.day,
                at_risk=f.at_risk,
                slot=f.slot,
                index=f.index,
                lift_px=f.lift_px,
                stick_px=f.stick_px,
            )
            for f in strip.flags  # the engine's order (by slot, prototype ties)
        ],
    )


def _verdict_out(plans: Sequence[ProjectPlan], ctx: EngineCtx) -> VerdictOut:
    v = verdict(plans, ctx)
    return VerdictOut(
        state=v.state,
        buffer_bd=v.buffer_bd,
        last_pc_exit=v.last_pc_exit,
        key_project_id=v.key_project_id,
        key_run=v.key_run,
        to_run_bd=v.to_run_bd,
        any_risk=v.any_risk,
    )


def _flags_out(
    derived: Sequence[DerivedProject], loads: Mapping[dt.date, DayLoad], ctx: EngineCtx
) -> FlagsOut:
    overloads = upcoming_overloads(loads, ctx)
    items = attention(derived, overloads)
    prompt = checkin_prompt(derived)
    return FlagsOut(
        upcoming_overloads=[
            UpcomingOverloadOut(iso=o.day, bdm=o.bdm, total=_h(o.total), over_by=_h(o.over_by))
            for o in overloads
        ],
        attention=[
            AttentionItemOut(
                kind=a.kind,
                project_id=a.project_id,
                iso=a.day,
                value=_attention_value(a),
                chip=a.chip,
            )
            for a in items
        ],
        prompt_project_id=prompt.prompt_project_id,
        next_due_project_id=prompt.next_due_project_id,
    )


def _attention_value(a: Attention) -> float:
    """Delta BD (at risk), hours over (overload) or days since the check-in (stale)."""
    if a.kind == "at_risk":
        value: float | None = a.delta_bd
    elif a.kind == "overload":
        value = a.over_by
    else:
        value = a.since_days
    return _h(float(value)) if value is not None else 0.0


# ---------------------------------------------------------------------------- day
def _runs_on(
    uow_factory: UnitOfWorkFactory, frm: dt.date, to: dt.date
) -> tuple[list[RunRow], list[TickRow]]:
    with uow_factory.read() as uow:
        repo = uow.repo(ROUTINES)
        return run_rows(repo.runs_between(frm, to)), tick_rows(repo.ticks_between(frm, to))


def _loads_through(state: PlanState, a: dt.date, b: dt.date) -> Mapping[dt.date, DayLoad]:
    """Loads covering ``[a, b]``: the cached window plus anything outside it."""
    w0, w1 = state.window
    if w0 <= a and b <= w1:
        return state.loads
    extra = build_loads(min(a, w0), max(b, w1), state.plans, state.ctx)
    return {**extra, **state.loads}


def day_view(uow_factory: UnitOfWorkFactory, clock: Clock, day: dt.date) -> DayOut:
    """``GET /day/{iso}``: BAU rows, the checklist run, focus blocks and the next run
    (``OUT_OF_RANGE`` more than ten years from today)."""
    check_within_horizon(day, clock.today(), "day")
    runs, ticks = _runs_on(uow_factory, day, day)
    return with_plan_state(
        uow_factory, clock, lambda state: _day_out(state, day, runs, ticks), days=[day]
    )


def _day_out(
    state: PlanState,
    day: dt.date,
    runs: Sequence[RunRow],
    ticks: Sequence[TickRow],
) -> DayOut:
    ctx, cal, today = state.ctx, state.cal, state.today
    info = cal.day_info(day)
    base: dict[str, Any] = {
        "day": day,
        "is_today": day == today,
        "ahead_bd": cal.bd_diff(today, day),
        "w": info.w,
        "bdm": info.bdm,
        "month_bds": len(cal.month_bds(day.year, day.month)),
        "holiday": info.holiday,
    }
    if not info.bd:
        return DayOut(
            **base,
            load=None,
            bau_rows=[],
            focus_blocks=[],
            next_run_after=_next_run_out(day, ctx),
        )
    loads = _loads_through(state, min(today, day), max(today, day))
    load = loads.get(day)
    rows = _bau_rows(state, day, runs, ticks)
    blocks: list[FocusBlockOut] = []
    for p in state.projects:
        block = focus_tasks(p, day, loads, ctx)
        if block is None:
            continue
        offset = 0.0
        if day > today:
            offset = sum(
                x.project_hours(p.id)
                for d in cal.bds(today, day)
                if d < day and (x := loads.get(d)) is not None
            )
        nm = block.next_milestone
        blocks.append(
            FocusBlockOut(
                project_id=p.id,
                hours=_h(block.hours),
                offset_h=_h(offset),
                tasks=[
                    FocusTaskOut(
                        id=t.id,
                        milestone_id=state.task_milestone.get(t.id, ""),
                        text=t.text,
                        hours=t.hours,
                        done=t.done,
                        done_on=t.done_on,
                        due_date=t.due,
                    )
                    for t in block.tasks
                ],
                empty_reason=block.empty,
                next_milestone=(
                    FocusMilestoneOut(
                        milestone_id=nm.milestone_id,
                        name=nm.name,
                        date=nm.day,
                        due_this_day=nm.due_on_day,
                    )
                    if nm is not None
                    else None
                ),
            )
        )
    return DayOut(
        **base,
        load=_load_out(load) if load is not None else None,
        bau_rows=rows,
        focus_blocks=blocks,
        next_run_after=None if rows else _next_run_out(day, ctx),
    )


def _bau_rows(
    state: PlanState,
    day: dt.date,
    runs: Sequence[RunRow],
    ticks: Sequence[TickRow],
) -> list[BauRowOut]:
    ctx = state.ctx
    rows: list[BauRowOut] = []
    for rd in ctx.routines:
        if not counts_on(rd, day, ctx):
            continue
        info = state.routines.get(rd.id)
        checklist = info.checklist if info is not None else ()
        item_ids = [i for i, _ in checklist]
        ticked = {t.item_id for t in ticks if t.routine_id == rd.id and t.occurrence_date == day}
        run = next((x for x in runs if x.routine_id == rd.id and x.occurrence_date == day), None)
        run_dto = run_out(rd.id, day, item_ids, run, ticked)
        rows.append(
            BauRowOut(
                kind="routine",
                routine_id=rd.id,
                rotation=None,
                name=rd.name,
                short=rd.short,
                domain=rd.domain,
                hours=rd.hours,
                stage=cast(Any, rd.stage),
                run=run_dto,
                checklist=[
                    BauChecklistItemOut(id=i, label=label, done=i in ticked)
                    for i, label in checklist
                ],
                editable=day == state.today,
                done=run_dto.done,
            )
        )
    seg = ctx.rotation_segment_on(day)
    if seg is not None and ctx.rotation_plan is not None:
        rows.append(
            BauRowOut(
                kind="rotation",
                routine_id=None,
                rotation=BauRotationOut(
                    segment_id=seg.id, country=seg.country, code=seg.code, pass_=seg.kind
                ),
                name=f"{seg.country} · {seg.kind}",
                short=seg.country,
                domain="fi",
                hours=ctx.rotation_plan.hours_per_day,
                stage=None,
                run=None,
                checklist=[],
                editable=False,
                done=False,
            )
        )
    return rows


def _next_run_out(day: dt.date, ctx: EngineCtx) -> NextRunOut | None:
    if not ctx.routines:
        return None
    nxt = next_run_after(day, ctx)
    if nxt is None:
        return NextRunOut(routine_id=None, date=None, after_move=True)
    first = next((r for r in ctx.routines if counts_on(r, nxt, ctx)), None)
    return NextRunOut(
        routine_id=first.id if first is not None else None,
        date=nxt,
        after_move=nxt >= ctx.move,
    )


# ---------------------------------------------------------------------------- month snapshot
def parse_month(month: str | None, today: dt.date) -> tuple[int, int]:
    if month is None:
        return today.year, today.month
    try:
        year_s, month_s = month.split("-")
        year, mon = int(year_s), int(month_s)
        first = dt.date(year, mon, 1)
    except ValueError as exc:
        raise ValidationFailed("Use a month like 2026-10.", field="month") from exc
    check_in_range(first, "month")
    return year, mon


def month_snapshot_view(
    uow_factory: UnitOfWorkFactory, clock: Clock, month: str | None
) -> MonthSnapshotOut:
    """``GET /month-snapshot``: BAU runs, tasks and milestones due in a month
    (``OUT_OF_RANGE`` more than ten years from today)."""
    today = clock.today()
    year, mon = parse_month(month, today)
    first = dt.date(year, mon, 1)
    last = month_end(first)
    check_within_horizon(first, today, "month", field="month")
    check_within_horizon(last, today, "month", field="month")
    runs, ticks = _runs_on(uow_factory, first, last)
    return with_plan_state(
        uow_factory,
        clock,
        lambda state: _month_out(state, year, mon, runs, ticks),
        days=[first, last],
    )


def _local_date(value: dt.datetime, timezone: str) -> dt.date:
    return value.astimezone(resolve_zone(timezone)).date()


def _month_out(
    state: PlanState,
    year: int,
    mon: int,
    runs: Sequence[RunRow],
    ticks: Sequence[TickRow],
) -> MonthSnapshotOut:
    ctx = state.ctx
    run_states: dict[tuple[str, dt.date], RunState] = {}
    keys = {(r.routine_id, r.occurrence_date) for r in runs} | {
        (t.routine_id, t.occurrence_date) for t in ticks
    }
    for key in keys:
        run = next((r for r in runs if (r.routine_id, r.occurrence_date) == key), None)
        mine = [t for t in ticks if (t.routine_id, t.occurrence_date) == key]
        last_tick = max((_local_date(t.done_at, state.timezone) for t in mine), default=None)
        run_states[key] = RunState(
            completed_on=run.completed_on if run is not None else None,
            ticks_done=len(mine),
            last_tick_on=last_tick,
        )
    try:
        snap = month_snapshot(year, mon, state.projects, ctx, run_states)
    except ValueError as exc:
        raise ValidationFailed("That month has no business days.", field="month") from exc

    projects = {p.id: p for p in state.projects}
    tasks: dict[str, tuple[str, str]] = {}
    milestones: dict[str, str] = {}
    for p in state.projects:
        for m in p.milestones:
            milestones[m.id] = m.name
            for t in m.tasks:
                tasks[t.id] = (t.text, m.id)
    rows: list[MonthSnapshotRowOut] = []
    for r in snap.rows:
        if r.kind == "bau":
            info = state.routines.get(r.ref_id)
            name = (info.name if info is not None else "") or "Untitled routine"
            text = name if r.routine_kind in (None, "monthly") else f"{name} · {fmt_dm(r.due)}"
            rows.append(
                MonthSnapshotRowOut(
                    key=f"bau:{r.ref_id}:{r.due.isoformat()}",
                    kind="bau",
                    text=text,
                    sub=f"BD{r.bdm}" if r.bdm is not None else "",
                    due=r.due,
                    done=r.done,
                    done_on=r.done_on,
                    late=r.late,
                    domain=info.domain if info is not None else "pc",
                    project_id=r.project_id,
                    routine_id=r.ref_id,
                    occurrence_date=r.due,
                    task_id=None,
                    milestone_id=None,
                    has_checklist=bool(info.checklist) if info is not None else False,
                )
            )
            continue
        project = projects.get(r.project_id or "")
        sub = project.short if project is not None else ""
        domain = project.domain if project is not None else "pc"
        if r.kind == "task":
            text, milestone_id = tasks.get(r.ref_id, ("", ""))
            rows.append(
                MonthSnapshotRowOut(
                    key=f"task:{r.ref_id}",
                    kind="task",
                    text=text,
                    sub=sub,
                    due=r.due,
                    done=r.done,
                    done_on=r.done_on,
                    late=r.late,
                    domain=domain,
                    project_id=r.project_id,
                    routine_id=None,
                    occurrence_date=None,
                    task_id=r.ref_id,
                    milestone_id=milestone_id or None,
                    has_checklist=False,
                )
            )
        else:
            rows.append(
                MonthSnapshotRowOut(
                    key=f"milestone:{r.ref_id}",
                    kind="milestone",
                    text=milestones.get(r.ref_id, ""),
                    sub=sub,
                    due=r.due,
                    done=r.done,
                    done_on=r.done_on,
                    late=r.late,
                    domain=domain,
                    project_id=r.project_id,
                    routine_id=None,
                    occurrence_date=None,
                    task_id=None,
                    milestone_id=r.ref_id,
                    has_checklist=False,
                )
            )
    return MonthSnapshotOut(
        month=f"{year:04d}-{mon:02d}",
        from_=snap.first_bd,
        to=snap.last_bd,
        today=state.today,
        rows=rows,
        bars=[
            MonthSnapshotBarOut(iso=b.day, plan=b.plan, done=b.done, late=b.late, past=b.past)
            for b in snap.bars
        ],
        totals=MonthSnapshotTotalsOut(total=snap.total, done=snap.done, late=snap.late),
    )


# ---------------------------------------------------------------------------- home
def home_view(uow_factory: UnitOfWorkFactory, clock: Clock) -> HomeOut:
    """``GET /home``: works before setup (zeros and nulls, no invented numbers)."""
    today = clock.today()
    with uow_factory.read() as uow:
        settings = uow.repo(SETTINGS).get()
        complete = setup_complete(settings)
        region = settings.holiday_region
        project_count = uow.repo(PROJECTS).count()
        routine_count = uow.repo(ROUTINES).count()
        notes_today = uow.repo(NOTES).count_on(today)
        textbook = HomeTextbookOut(
            pages=uow.repo(TEXTBOOK).count_pages(),
            live_charts=uow.repo(TEXTBOOK).count_chart_blocks(),
        )
    if not complete:
        cal = calendar_for(
            uow_factory, clock, region, YearSpan(today.year, today.year), persist=False
        )
        return HomeOut(
            needs_setup=True,
            today=today,
            is_bd=cal.is_bd(today),
            bdm=cal.bdm(today),
            move_date=None,
            countdown_bd=None,
            project_count=project_count,
            routine_count=routine_count,
            notes_today=notes_today,
            key_project=None,
            textbook=textbook,
        )
    state = get_plan_state(uow_factory, clock)
    plan = state.out
    key = plan.settings.key_project_id
    chosen = next((p for p in plan.projects if key is not None and p.id == key), None)
    if chosen is None:
        chosen = next((p for p in plan.projects if p.domain == "pc"), None)
    return HomeOut(
        needs_setup=False,
        today=today,
        is_bd=plan.today.is_bd,
        bdm=plan.today.bdm,
        move_date=plan.move.date,
        countdown_bd=plan.move.countdown_bd,
        project_count=plan.counts.projects,
        routine_count=plan.counts.routines,
        notes_today=plan.counts.notes_today,
        key_project=(
            HomeKeyProjectOut(
                id=chosen.id,
                name=chosen.name,
                short=chosen.short,
                domain=chosen.domain,
                status=chosen.derived.status,
                forecast_date=chosen.forecast_date,
                target_date=chosen.target_date,
                delta_bd=chosen.derived.delta_bd,
            )
            if chosen is not None
            else None
        ),
        textbook=textbook,
    )


# ---------------------------------------------------------------------------- ranges
def check_range(frm: dt.date, to: dt.date) -> None:
    check_in_range(frm)
    check_in_range(to)
    if to < frm:
        raise ValidationFailed("The range ends before it starts.", field="to")
    if (to - frm).days > MAX_RANGE_DAYS:
        raise ValidationFailed("Ask for at most three years at a time.", field="to")


def _pre_setup_window(today: dt.date) -> tuple[dt.date, dt.date]:
    return monday_of(today - dt.timedelta(days=7)), month_end(add_months(today, 3))


def calendar_view(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    frm: dt.date | None,
    to: dt.date | None,
    region: orm.HolidayRegion | None,
) -> CalendarOut:
    """``GET /calendar``: calendar days for a range (the plan window by default). Works before
    setup, for any region (the wizard's date picker). Years outside the read horizon are served
    from memory, never stored."""
    today = clock.today()
    info = settings_info(uow_factory)
    complete = info.complete
    if frm is None or to is None:
        if complete:
            w0, w1 = get_plan_state(uow_factory, clock).window
        else:
            w0, w1 = _pre_setup_window(today)
        frm = frm if frm is not None else w0
        to = to if to is not None else max(w1, frm)
    check_range(frm, to)
    chosen: orm.HolidayRegion = region if region is not None else info.region
    span = YearSpan(frm.year, to.year)
    persist = complete and chosen == info.region and read_span(today).contains(span)
    cal = calendar_for(uow_factory, clock, chosen, span, persist=persist)
    return _calendar_out(cal, frm, to, chosen)


def loads_view(
    uow_factory: UnitOfWorkFactory, clock: Clock, frm: dt.date | None, to: dt.date | None
) -> LoadsOut:
    """``GET /loads``: business-day loads for any range (the plan window by default)."""
    state = get_plan_state(uow_factory, clock)
    a = frm if frm is not None else state.window[0]
    b = to if to is not None else max(state.window[1], a)
    check_range(a, b)

    def compute(s: PlanState) -> LoadsOut:
        w0, w1 = s.window
        if w0 <= a and b <= w1:
            chosen = {d: x for d, x in s.loads.items() if a <= d <= b}
        else:
            chosen = build_loads(a, b, s.plans, s.ctx)
        return LoadsOut(
            from_=a,
            to=b,
            capacity=s.ctx.capacity,
            loads={d: _load_out(x) for d, x in sorted(chosen.items())},
        )

    return with_plan_state(uow_factory, clock, compute, days=[a, b])


def holidays_view(
    uow_factory: UnitOfWorkFactory, clock: Clock, frm: dt.date | None, to: dt.date | None
) -> list[HolidayOut]:
    """``GET /holidays``: the current region's holidays, suppressed ones included.

    After setup, missing years inside the read horizon are generated into the database first;
    other years (and every year before setup) are generated in memory, never stored."""
    today = clock.today()
    a = frm if frm is not None else dt.date(today.year - 1, 1, 1)
    b = to if to is not None else dt.date(today.year + 2, 12, 31)
    check_range(a, b)
    info = settings_info(uow_factory)
    region = info.region
    span = YearSpan(a.year, b.year)
    if info.complete and read_span(today).contains(span):
        holidays.ensure_years(uow_factory, clock, region, span.years)
    with uow_factory.read() as uow:
        repo = uow.repo(HOLIDAYS)
        covered = repo.covered_years(region)
        stored = [holiday_out(h) for h in repo.list(region, a, b)]
    known = {h.date for h in stored}
    missing = [y for y in span.years if y not in covered]
    generated = [
        HolidayOut(date=d, name=n, region=region, source="generated", suppressed=False)
        for d, n in holidays.generate(region, missing).items()
        if a <= d <= b and d not in known
    ]
    return sorted([*stored, *generated], key=lambda h: h.date)


def holiday_out(row: orm.Holiday) -> HolidayOut:
    return HolidayOut(
        date=row.date,
        name=row.name,
        region=row.region,
        source=row.source,
        suppressed=row.suppressed,
    )


def leave_out(row: orm.LeaveDay) -> LeaveDayOut:
    return LeaveDayOut(date=row.date, hours=row.hours, note=row.note)


def leave_view(
    uow_factory: UnitOfWorkFactory, frm: dt.date | None, to: dt.date | None
) -> list[LeaveDayOut]:
    """``GET /leave``: personal leave days (data only)."""
    if frm is not None and to is not None:
        check_range(frm, to)
    with uow_factory.read() as uow:
        return [leave_out(row) for row in uow.repo(LEAVE).list(frm, to)]


# ---------------------------------------------------------------------------- snapshots
def project_snapshots(uow_factory: UnitOfWorkFactory, project_id: str) -> list[ProjectSnapshotOut]:
    """``GET /projects/{id}/snapshots``: check-in snapshots, oldest first (404 if unknown)."""
    with uow_factory.read() as uow:
        projects = uow.repo(PROJECTS)
        projects.require(project_id, full=False)
        rows = projects.snapshots(project_id)
        return [_snapshot_out(c) for c in rows]


def _snapshot_out(c: orm.CheckIn) -> ProjectSnapshotOut:
    snapshot: Mapping[str, Any] = c.snapshot or {}
    raw = cast(list[Any], snapshot.get("milestones") or [])
    milestones: list[SnapshotMilestoneOut] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        entry = cast(dict[str, Any], item)
        name, when = entry.get("name"), entry.get("date")
        if not isinstance(name, str) or not isinstance(when, str):
            continue
        try:
            day = dt.date.fromisoformat(when)
        except ValueError:
            continue
        mid = entry.get("milestoneId")
        milestones.append(
            SnapshotMilestoneOut(
                milestone_id=mid if isinstance(mid, str) else None, name=name, date=day
            )
        )
    return ProjectSnapshotOut(
        checkin_id=c.id,
        date=c.date,
        forecast_date=c.forecast_date,
        target_date=c.target_date,
        confidence=c.confidence,
        note=c.note,
        source=c.source,
        milestones=milestones,
    )
