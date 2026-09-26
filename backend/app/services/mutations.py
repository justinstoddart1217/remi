"""``run_mutation``: the one way every mutating service changes the plan.

It gives each mutation the same shape (``MutationOut{plan, movements, entity?}``)::

    def rename(uow_factory, clock, project_id, name) -> ProjectMutationOut:
        def change(m: MutationScope) -> str:
            project = m.uow.repo(PROJECTS).require(project_id)
            project.name = name
            m.uow.record("project.renamed", [ref("project", project_id)], {"name": name})
            return project_id

        result = run_mutation(uow_factory, clock, change, causes="target")
        return result.with_entity(ProjectMutationOut, result.project(project_id))

Steps:

1. the plan before the change (``PlanState``, usually from the cache; ``None`` before setup
   unless ``require_setup``);
2. ``fn(scope)`` in one write unit of work, which must call ``scope.uow.record(...)``
   exactly once when it changes state (the unit of work refuses to commit otherwise);
3. the plan after (recomputed: the new event bumped the revision);
4. ``movements``: ``engine.checkin.diff_movements`` over the two plans, each tagged with the
   cause ``fn`` gave for that project (``scope.cause(pid, "scope")``), else the default. The
   diff runs on a calendar covering both plans' years (built in memory when the plan after the
   change covers fewer years than the one before), so no movement is dropped.

``fn`` may read the engine state before the change from ``scope.before`` (its ``ctx`` has the
business calendar, ``plans`` the engine plans), e.g. to ``refit`` a plan and ``save_plan`` it.

A change that alters how many hours projects get per day, or which days are business days,
without touching their work left (the move date, the holiday region, a holiday, a routine's
rule or stage, a project's BAU-day hours, overrides or after-move rate) calls
``scope.refit_forecasts()``. After ``fn``, in the same unit of work, every stored forecast is
then placed again from the work left it had before the change (``forecast.carry_work_left``
over the engine state the change produced), so the forecasts, and the movements reported,
follow the edit and a forecast never stays on a day that lost its hours (ADR-0007).
When the engine runs out of calendar inside ``fn`` (``OutOfCalendar``), the unit of work rolls
back, the calendar is widened and ``fn`` runs again, so it must not have side effects outside
the unit of work (use ``uow.after_rollback`` for files). ``forecast.InvalidEdit`` becomes a 422
``VALIDATION_FAILED``.
"""

import datetime as dt
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Final

from pydantic import BaseModel

from app.core.clock import Clock
from app.core.errors import NotFound, OutOfRange, SetupRequired, ValidationFailed
from app.core.uow import UnitOfWork, UnitOfWorkFactory
from app.repositories.models import Actor
from app.repositories.registry import PROJECTS, ROUTINES, SETTINGS
from app.schemas.mutation import Movement, MovementCause, MutationOut
from app.schemas.plan import PlanOut
from app.schemas.project import ProjectOut
from app.schemas.routine import RoutineOut
from app.services import holidays
from app.services.adapters import engine_ctx, plan_of, routine_of, save_plan
from app.services.calendar import (
    MAX_ATTEMPTS,
    YearSpan,
    calendar_for,
    calendar_in,
    default_span,
    extend_for,
)
from app.services.engine.calendar import BusinessCalendar, OutOfCalendar
from app.services.engine.checkin import diff_movements
from app.services.engine.forecast import InvalidEdit, carry_work_left
from app.services.engine.model import ProjectPlan
from app.services.views import PlanState, get_plan_state, setup_complete

DEFAULT_CAUSE: Final[MovementCause] = "checkin"


@dataclass(slots=True)
class MutationScope:
    """What a mutation's ``fn`` gets: its unit of work and the plan before the change."""

    uow: UnitOfWork
    clock: Clock
    before: PlanState | None
    """The plan before the change; ``None`` only when setup is not complete."""
    default_cause: MovementCause = DEFAULT_CAUSE
    causes: dict[str, MovementCause] = field(default_factory=dict[str, MovementCause])
    refit: bool = False
    """Set by ``refit_forecasts``: re-place every forecast's work left after ``fn``."""

    def cause(self, project_id: str, cause: MovementCause) -> None:
        """Tag the movement of ``project_id`` (the first tag for a project wins)."""
        self.causes.setdefault(project_id, cause)

    def refit_forecasts(self) -> None:
        """This change reshapes the hours per day or the calendar: once ``fn`` returns, place
        every stored forecast again from the work left it had before the change."""
        self.refit = True

    def require_before(self) -> PlanState:
        """The plan before the change, or ``SetupRequired`` (409)."""
        if self.before is None:
            raise SetupRequired
        return self.before

    @property
    def today(self) -> dt.date:
        return self.clock.today()


