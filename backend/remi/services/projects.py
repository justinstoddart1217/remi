"""Projects: create, edit, re-plan, delete, and the data-only hour rules.

Every write is one ``run_mutation`` (one transaction, one ``remi_events`` row) and returns
``MutationOut{plan, movements, entity?}``.

- **Create** (``POST /projects``) makes a project in Define: "Untitled project", start today,
  target today + ``settings.new_project_horizon_bd`` business days, **no forecast**
  (ADR-0007: no invented numbers), no rates, no BAU-day rules, exit routes ``[]`` for Private
  Credit and ``null`` for Fixed Income, end name "Done".
- **Edit** (``PATCH``): text fields, the target (snapped to the next business day; a real move
  clears ``targetLabel`` and logs the feed item "Target moved A → B."), confidence, readiness,
  blocker, and the data-only fields (phase logs "Phase moved A → B."; exit routes are stored).
  An unchanged target is a no-op, like the prototype's picker.
- **Replan** runs ``forecast.refit`` (rate, work left or start); ``InvalidEdit`` is a 422.
- **Delete** cascades to every child row, feed item and alias, clears the key project and
  unlinks routines. Deleting the last project is allowed.
- **Hour rules** (BAU-day hours, per-day overrides) and the after-move rate are data only (no
  UI). They change the project's hours per day but not its work left, so the forecast is placed
  again from the work left it had before (``scope.refit_forecasts``, ADR-0007).
- **Fixed Income** projects plan hours after the move (the domain's main period): a new Fixed
  Income project has no rates, and its first rate or work left sets the after-move rate to the
  same figure (``forecast.rescale`` / ``_effective``; a first work left plans 1h a day). Later
  rate edits scale it like the other figures. A Private Credit project keeps 0h after the move.

Hours a day, after-move rates, BAU-day hours and overrides must be 0 or ``MIN_HOURS`` (0.05h)
to ``MAX_HOURS`` (24h): smaller positive values break the ``finish_for`` invariant (ADR-0007,
"Invariant precondition"), and no day holds more than 24 hours. A rate change rescales the
other figures, so replan (and its preview) and hours-a-day check-ins refuse a rate whose
rescale would leave one outside that range (422 on the rate field).
"""

import datetime as dt
from collections.abc import Mapping
from dataclasses import replace
from typing import Final

from pydantic.alias_generators import to_camel

from remi.core import ids
from remi.core.clock import Clock
from remi.core.errors import NotFound, OutOfRange, SetupRequired, ValidationFailed
from remi.core.uow import UnitOfWork, UnitOfWorkFactory, ref
from remi.repositories import models as orm
from remi.repositories.registry import FEED, PROJECTS, ROUTINES, SETTINGS
from remi.schemas.mutation import MovementCause, MutationOut, ProjectMutationOut
from remi.schemas.project import (
    BauDayHoursPut,
    ProjectCreate,
    ProjectOut,
    ProjectPatch,
    ProjectSnapshotOut,
    ReplanIn,
    ReplanPreviewOut,
)
from remi.services import views
from remi.services.adapters import plan_of, save_plan
from remi.services.calendar import check_in_range
from remi.services.engine import forecast
from remi.services.engine.derive import derive_project
from remi.services.engine.forecast import (
    MAX_HOURS,
    MIN_HOURS,
    Edit,
    RateEdit,
    StartEdit,
    WorkLeftEdit,
    plan_hours_problem,
)
from remi.services.engine.loads import build_loads, plan_window
from remi.services.engine.model import ProjectPlan
from remi.services.mutations import MutationScope, run_mutation
from remi.services.views import PlanState
from remi.utils.dates import fmt_s

UNTITLED: Final = "Untitled project"
SHORT_MAX: Final = 80
"""``projects.short`` is at most 80 characters; a longer name is cut when it sets ``short``."""
DEFAULT_END_NAME: Final = "Done"
_ROUND: Final = 6

_NOT_NULLABLE: Final = frozenset(
    {
        "name",
        "short",
        "goal",
        "why_now",
        "later_intent",
        "end_name",
        "target_date",
        "baseline_hours",
        "rate_after_move",
        "phase",
        "sort_order",
    }
)
"""``ProjectPatch`` keys that cannot be cleared with ``null``."""


