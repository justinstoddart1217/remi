"""Upcoming overloads, the attention list and the check-in prompt.

These are computed, never stored. The design renders none of the attention list or the prompt
(ADR-0008); they are data for the read model.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Literal

from remi.services.engine.derive import DerivedProject
from remi.services.engine.loads import DayLoad
from remi.services.engine.model import EngineCtx
from remi.utils.text import fmt_num


@dataclass(frozen=True, slots=True)
class Overload:
    day: date
    bdm: int
    total: float
    capacity: float
    over_by: float


def upcoming_overloads(loads: Mapping[date, DayLoad], ctx: EngineCtx) -> list[Overload]:
    """Overloaded business days from today to ``lookahead_bd`` business days after the move.

    ``loads`` must cover that window (``loads.plan_window`` does).
    """
    cal = ctx.cal
    end = cal.add_bd(ctx.move, ctx.lookahead_bd)
    out: list[Overload] = []
    if end < ctx.today:
        return out
    for d in cal.bds(ctx.today, end):
        load = loads.get(d)
        if load is not None and load.over:
            out.append(Overload(d, cal.bdm(d) or 0, load.total, load.capacity, load.over_by))
    return out


AttentionKind = Literal["at_risk", "overload", "stale"]


@dataclass(frozen=True, slots=True)
class Attention:
    kind: AttentionKind
    chip: str
    """``+3 BD`` | ``+1.5h`` | ``9d``."""
    project_id: str | None = None
    day: date | None = None
    delta_bd: int | None = None
    over_by: float | None = None
    since_days: int | None = None


def attention(projects: Sequence[DerivedProject], overloads: Sequence[Overload]) -> list[Attention]:
    """Late projects, then upcoming overloads, then stale projects."""
    out: list[Attention] = [
        Attention("at_risk", p.delta_label, project_id=p.id, delta_bd=p.delta_bd)
        for p in projects
        if p.status == "risk"
    ]
    out.extend(
        Attention("overload", f"+{fmt_num(o.over_by)}h", day=o.day, over_by=o.over_by)
        for o in overloads
    )
    out.extend(
        Attention("stale", f"{p.since_days}d", project_id=p.id, since_days=p.since_days)
        for p in projects
        if p.stale
    )
    return out


@dataclass(frozen=True, slots=True)
class Prompt:
    prompt_project_id: str | None
    """The longest-unchecked project, when it is stale."""
    next_due_project_id: str | None
    """The longest-unchecked project, stale or not."""


def checkin_prompt(projects: Sequence[DerivedProject]) -> Prompt:
    """Projects with a check-in, longest ago first (stable); prompt the first if stale."""
    candidates = sorted(
        (p for p in projects if p.since_days is not None),
        key=lambda p: -(p.since_days or 0),
    )
    if not candidates:
        return Prompt(None, None)
    first = candidates[0]
    return Prompt(first.id if first.stale else None, first.id)