@dataclass(frozen=True, slots=True)
class Mutation[T]:
    """The outcome of ``run_mutation``: ``fn``'s value, the new plan and the movements."""

    value: T
    plan: PlanOut | None
    """``None`` only when setup is still not complete after the mutation."""
    movements: list[Movement]
    state: PlanState | None

    def require_plan(self) -> PlanOut:
        if self.plan is None:
            raise SetupRequired
        return self.plan

    def out(self) -> MutationOut:
        """``MutationOut`` without an entity (deletes, bulk changes)."""
        return MutationOut(plan=self.require_plan(), movements=self.movements)

    def with_entity[M: MutationOut](self, cls: type[M], entity: BaseModel | None) -> M:
        """A typed ``*MutationOut`` (e.g. ``ProjectMutationOut``) carrying ``entity``."""
        return cls.model_validate(
            {"plan": self.require_plan(), "movements": self.movements, "entity": entity}
        )

    def project(self, project_id: str) -> ProjectOut:
        """The project as the new plan shows it (``NotFound`` if it is gone)."""
        found = next((p for p in self.require_plan().projects if p.id == project_id), None)
        if found is None:
            raise NotFound("No project with that id.")
        return found

    def routine(self, routine_id: str) -> RoutineOut:
        """The routine as the new plan shows it (``NotFound`` if it is gone)."""
        found = next((r for r in self.require_plan().routines if r.id == routine_id), None)
        if found is None:
            raise NotFound("No routine with that id.")
        return found


def refit_keeping_work_left(scope: MutationScope) -> list[str]:
    """Place every stored forecast again, under the engine state ``scope``'s change produced,
    from the work left it had before the change. Returns the ids of the projects it moved.

    Runs inside the change's unit of work (so ``OutOfCalendar`` widens the calendar and retries
    the whole mutation, like any other walk). The new calendar covers at least the span of the
    plan before the change and the (possibly new) move date's default span, in the (possibly
    new) holiday region."""
    before = scope.before
    if before is None:
        return []
    uow = scope.uow
    uow.session.flush()
    # Rows the change removed through database cascades (a deleted routine's BAU-day rules)
    # may still sit in loaded collections: read everything again from the transaction.
    uow.session.expire_all()
    settings = uow.repo(SETTINGS).get()
    if settings.move_date is None:
        return []
    today = scope.today
    span = before.span.union(default_span(today, settings.move_date))
    cal = calendar_in(uow, settings.holiday_region, span, today)
    ctx = engine_ctx(
        settings, cal, today=today, routines=[routine_of(r) for r in uow.repo(ROUTINES).list()]
    )
    moved: list[str] = []
    for row in uow.repo(PROJECTS).list():
        old = before.plan(row.id)
        if old is None or old.forecast is None:
            continue
        current = plan_of(row)
        placed = carry_work_left(old, before.ctx, current, ctx)
        if placed is not current:
            save_plan(row, placed)
            moved.append(row.id)
    return moved


def _is_setup_complete(uow_factory: UnitOfWorkFactory) -> bool:
    with uow_factory.read() as uow:
        return setup_complete(uow.repo(SETTINGS).get())


def _state_or_none(
    uow_factory: UnitOfWorkFactory, clock: Clock, min_span: YearSpan | None
) -> PlanState | None:
    if not _is_setup_complete(uow_factory):
        return None
    return get_plan_state(uow_factory, clock, min_span=min_span)


def _diff_span(before: PlanState, after: PlanState) -> YearSpan:
    """The years both plans' dates (and calendars) cover."""
    dates = [d for p in (*before.plans, *after.plans) for d in (p.forecast, p.target)]
    return before.span.union(after.span).including(dates)


