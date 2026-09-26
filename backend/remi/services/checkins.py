"""Tell Remi: parse an update, preview the ticked changes, apply them in one transaction.

**Parse.** ``parse`` builds the provider's inputs on the server (``CheckinContextInput`` from
the database and the engine: today and its BD, capacity, the move, every project's open Now
tasks, milestones and aliases, the routines, the last five business days of notes) and calls
``registry.parse``. It supports a ``parseId`` (``DELETE /checkins/parse/{id}`` cancels) and
client disconnects. ``parse_simple`` is the offline reading.

**Preview == apply.** Both run :func:`apply_changes`, the one function that turns reviewed
changes into rows: preview inside a dry-run unit of work (always rolled back, no event),
apply inside ``run_mutation`` (one transaction, one ``checkin.applied`` event). Both call the
engine's ``checkin.preview`` for the forecasts, so the chip the review shows is the forecast
that lands, and ``GET /plan`` agrees afterwards.

**Apply**, per project named by a change (in order of first mention):

- the engine outcome's ``after`` plan is saved as is (target, rate, rescaled BAU-day hours
  and overrides, forecast, prev, unplaced hours); a target that moved clears ``targetLabel``;
- ``task_done`` ticks the task (``doneOn`` today); ``task_add`` appends to the first Now
  milestone, creating "Added from an update" (due today + the Now offset) when there is none;
- confidence takes the first proposed value, else stays; ``lastCheckinDate`` becomes today;
- the blocker is replaced by the first proposed blocker, or cleared (every check-in does);
- one ``CheckIn`` row with the full snapshot (target, forecast, the derived milestones,
  rates, work left), the note (``summarise_checkin``), ``rawText``, ``source``, ``parseId`` and
  ``batchId`` (the event id, shared by the whole apply);
- a ``ScopeChange`` for new scope, and a feed item: "Scope added (what, +6h). Forecast moved
  2 Dec → 7 Dec." (delta "+3 BD") when the scope moved the forecast, otherwise "Checked in.
  {notes}. Forecast holds at 7 Dec." (or "Forecast moved A → B." after an hours-a-day
  change, where the prototype still said "holds").

``bau_done`` ticks every checklist item of today's run, or records the run as complete when
the routine has no checklist. Movements come from ``diff_movements`` (via ``run_mutation``),
tagged scope, rate or target, else checkin.
"""

import datetime as dt
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Final, assert_never
from uuid import UUID
from zoneinfo import ZoneInfo

from remi.core import ids
from remi.core.clock import Clock
from remi.core.config import Env
from remi.core.errors import NotFound, OutOfRange, ValidationFailed
from remi.core.uow import Ref, UnitOfWorkFactory, ref
from remi.repositories import models as orm
from remi.repositories.registry import ALIASES, NOTES, PROJECTS, ROUTINES, SETTINGS
from remi.schemas.checkin import (
    ApplyRequest,
    BauDoneChange,
    BlockerChange,
    Change,
    CheckinAppliedOut,
    ConfidenceChange,
    HoursPerDayChange,
    NoteChange,
    ParseRequest,
    PreviewOut,
    PreviewRequest,
    ProjectPreviewOut,
    ProposalOut,
    ProposalSource,
    ScopeAddChange,
    TargetMoveChange,
    TaskAddChange,
    TaskDoneChange,
)
from remi.schemas.mutation import CheckinMutationOut, MovementCause
from remi.services import views
from remi.services.adapters import project_of, save_plan
from remi.services.ai import registry
from remi.services.ai.audit import uow_audit_sink
from remi.services.ai.context import (
    CheckinContextInput,
    ContextMilestone,
    ContextNote,
    ContextProject,
    ContextRoutine,
    ContextTask,
)
from remi.services.ai.registry import AiSettings, DisconnectCheck, EngineInputs
from remi.services.calendar import MAX_ATTEMPTS, YearSpan, extend_for
from remi.services.engine import model as engine
from remi.services.engine.aliases import build_index
from remi.services.engine.calendar import BusinessCalendar, OutOfCalendar
from remi.services.engine.checkin import ProjectOutcome, preview, summarise_checkin
from remi.services.engine.derive import derived_milestones
from remi.services.engine.forecast import InvalidEdit, work_left
from remi.services.engine.model import ProjectPlan
from remi.services.engine.routines import counts_on, rule_text, runs_today
from remi.services.mutations import MutationScope, run_mutation
from remi.services.project_items import add_task, now_milestone_for
from remi.services.projects import add_feed, check_day, check_hours, check_plan_hours
from remi.services.views import PlanState
from remi.utils.dates import fmt_dm
from remi.utils.text import fmt_num, shift_label

