"""The CONTEXT a provider sees, built on the server (never trusted from the client).

The check-ins service fills a ``CheckinContextInput`` from the database and the engine;
``build_context`` turns it into the JSON object the prompt describes (the prototype's
``context()`` in ``CheckIn.dc.html`` plus capacity, the move date and aliases).

What leaves the machine (only with the ``anthropic`` provider) is exactly this object and
the update text. The input types have no field for goals, charters, why-now, risks or
scope history, so those can never be sent. Recent notes are included only when
``send_notes`` is on (Settings > Tell Remi > "Send recent notes").
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Final

from app.utils.dates import fmt_l, fmt_s, iso

RECENT_NOTE_DAYS: Final = 5
"""Notes from the last five business days up to today (the service picks the days)."""


@dataclass(frozen=True, slots=True)
class ContextTask:
    id: str
    text: str
    hours: float


@dataclass(frozen=True, slots=True)
class ContextMilestone:
    name: str
    due: date | None


@dataclass(frozen=True, slots=True)
class ContextProject:
    id: str
    name: str
    short: str
    domain: str
    """The display name, e.g. "Private Credit"."""
    forecast: date | None
    target: date | None
    hours_per_day: float
    confidence: int | None
    open_tasks: Sequence[ContextTask] = ()
    """Undone tasks of the Now milestones only (the prototype's ``open_tasks``)."""
    milestones: Sequence[ContextMilestone] = ()
    aliases: Sequence[str] = ()


@dataclass(frozen=True, slots=True)
class ContextRoutine:
    id: str
    name: str
    rule: str
    """The rule in words, e.g. "BD3 each month"."""
    runs_today: bool
    aliases: Sequence[str] = ()


@dataclass(frozen=True, slots=True)
class ContextNote:
    day: date
    time: str
    """``HH:MM`` in the business timezone."""
    text: str


@dataclass(frozen=True, slots=True)
class CheckinContextInput:
    """Everything the context may contain. Built by the check-ins service."""

    today: date
    today_bdm: int | None
    """Business day of the month (``BD3``); ``None`` on a non-business day."""
    capacity_h: float
    move: date | None
    focus_project_id: str | None = None
    projects: Sequence[ContextProject] = ()
    routines: Sequence[ContextRoutine] = ()
    recent_notes: Sequence[ContextNote] = ()
    send_notes: bool = False
    """``registry.parse`` overwrites this with the Settings toggle before building."""


def _iso(d: date | None) -> str | None:
    return iso(d) if d is not None else None


def today_label(today: date, bdm: int | None) -> str:
    """``2026-10-05 (Monday 5 October, BD3)``."""
    suffix = f", BD{bdm}" if bdm is not None else ""
    return f"{iso(today)} ({fmt_l(today)}{suffix})"


def _milestone(m: ContextMilestone) -> str:
    return f"{m.name} ({iso(m.due) if m.due is not None else 'no date'})"


def _project(p: ContextProject) -> dict[str, object]:
    return {
        "id": p.id,
        "name": p.name,
        "short": p.short,
        "aliases": list(p.aliases),
        "domain": p.domain,
        "forecast": _iso(p.forecast),
        "target": _iso(p.target),
        "hours_per_day": p.hours_per_day,
        "confidence": p.confidence,
        "open_tasks": [{"id": t.id, "text": t.text, "hours": t.hours} for t in p.open_tasks],
        "milestones": [_milestone(m) for m in p.milestones],
    }


def _routine(r: ContextRoutine) -> dict[str, object]:
    return {
        "id": r.id,
        "name": r.name,
        "rule": r.rule,
        "runs_today": r.runs_today,
        "aliases": list(r.aliases),
    }


def note_line(n: ContextNote) -> str:
    """``Fri 2 Oct 16:10: text`` (the prototype's format)."""
    return f"{fmt_s(n.day)} {n.time}: {n.text}"


def build_context(inp: CheckinContextInput) -> dict[str, object]:
    """The CONTEXT object, in the prototype's key order. JSON-ready."""
    ctx: dict[str, object] = {
        "today": today_label(inp.today, inp.today_bdm),
        "focus_project": inp.focus_project_id,
        "capacity_h": inp.capacity_h,
        "move_date": _iso(inp.move),
        "projects": [_project(p) for p in inp.projects],
        "routines": [_routine(r) for r in inp.routines],
    }
    if inp.send_notes:
        ctx["recent_notes"] = [note_line(n) for n in inp.recent_notes]
    return ctx