# ---------------------------------------------------------------------------- shared helpers
def check_hours(value: float, field: str) -> None:
    """422 unless ``value`` is 0 or ``MIN_HOURS`` to ``MAX_HOURS``."""
    if 0 < value < MIN_HOURS:
        msg = f"Use 0, or at least {MIN_HOURS:g}h."
        raise ValidationFailed(msg, field=field)
    if value > MAX_HOURS:
        msg = f"Use at most {MAX_HOURS:g}h."
        raise ValidationFailed(msg, field=field)


def check_day(day: dt.date, field: str) -> None:
    """422 ``OUT_OF_RANGE`` (naming ``field``) outside the supported years."""
    try:
        check_in_range(day)
    except OutOfRange as error:
        raise OutOfRange(error.message, field=field) from None


def check_plan_hours(plan: ProjectPlan, field: str) -> None:
    """Every stored hour figure of ``plan`` is 0 or ``MIN_HOURS`` to ``MAX_HOURS`` (a rescale
    can push the after-move rate, BAU-day hours or overrides out of that range)."""
    problem = plan_hours_problem(plan)
    if problem == "below_min":
        msg = f"That would plan some days at less than {MIN_HOURS:g}h. Use a larger value."
        raise ValidationFailed(msg, field=field)
    if problem == "above_max":
        msg = f"That would plan some days at more than {MAX_HOURS:g}h. Use a smaller value."
        raise ValidationFailed(msg, field=field)


def clean(text: str) -> str:
    """Text as stored: surrounding whitespace removed."""
    return text.strip()


def add_feed(
    uow: UnitOfWork,
    *,
    project_id: str | None,
    day: dt.date,
    kind: str,
    title: str,
    body: str,
    delta: str,
    tone: str = "quiet",
    routine_id: str | None = None,
) -> orm.FeedEvent:
    """Store one activity item (data only: the design renders no feed)."""
    item = orm.FeedEvent(
        id=ids.new_id(),
        project_id=project_id,
        routine_id=routine_id,
        day=day,
        kind=kind,
        title=title,
        body=body,
        delta=delta,
        tone=tone,
    )
    return uow.repo(FEED).add(item)


def target_text(row: orm.Project) -> str:
    """How the prototype names a target in the feed: its fuzzy label, else ``Fri 27 Nov``."""
    return row.target_label or fmt_s(row.target_date)


def require_setup_done(uow_factory: UnitOfWorkFactory) -> None:
    if not views.settings_info(uow_factory).complete:
        raise SetupRequired


# ---------------------------------------------------------------------------- reads
def list_projects(uow_factory: UnitOfWorkFactory, clock: Clock) -> list[ProjectOut]:
    """``GET /projects``: every project as the plan shows it (PC first, then FI)."""
    return list(views.get_plan_state(uow_factory, clock).out.projects)


def get_project(uow_factory: UnitOfWorkFactory, clock: Clock, project_id: str) -> ProjectOut:
    found = views.get_plan_state(uow_factory, clock).project_out(project_id)
    if found is None:
        raise NotFound("No project with that id.")
    return found


def project_snapshots(uow_factory: UnitOfWorkFactory, project_id: str) -> list[ProjectSnapshotOut]:
    """``GET /projects/{id}/snapshots``: check-in snapshots, oldest first."""
    require_setup_done(uow_factory)
    return views.project_snapshots(uow_factory, project_id)


# ---------------------------------------------------------------------------- create
def create_project(
    uow_factory: UnitOfWorkFactory, clock: Clock, body: ProjectCreate
) -> ProjectMutationOut:
    name = clean(body.name or "") or UNTITLED

    def change(m: MutationScope) -> str:
        before = m.require_before()
        settings = m.uow.repo(SETTINGS).get()
        repo = m.uow.repo(PROJECTS)
        today = m.today
        row = orm.Project(
            id=ids.new_id(),
            domain=body.domain,
            name=name,
            short=name[:SHORT_MAX],
            goal="",
            why_now="",
            later_intent="",
            end_name=DEFAULT_END_NAME,
            start_date=today,
            target_date=before.cal.add_bd(today, settings.new_project_horizon_bd),
            target_label=None,
            forecast_date=None,
            prev_forecast_date=None,
            rate_hours_per_day=0.0,
            rate_after_move=0.0,
            baseline_hours=0.0,
            unplaced_hours=0.0,
            confidence=None,
            last_checkin_date=None,
            blocker=None,
            readiness=None,
            after_day_one_note=None,
            phase=0,
            exit_routes=[] if body.domain == "pc" else None,
            sort_order=repo.next_sort_order(body.domain),
        )
        repo.add(row)
        m.uow.record(
            "project.created", [ref("project", row.id)], {"domain": body.domain, "name": name}
        )
        return row.id

    result = run_mutation(uow_factory, clock, change, "target")
    return result.with_entity(ProjectMutationOut, result.project(result.value))