DOMAIN_NAMES: Final = {"pc": "Private Credit", "fi": "Fixed Income"}
RECENT_NOTE_BDS: Final = 5
"""Notes from the last five business days up to today go into the context."""
_ROUND: Final = 6


# ---------------------------------------------------------------------------- conversions
def to_engine(change: Change) -> engine.Change:
    """The API change as the engine's frozen dataclass (field for field)."""
    match change:
        case TaskDoneChange():
            return engine.TaskDone(change.project_id, change.task_id)
        case TaskAddChange():
            return engine.TaskAdd(change.project_id, change.text, change.hours)
        case ScopeAddChange():
            return engine.ScopeAdd(change.project_id, change.text, change.hours)
        case BlockerChange():
            return engine.Blocker(change.project_id, change.text)
        case ConfidenceChange():
            return engine.Confidence(change.project_id, change.value)
        case TargetMoveChange():
            return engine.TargetMove(change.project_id, change.date)
        case HoursPerDayChange():
            return engine.HoursPerDay(change.project_id, change.value)
        case NoteChange():
            return engine.Note(change.project_id, change.text)
        case BauDoneChange():
            return engine.BauDone(change.routine_id)
        case _:  # pragma: no cover - the union is exhaustive
            assert_never(change)


def project_of_change(change: Change) -> str | None:
    return None if isinstance(change, BauDoneChange) else change.project_id


def cause_of(outcome: ProjectOutcome) -> MovementCause:
    """What a check-in movement is tagged with: scope, then rate, then target."""
    for cause in ("scope", "rate", "target"):
        if cause in outcome.causes:
            return cause
    return "checkin"


# ---------------------------------------------------------------------------- parse inputs
def recent_bds(cal: BusinessCalendar, today: dt.date) -> list[dt.date]:
    """The last ``RECENT_NOTE_BDS`` business days up to today (today first when it is one)."""
    days: list[dt.date] = []
    if not cal.covers(today):
        return days
    if cal.is_bd(today):
        days.append(today)
    for d in cal.iter_bds_before(today):
        if len(days) >= RECENT_NOTE_BDS:
            break
        days.append(d)
    return days


@dataclass(frozen=True, slots=True)
class ParseInputs:
    """Everything a parse needs, copied out of the database."""

    ai: AiSettings
    engine: EngineInputs
    context: CheckinContextInput


def _local_time(at: dt.datetime, timezone: str) -> str:
    stamp = at if at.tzinfo is not None else at.replace(tzinfo=dt.UTC)
    return stamp.astimezone(ZoneInfo(timezone)).strftime("%H:%M")


def parse_inputs(
    uow_factory: UnitOfWorkFactory, clock: Clock, focus_project_id: str | None
) -> ParseInputs:
    """The provider inputs (409 before setup; 404 for an unknown focus project)."""
    state = views.get_plan_state(uow_factory, clock)
    if focus_project_id is not None and state.plan(focus_project_id) is None:
        raise NotFound("No project with that id.", field="focusProjectId")
    ctx, today = state.ctx, state.today
    with uow_factory.read() as uow:
        ai = AiSettings.from_row(uow.repo(SETTINGS).get())
        aliases = uow.repo(ALIASES).by_entity()
        notes = [
            ContextNote(n.day, _local_time(n.created_at, state.timezone), n.text)
            for n in uow.repo(NOTES).list_days(recent_bds(ctx.cal, today))
        ]
    projects = [
        ContextProject(
            id=p.id,
            name=p.name,
            short=p.short,
            domain=DOMAIN_NAMES.get(p.domain, p.domain),
            forecast=p.plan.forecast,
            target=p.plan.target,
            hours_per_day=p.plan.rate,
            confidence=p.confidence,
            open_tasks=[ContextTask(t.id, t.text, t.hours) for t in p.open_now_tasks()],
            milestones=[ContextMilestone(ms.name, ms.day) for ms in state.derived[p.id].milestones],
            aliases=tuple(aliases.get(p.id, ())),
        )
        for p in state.projects
    ]
    routines = [
        ContextRoutine(
            id=r.id,
            name=r.name,
            rule=rule_text(r),
            runs_today=runs_today(r, ctx),
            aliases=tuple(aliases.get(r.id, ())),
        )
        for r in ctx.routines
    ]
    context = CheckinContextInput(
        today=today,
        today_bdm=ctx.cal.bdm(today) if ctx.cal.covers(today) else None,
        capacity_h=ctx.capacity,
        move=ctx.move,
        focus_project_id=focus_project_id,
        projects=projects,
        routines=routines,
        recent_notes=sorted(notes, key=lambda n: (n.day, n.time)),
    )
    engine_inputs = EngineInputs(
        ctx, state.projects, build_index(state.projects, ctx.routines, aliases)
    )
    return ParseInputs(ai=ai, engine=engine_inputs, context=context)