def movements_between(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    before: PlanState | None,
    after: PlanState | None,
    causes: Mapping[str, MovementCause],
    default_cause: MovementCause = DEFAULT_CAUSE,
) -> list[Movement]:
    """A ``Movement`` for every project whose forecast or target changed.

    The diff needs a calendar that covers both plans. The plan after the change usually does
    (its span only grows); when it does not, the calendar over the union of both spans is built
    in memory (stored holidays where there are any, nothing written) and widened on
    ``OutOfCalendar`` up to 2100.
    """
    if before is None or after is None:
        return []
    today = clock.today()
    span = _diff_span(before, after)
    for _ in range(MAX_ATTEMPTS):
        cal = (
            after.cal
            if after.span.contains(span)
            else calendar_for(uow_factory, clock, after.region, span, persist=False)
        )
        try:
            return plan_movements(before.plans, after.plans, cal, causes, default_cause)
        except OutOfCalendar as error:
            span = extend_for(span, error, today, limit_year=holidays.MAX_YEAR)
    msg = "That is too far out for Remi's calendar."
    raise OutOfRange(msg)


def plan_movements(
    before: tuple[ProjectPlan, ...] | list[ProjectPlan],
    after: tuple[ProjectPlan, ...] | list[ProjectPlan],
    cal: BusinessCalendar,
    causes: Mapping[str, MovementCause],
    default_cause: MovementCause = DEFAULT_CAUSE,
) -> list[Movement]:
    """``engine.checkin.diff_movements`` as API ``Movement`` DTOs with the given causes.

    ``cal`` must cover every forecast in both plans: ``OutOfCalendar`` propagates (use
    ``movements_between`` for two ``PlanState``s, which picks and widens the calendar)."""
    moved = diff_movements(before, after, {}, cal)
    return [
        Movement(
            project_id=m.project_id,
            from_forecast=m.from_forecast,
            to_forecast=m.to_forecast,
            delta_bd=m.delta_bd if m.delta_bd is not None else 0,
            from_target=m.from_target,
            to_target=m.to_target,
            cause=causes.get(m.project_id, default_cause),
            label=m.label,
            flash=m.flash,
            moved=m.moved,
        )
        for m in moved
    ]


def run_mutation[T](
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    fn: Callable[[MutationScope], T],
    causes: MovementCause | Mapping[str, MovementCause] = DEFAULT_CAUSE,
    *,
    actor: Actor = "user",
    require_setup: bool = True,
    track_movements: bool = True,
) -> Mutation[T]:
    """Run ``fn`` in one unit of work and return the new plan and the movements it caused.

    ``causes`` is the default cause for every movement, or a ``{project_id: cause}`` map
    (``fn`` can add more with ``scope.cause``). ``require_setup`` (the default) refuses with
    ``SetupRequired`` before first-run setup; pass ``False`` for mutations that also work before
    it (setup itself, fixtures, notes), in which case ``scope.before`` may be ``None``.
    """
    default_cause: MovementCause = causes if isinstance(causes, str) else DEFAULT_CAUSE
    tagged: dict[str, MovementCause] = {} if isinstance(causes, str) else dict(causes)
    min_span: YearSpan | None = None
    today = clock.today()
    done: tuple[T, MutationScope, PlanState | None] | None = None
    for _ in range(MAX_ATTEMPTS):
        before = _state_or_none(uow_factory, clock, min_span)
        if before is None and require_setup:
            raise SetupRequired
        try:
            with uow_factory(actor) as uow:
                scope = MutationScope(
                    uow=uow,
                    clock=clock,
                    before=before,
                    default_cause=default_cause,
                    causes=dict(tagged),
                )
                value = fn(scope)
                if scope.refit:
                    refit_keeping_work_left(scope)
                done = (value, scope, before)
        except OutOfCalendar as error:
            if before is None:
                raise OutOfRange("That is too far out for Remi's calendar.") from error
            min_span = extend_for(before.span, error, today)
            continue
        except InvalidEdit as error:
            raise ValidationFailed(str(error)) from error
        break
    if done is None:
        msg = "That is too far out for Remi's calendar."
        raise OutOfRange(msg)
    value, scope, before = done

    after = _state_or_none(uow_factory, clock, None)
    movements = (
        movements_between(uow_factory, clock, before, after, scope.causes, scope.default_cause)
        if track_movements
        else []
    )
    return Mutation(
        value=value,
        plan=after.out if after is not None else None,
        movements=movements,
        state=after,
    )