# ---------------------------------------------------------------------------- edit
def _camel(name: str) -> str:
    return to_camel(name)


def _required_text(value: str | None, field: str) -> str:
    text = clean(value or "")
    if not text:
        msg = "This cannot be blank."
        raise ValidationFailed(msg, field=_camel(field))
    return text


def _optional_text(value: str | None) -> str | None:
    text = clean(value or "")
    return text or None


def update_project(
    uow_factory: UnitOfWorkFactory, clock: Clock, project_id: str, body: ProjectPatch
) -> ProjectMutationOut:
    sent = body.model_fields_set
    for name in sorted(sent & _NOT_NULLABLE):
        if getattr(body, name) is None:
            msg = "This cannot be cleared."
            raise ValidationFailed(msg, field=_camel(name))
    if body.rate_after_move is not None:
        check_hours(body.rate_after_move, "rateAfterMove")
    if body.target_date is not None:
        check_day(body.target_date, "targetDate")
    routes = body.exit_routes
    if routes is not None and len(set(routes)) != len(routes):
        msg = "An exit route can appear only once."
        raise ValidationFailed(msg, field="exitRoutes")

    def change(m: MutationScope) -> None:
        before = m.require_before()
        row = m.uow.repo(PROJECTS).require(project_id)
        today = m.today
        if "name" in sent:
            row.name = _required_text(body.name, "name")
            if "short" not in sent:
                row.short = row.name[:SHORT_MAX]
        if "short" in sent:
            row.short = _required_text(body.short, "short")
        if "goal" in sent:
            row.goal = clean(body.goal or "")
        if "why_now" in sent:
            row.why_now = clean(body.why_now or "")
        if "later_intent" in sent:
            row.later_intent = clean(body.later_intent or "")
        if "end_name" in sent:
            row.end_name = _required_text(body.end_name, "end_name")
        if "target_date" in sent and body.target_date is not None:
            snapped = before.cal.next_bd(body.target_date)
            if snapped != row.target_date:
                old = target_text(row)
                row.target_date = snapped
                row.target_label = None
                m.cause(project_id, "target")
                add_feed(
                    m.uow,
                    project_id=project_id,
                    day=today,
                    kind="edit",
                    title=row.short or row.name,
                    body=f"Target moved {old} → {fmt_s(snapped)}.",
                    delta="Target",
                )
        if "target_label" in sent:
            row.target_label = _optional_text(body.target_label)
        if "confidence" in sent:
            row.confidence = body.confidence
        if "readiness" in sent:
            row.readiness = body.readiness
        if "blocker" in sent:
            row.blocker = _optional_text(body.blocker)
        if "after_day_one_note" in sent:
            row.after_day_one_note = _optional_text(body.after_day_one_note)
        if "baseline_hours" in sent and body.baseline_hours is not None:
            row.baseline_hours = body.baseline_hours
        if (
            "rate_after_move" in sent
            and body.rate_after_move is not None
            and body.rate_after_move != row.rate_after_move
        ):
            row.rate_after_move = body.rate_after_move
            m.cause(project_id, "rate")
            m.refit_forecasts()
        if "phase" in sent and body.phase is not None and body.phase != row.phase:
            old_phase = orm.PHASES[row.phase]
            row.phase = body.phase
            add_feed(
                m.uow,
                project_id=project_id,
                day=today,
                kind="edit",
                title=row.short or row.name,
                body=f"Phase moved {old_phase} → {orm.PHASES[body.phase]}.",
                delta=orm.PHASES[body.phase],
            )
        if "exit_routes" in sent:
            if row.domain == "fi" and routes is not None:
                msg = "Exit routes are for Private Credit projects only."
                raise ValidationFailed(msg, field="exitRoutes")
            row.exit_routes = list(routes) if routes is not None else None
        if "sort_order" in sent and body.sort_order is not None:
            row.sort_order = body.sort_order
        m.uow.record(
            "project.updated",
            [ref("project", project_id)],
            body.model_dump(mode="json", exclude_unset=True),
        )

    result = run_mutation(uow_factory, clock, change, "target")
    return result.with_entity(ProjectMutationOut, result.project(project_id))


