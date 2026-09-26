"""Routine occurrence, the BAU domain window, next runs, rule text and effort."""

from dataclasses import dataclass
from datetime import date

from remi.services.engine.calendar import BusinessCalendar
from remi.services.engine.model import HANDED_OVER, Domain, EngineCtx, RoutineDef
from remi.utils.dates import WEEKDAYS_LONG, WEEKDAYS_SHORT
from remi.utils.text import ordinal, round_half_up


def occurs(r: RoutineDef, d: date, cal: BusinessCalendar) -> bool:
    """True when the routine's rule fires on ``d`` (a business day). Ignores stage and domain.

    A monthly routine whose ``bd`` exceeds the month's business-day count does not run that
    month; there is no clamp to the last business day.
    """
    if not cal.is_bd(d):
        return False
    if r.kind == "daily":
        return True
    if r.kind == "weekly":
        return d.isoweekday() == r.weekday
    return cal.bdm(d) == r.bd


def in_domain_window(domain: Domain, d: date, move: date) -> bool:
    """Private Credit work happens before the move; Fixed Income work from the move on."""
    return d < move if domain == "pc" else d >= move


def counts_on(r: RoutineDef, d: date, ctx: EngineCtx) -> bool:
    """The routine takes the user's time on ``d``: it existed by then (``starts_on``), is not
    handed over, is in its domain's window, and its rule fires."""
    return (
        (r.starts_on is None or d >= r.starts_on)
        and r.stage < HANDED_OVER
        and in_domain_window(r.domain, d, ctx.move)
        and occurs(r, d, ctx.cal)
    )


@dataclass(frozen=True, slots=True)
class Occurrence:
    day: date
    after_move: bool
    today: bool
    bd_away: int
    """``bd_diff(today, day)``: a signed offset, as the Routines row prints it."""


def next_occurrences(
    r: RoutineDef, ctx: EngineCtx, after: date | None = None, limit: int = 3
) -> list[Occurrence]:
    """The first ``limit`` days on or after ``after`` (default today) where the rule fires.

    Like the prototype this ignores stage, so a handed-over routine still lists its dates.
    Returns fewer when the calendar runs out.
    """
    start = after if after is not None else ctx.today
    out: list[Occurrence] = []
    if limit <= 0:
        return out
    for d in ctx.cal.iter_bds(start):
        if occurs(r, d, ctx.cal):
            out.append(
                Occurrence(
                    day=d,
                    after_move=d >= ctx.move,
                    today=d == ctx.today,
                    bd_away=ctx.cal.bd_diff(ctx.today, d),
                )
            )
            if len(out) >= limit:
                break
    return out


def last_occurrence_before(r: RoutineDef, ctx: EngineCtx, before: date) -> date | None:
    """The last day strictly before ``before`` where the rule fires (the key run uses it)."""
    for d in ctx.cal.iter_bds_before(before):
        if occurs(r, d, ctx.cal):
            return d
    return None


def runs_today(r: RoutineDef, ctx: EngineCtx) -> bool:
    """The routine counts today (what ``bau_done`` needs)."""
    return counts_on(r, ctx.today, ctx)


@dataclass(frozen=True, slots=True)
class Effort:
    hours: float
    approx: bool
    """Print ``≈`` before the figure (daily and weekly estimates)."""


def monthly_effort_h(r: RoutineDef) -> Effort:
    """The Routines row's monthly effort: daily x 21 (whole hours), weekly x 4.3 (1 decimal),
    monthly as is."""
    if r.kind == "daily":
        return Effort(round_half_up(r.hours * 21), approx=True)
    if r.kind == "weekly":
        return Effort(round_half_up(r.hours * 4.3 * 10) / 10, approx=True)
    return Effort(r.hours, approx=False)


def rule_text(r: RoutineDef) -> str:
    """``Every business day`` | ``Every Tuesday`` | ``3rd business day, monthly``."""
    if r.kind == "daily":
        return "Every business day"
    if r.kind == "weekly":
        return "Every " + WEEKDAYS_LONG[r.weekday - 1]
    return ordinal(r.bd) + " business day, monthly"


def rule_short(r: RoutineDef) -> str:
    """``Daily`` | ``Weekly · Tue`` | ``BD3``."""
    if r.kind == "daily":
        return "Daily"
    if r.kind == "weekly":
        return "Weekly · " + WEEKDAYS_SHORT[r.weekday - 1]
    return f"BD{r.bd}"