async def parse(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    env: Env,
    body: ParseRequest,
    inputs: ParseInputs,
    *,
    is_disconnected: DisconnectCheck | None = None,
) -> ProposalOut:
    """``POST /checkins/parse`` with the configured provider (the fake one only in tests).

    Call it outside any unit of work, with ``inputs`` from :func:`parse_inputs` (run that in a
    worker thread: it reads the database)."""
    return await registry.parse(
        body.text,
        body.focus_project_id,
        inputs.context,
        inputs.ai,
        uow_audit_sink(uow_factory, retention_days=inputs.ai.audit_retention_days),
        engine=inputs.engine,
        parse_id=body.parse_id,
        provider_factory=registry.provider_factory_for(env),
        is_disconnected=is_disconnected,
    )


def parse_simple(uow_factory: UnitOfWorkFactory, clock: Clock, body: ParseRequest) -> ProposalOut:
    """``POST /checkins/parse-simple``: the offline reading (no audit row)."""
    inputs = parse_inputs(uow_factory, clock, body.focus_project_id)
    return registry.parse_simple(body.text, body.focus_project_id, inputs.engine, body.parse_id)


def cancel_parse(parse_id: UUID) -> None:
    """``DELETE /checkins/parse/{parseId}`` (idempotent)."""
    registry.PARSE_REGISTRY.cancel(parse_id)


# ---------------------------------------------------------------------------- the one apply path
@dataclass(frozen=True, slots=True)
class ApplyMeta:
    raw_text: str = ""
    source: ProposalSource = "simple"
    parse_id: UUID | None = None
    focus_project_id: str | None = None


@dataclass(slots=True)
class Applied:
    """What :func:`apply_changes` did (also what the preview reports)."""

    batch_id: str
    outcomes: list[ProjectOutcome] = field(default_factory=list[ProjectOutcome])
    checkin_ids: list[str] = field(default_factory=list[str])
    project_ids: list[str] = field(default_factory=list[str])
    routine_ids: list[str] = field(default_factory=list[str])


def _static_checks(changes: Sequence[Change]) -> None:
    """Checks that need no database (422s name the change's field)."""
    for i, change in enumerate(changes):
        if isinstance(change, HoursPerDayChange):
            check_hours(change.value, f"changes.{i}.value")
        elif isinstance(change, TargetMoveChange):
            check_day(change.date, f"changes.{i}.date")


def _snapshot(
    row: orm.Project, plan: ProjectPlan, state: PlanState, today: dt.date
) -> dict[str, Any]:
    """The check-in's snapshot for the history scrubber (after the check-in applied).

    Its milestones are the derived ones, as ``derived.milestones`` shows them (the prototype's
    ``derivedMs``): named, dated Now/Next items, then explicit milestones not already shown."""
    left = work_left(plan, state.ctx)
    return {
        "target": plan.target.isoformat(),
        "forecast": plan.forecast.isoformat() if plan.forecast is not None else None,
        "milestones": [
            {"milestoneId": ms.id, "name": ms.name, "date": ms.day.isoformat()}
            for ms in derived_milestones(project_of(row, plan), today)
        ],
        "rateHoursPerDay": plan.rate,
        "rateAfterMove": plan.rate_after,
        "workLeft": round(left, _ROUND) if left is not None else None,
        "unplacedH": round(plan.unplaced_h, _ROUND),
        "confidence": row.confidence,
    }


def _feed(
    m: MutationScope, row: orm.Project, o: ProjectOutcome, changed: str, what: str, h: float
) -> None:
    title = row.short or row.name
    today = m.today
    if h > 0 and o.scope_from is not None and o.scope_to is not None and o.scope_from != o.scope_to:
        add_feed(
            m.uow,
            project_id=row.id,
            day=today,
            kind="scope",
            tone="risk",
            title=title,
            body=(
                f"Scope added ({what.lower()}, +{fmt_num(h)}h). "
                f"Forecast moved {fmt_dm(o.scope_from)} → {fmt_dm(o.scope_to)}."
            ),
            delta=shift_label(o.scope_slip_bd),
        )
        return
    parts = ["Checked in."]
    if changed:
        parts.append(f"{changed}.")
    frm, to = o.from_forecast, o.to_forecast
    if to is not None:
        if frm is None or frm == to:
            parts.append(f"Forecast holds at {fmt_dm(to)}.")
        else:
            parts.append(f"Forecast moved {fmt_dm(frm)} → {fmt_dm(to)}.")
    add_feed(
        m.uow,
        project_id=row.id,
        day=today,
        kind="checkin",
        tone="quiet",
        title=title,
        body=" ".join(parts),
        delta=shift_label(o.delta_bd or 0),
    )