# ---------------------------------------------------------------------------- delete
def delete_project(uow_factory: UnitOfWorkFactory, clock: Clock, project_id: str) -> MutationOut:
    def change(m: MutationScope) -> None:
        repo = m.uow.repo(PROJECTS)
        row = repo.require(project_id, full=False)
        settings = m.uow.repo(SETTINGS).get()
        if settings.key_project_id == project_id:
            settings.key_project_id = None
        for routine in m.uow.repo(ROUTINES).list():
            if routine.project_id == project_id:
                routine.project_id = None
        name = row.name
        repo.delete(row)
        m.uow.record("project.deleted", [ref("project", project_id)], {"name": name})

    return run_mutation(uow_factory, clock, change).out()


# ---------------------------------------------------------------------------- replan
def edit_of(body: ReplanIn) -> tuple[Edit, MovementCause]:
    """The engine edit a ``ReplanIn`` asks for, validated."""
    if body.rate is not None:
        check_hours(body.rate, "rate")
        return RateEdit(body.rate), "rate"
    if body.work_left is not None:
        return WorkLeftEdit(body.work_left), "work_left"
    if body.start_date is None:  # pragma: no cover - ReplanIn requires exactly one
        msg = "send exactly one of rate, workLeft or startDate"
        raise ValidationFailed(msg)
    check_day(body.start_date, "startDate")
    return StartEdit(body.start_date), "start"


def _field_of(body: ReplanIn) -> str:
    if body.rate is not None:
        return "rate"
    return "workLeft" if body.work_left is not None else "startDate"


def replan(
    uow_factory: UnitOfWorkFactory, clock: Clock, project_id: str, body: ReplanIn
) -> ProjectMutationOut:
    """``POST /projects/{id}/replan``: ``forecast.refit`` saved onto the project."""
    edit, cause = edit_of(body)

    def change(m: MutationScope) -> None:
        before = m.require_before()
        row = m.uow.repo(PROJECTS).require(project_id)
        plan = before.plan(project_id)
        if plan is None:
            raise NotFound("No project with that id.")
        try:
            new = forecast.refit(plan, edit, before.ctx).plan
        except forecast.InvalidEdit as error:
            raise ValidationFailed(str(error), field=_field_of(body)) from error
        check_plan_hours(new, _field_of(body))
        save_plan(row, new)
        m.uow.record(
            "project.replanned",
            [ref("project", project_id)],
            body.model_dump(mode="json", exclude_none=True),
        )

    result = run_mutation(uow_factory, clock, change, cause)
    return result.with_entity(ProjectMutationOut, result.project(project_id))


def preview_replan(
    uow_factory: UnitOfWorkFactory, clock: Clock, project_id: str, body: ReplanIn
) -> ReplanPreviewOut:
    """``POST /projects/{id}/replan/preview``: the same refit, nothing saved."""
    edit, _ = edit_of(body)

    def compute(state: PlanState) -> ReplanPreviewOut:
        plan = state.plan(project_id)
        project = next((p for p in state.projects if p.id == project_id), None)
        if plan is None or project is None:
            raise NotFound("No project with that id.")
        try:
            new = forecast.refit(plan, edit, state.ctx).plan
        except forecast.InvalidEdit as error:
            raise ValidationFailed(str(error), field=_field_of(body)) from error
        check_plan_hours(new, _field_of(body))
        plans = [new if p.id == project_id else p for p in state.plans]
        window = plan_window(state.ctx, plans)
        loads = build_loads(window[0], window[1], plans, state.ctx)
        derived = derive_project(replace(project, plan=new), state.ctx, loads)
        with uow_factory.read() as uow:
            row = uow.repo(PROJECTS).require(project_id)
            derived_out = views.project_derived_out(row, new, derived, state.ctx)
        frm, to = plan.forecast, new.forecast
        left = forecast.work_left(new, state.ctx)
        return ReplanPreviewOut(
            project_id=project_id,
            from_forecast=frm,
            to_forecast=to,
            delta_bd=state.cal.bd_diff(frm, to) if frm is not None and to is not None else 0,
            rate=new.rate,
            work_left=round(left, _ROUND) if left is not None else None,
            unplaced_h=round(new.unplaced_h, _ROUND),
            derived=derived_out,
        )

    days = [body.start_date] if body.start_date is not None else []
    return views.with_plan_state(uow_factory, clock, compute, days=days)