def apply_changes(m: MutationScope, changes: Sequence[Change], meta: ApplyMeta) -> Applied:
    """Turn reviewed changes into rows inside ``m.uow`` (see the module docstring).

    Records the ``checkin.applied`` event. Raises 404 for an unknown project, task or routine,
    422 for a task of another project or a routine that does not run today."""
    before = m.require_before()
    ctx = before.ctx
    today = m.today
    uow = m.uow
    projects = uow.repo(PROJECTS)
    routines = uow.repo(ROUTINES)
    _static_checks(changes)

    rows: dict[str, orm.Project] = {}
    routine_rows: dict[str, orm.Routine] = {}
    for i, change in enumerate(changes):
        if isinstance(change, BauDoneChange):
            routine = routines.get(change.routine_id)
            if routine is None:
                raise NotFound("No routine with that id.", field=f"changes.{i}.routineId")
            rd = ctx.routine(change.routine_id)
            if rd is None or not counts_on(rd, today, ctx):
                msg = "That routine does not run today."
                raise ValidationFailed(
                    msg, field=f"changes.{i}.routineId", code="NOT_AN_OCCURRENCE"
                )
            routine_rows[change.routine_id] = routine
            continue
        pid = change.project_id
        if pid not in rows:
            row = projects.get(pid)
            if row is None or before.plan(pid) is None:
                raise NotFound("No project with that id.", field=f"changes.{i}.projectId")
            rows[pid] = row
        if isinstance(change, TaskDoneChange):
            task = projects.get_task(change.task_id)
            if task is None:
                raise NotFound("No task with that id.", field=f"changes.{i}.taskId")
            if task.project_id != pid:
                msg = "That task belongs to another project."
                raise ValidationFailed(msg, field=f"changes.{i}.taskId")

    engine_changes = [to_engine(c) for c in changes]
    outcomes = {o.project_id: o for o in preview(engine_changes, before.plans, ctx)}
    for i, change in enumerate(changes):
        if isinstance(change, HoursPerDayChange):
            # a rescale must not leave a BAU-day rule or override below the floor
            check_plan_hours(outcomes[change.project_id].after, f"changes.{i}.value")
    applied = Applied(batch_id=uow.event_id)
    for pid, row in rows.items():
        o = outcomes[pid]
        applied.outcomes.append(o)
        applied.project_ids.append(pid)
        m.cause(pid, cause_of(o))
        save_plan(row, o.after)
        if o.target_after != o.target_before:
            row.target_label = None
        summary = summarise_checkin(pid, engine_changes)
        for task_id in summary.done_task_ids:
            task = projects.get_task(task_id)
            if task is not None and not task.done:
                task.done = True
                task.done_on = today
        for added in summary.task_adds:
            add_task(m, now_milestone_for(m, row, today), added.text, added.hours)
        if summary.confidence is not None:
            row.confidence = summary.confidence
        row.last_checkin_date = today
        row.blocker = summary.blocker
        checkin = orm.CheckIn(
            id=ids.new_id(),
            project_id=pid,
            batch_id=applied.batch_id,
            parse_id=str(meta.parse_id) if meta.parse_id is not None else None,
            date=today,
            note=summary.record_note,
            forecast_date=o.after.forecast,
            target_date=o.after.target,
            confidence=row.confidence,
            blockers=summary.blocker,
            raw_text=meta.raw_text or None,
            source=meta.source,
            changes=[c.model_dump(mode="json") for c in changes if project_of_change(c) == pid],
            done_task_ids=list(summary.done_task_ids),
            snapshot=_snapshot(row, o.after, before, today),
        )
        uow.session.add(checkin)
        uow.session.flush()
        applied.checkin_ids.append(checkin.id)
        if summary.scope_h > 0:
            uow.session.add(
                orm.ScopeChange(
                    id=ids.new_id(),
                    project_id=pid,
                    checkin_id=checkin.id,
                    date=today,
                    what=summary.scope_what,
                    hours=summary.scope_h,
                    slip_bd=o.scope_slip_bd,
                    from_forecast=o.scope_from,
                    to_forecast=o.scope_to,
                )
            )
        _feed(m, row, o, summary.changed, summary.scope_what, summary.scope_h)

    now = m.clock.now()
    for rid, routine in routine_rows.items():
        applied.routine_ids.append(rid)
        items = [i.id for i in sorted(routine.checklist_items, key=lambda i: i.sort_order)]
        if items:
            routines.set_all_ticks(rid, today, items, True, now)
        else:
            routines.upsert_run(rid, today, today, now)

    refs: list[Ref] = [
        *(ref("project", pid) for pid in applied.project_ids),
        *(ref("routine", rid) for rid in applied.routine_ids),
    ]
    uow.record(
        "checkin.applied",
        refs,
        {
            "changes": [c.model_dump(mode="json") for c in changes],
            "source": meta.source,
            "parseId": str(meta.parse_id) if meta.parse_id is not None else None,
            "focusProjectId": meta.focus_project_id,
            "rawText": meta.raw_text,
        },
        effects={"batchId": applied.batch_id, "checkinIds": applied.checkin_ids},
    )
    return applied