# ---------------------------------------------------------------------------- hour rules
def _unique_rules(body: BauDayHoursPut) -> dict[str, float]:
    rules: dict[str, float] = {}
    for i, rule in enumerate(body.rules):
        check_hours(rule.hours, f"rules.{i}.hours")
        if rule.routine_id in rules:
            msg = "Each routine can appear only once."
            raise ValidationFailed(msg, field=f"rules.{i}.routineId")
        rules[rule.routine_id] = rule.hours
    return rules


def _save_rules(
    row: orm.Project,
    *,
    bau_day_hours: Mapping[str, float] | None = None,
    overrides: Mapping[dt.date, float] | None = None,
) -> None:
    """Write new hour rules onto the row, every other planning field as stored."""
    current = plan_of(row)
    save_plan(
        row,
        replace(
            current,
            bau_day_hours=dict(bau_day_hours)
            if bau_day_hours is not None
            else current.bau_day_hours,
            overrides=dict(overrides) if overrides is not None else current.overrides,
        ),
    )


def put_bau_day_hours(
    uow_factory: UnitOfWorkFactory, clock: Clock, project_id: str, body: BauDayHoursPut
) -> ProjectMutationOut:
    """Replace the project's hours on routine days (data only; the work left stays and the
    forecast is placed again)."""
    rules = _unique_rules(body)

    def change(m: MutationScope) -> None:
        row = m.uow.repo(PROJECTS).require(project_id)
        routines = m.uow.repo(ROUTINES)
        for i, routine_id in enumerate(rules):
            if not routines.exists(routine_id):
                raise NotFound("No routine with that id.", field=f"rules.{i}.routineId")
        _save_rules(row, bau_day_hours=rules)
        m.refit_forecasts()
        m.uow.record(
            "project.bau_day_hours_set",
            [ref("project", project_id), *(ref("routine", r) for r in rules)],
            {"rules": rules},
        )

    result = run_mutation(uow_factory, clock, change, "bau_day_hours")
    return result.with_entity(ProjectMutationOut, result.project(project_id))


def put_override(
    uow_factory: UnitOfWorkFactory, clock: Clock, project_id: str, day: dt.date, hours: float
) -> ProjectMutationOut:
    """Set the project's hours on one day (data only; the work left stays and the forecast is
    placed again)."""
    check_hours(hours, "hours")
    check_day(day, "iso")

    def change(m: MutationScope) -> None:
        row = m.uow.repo(PROJECTS).require(project_id)
        overrides = {o.date: o.hours for o in row.hour_overrides}
        overrides[day] = hours
        _save_rules(row, overrides=overrides)
        m.refit_forecasts()
        m.uow.record(
            "project.override_set",
            [ref("project", project_id)],
            {"day": day.isoformat(), "hours": hours},
        )

    result = run_mutation(uow_factory, clock, change, "override")
    return result.with_entity(ProjectMutationOut, result.project(project_id))


def delete_override(
    uow_factory: UnitOfWorkFactory, clock: Clock, project_id: str, day: dt.date
) -> ProjectMutationOut:
    """Clear the project's hours override on one day (idempotent; data only; the work left
    stays and the forecast is placed again)."""
    check_day(day, "iso")

    def change(m: MutationScope) -> None:
        row = m.uow.repo(PROJECTS).require(project_id)
        overrides = {o.date: o.hours for o in row.hour_overrides if o.date != day}
        _save_rules(row, overrides=overrides)
        m.refit_forecasts()
        m.uow.record(
            "project.override_cleared", [ref("project", project_id)], {"day": day.isoformat()}
        )

    result = run_mutation(uow_factory, clock, change, "override")
    return result.with_entity(ProjectMutationOut, result.project(project_id))