# ---------------------------------------------------------------------------- preview
def dry_run[T](uow_factory: UnitOfWorkFactory, clock: Clock, fn: Callable[[MutationScope], T]) -> T:
    """Run ``fn`` against the current plan in a unit of work that always rolls back (no
    event). The calendar widens on ``OutOfCalendar`` like a mutation's."""
    today = clock.today()
    min_span: YearSpan | None = None
    for _ in range(MAX_ATTEMPTS):
        before = views.get_plan_state(uow_factory, clock, min_span=min_span)
        try:
            with uow_factory.dry_run() as uow:
                return fn(MutationScope(uow=uow, clock=clock, before=before))
        except OutOfCalendar as error:
            min_span = extend_for(before.span, error, today)
        except InvalidEdit as error:
            raise ValidationFailed(str(error)) from error
    msg = "That is too far out for Remi's calendar."
    raise OutOfRange(msg)


def _preview_out(o: ProjectOutcome) -> ProjectPreviewOut:
    return ProjectPreviewOut(
        project_id=o.project_id,
        from_=o.from_forecast,
        to=o.to_forecast,
        delta_bd=o.delta_bd or 0,
        late=o.late,
        label=o.label,
        target_after=o.target_after,
        new_over=[ov.day for ov in o.new_over],
        misses_key_run=o.misses_key_run,
        past_target_bd=o.past_target_bd,
    )


def touched(o: ProjectOutcome) -> bool:
    """The changes touch this project's forecast or target (so the review shows a chip)."""
    return bool(o.causes) or o.from_forecast != o.to_forecast


def preview_checkin(
    uow_factory: UnitOfWorkFactory, clock: Clock, body: PreviewRequest
) -> PreviewOut:
    """``POST /checkins/preview``: :func:`apply_changes` in a dry run."""
    changes = list(body.changes)
    _static_checks(changes)
    if not changes:
        views.get_plan_state(uow_factory, clock)  # still 409 before setup
        return PreviewOut(projects=[])
    applied = dry_run(uow_factory, clock, lambda m: apply_changes(m, changes, ApplyMeta()))
    return PreviewOut(projects=[_preview_out(o) for o in applied.outcomes if touched(o)])


# ---------------------------------------------------------------------------- apply
def apply_checkin(
    uow_factory: UnitOfWorkFactory, clock: Clock, body: ApplyRequest
) -> CheckinMutationOut:
    """``POST /checkins/apply``: one transaction, one event, one check-in row per project."""
    changes = list(body.changes)
    _static_checks(changes)
    meta = ApplyMeta(
        raw_text=body.raw_text,
        source=body.source,
        parse_id=body.parse_id,
        focus_project_id=body.focus_project_id,
    )

    def change(m: MutationScope) -> Applied:
        if (
            meta.focus_project_id is not None
            and m.require_before().plan(meta.focus_project_id) is None
        ):
            raise NotFound("No project with that id.", field="focusProjectId")
        return apply_changes(m, changes, meta)

    actor = "ai-proposal-accepted" if body.source == "ai" else "simple-proposal-accepted"
    result = run_mutation(uow_factory, clock, change, "checkin", actor=actor)
    applied = result.value
    entity = CheckinAppliedOut(
        batch_id=applied.batch_id,
        checkin_ids=applied.checkin_ids,
        project_ids=applied.project_ids,
        routine_ids=applied.routine_ids,
    )
    return result.with_entity(CheckinMutationOut, entity)
