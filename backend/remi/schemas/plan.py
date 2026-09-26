"""``PlanOut``: the single bootstrap read model behind ``GET /plan``.

Every screen of the Control Panel renders from this bundle (plus a few parameterised reads).
The server computes every number; the client only formats copy and does geometry. It is
cached by ``(revision, today)`` and served with ``ETag: "<revision>-<today>"``.
"""

import datetime as dt
from typing import Literal

from pydantic import AwareDatetime

from remi.schemas.aliases import AliasOut
from remi.schemas.base import CamelModel
from remi.schemas.calendar import CalendarOut, DayLoadOut
from remi.schemas.project import ProjectOut
from remi.schemas.rotation import RotationOut
from remi.schemas.routine import RoutineOut
from remi.schemas.settings import SettingsOut

VerdictState = Literal["off_track", "at_risk", "on_track_narrowly", "on_track", "no_pc"]
"""First match wins:

- ``no_pc``: there are no PC projects (the empty state, "Not yet").
- ``off_track``: a PC forecast on or after the move (or unplaced hours).
- ``no_pc``: a PC project has no forecast yet (Define), so its exit is unknown and there is
  no buffer to report ("Move not planned yet"). ``off_track`` above still wins.
- ``at_risk``: the key project lands on or after the key run.
- ``on_track_narrowly``: any project is at risk.
- ``on_track``: otherwise.
"""

MoveFlagKind = Literal["project", "key_run", "move"]
AttentionKind = Literal["at_risk", "overload", "stale"]


class TodayOut(CamelModel):
    iso: dt.date
    """Today in the business timezone (or ``REMI_TODAY``)."""
    tz: str
    overridden: bool
    """``REMI_TODAY`` pins the date (tests, demos)."""
    w: int
    """Weekday, 0 = Sunday."""
    is_bd: bool
    bdm: int | None
    month_bds: int
    """Business days in today's month."""
    next_rollover_at: AwareDatetime
    """Next local midnight: refetch the plan then."""


class MoveRemainingDayOut(CamelModel):
    """One block on the Transition strip: a business day strictly between today and the move."""

    iso: dt.date
    bdm: int
    pc_running: bool
    """On or before the last PC exit."""


class MoveFlagOut(CamelModel):
    kind: MoveFlagKind
    project_id: str | None
    iso: dt.date
    at_risk: bool
    slot: int
    """The block boundary the flag stands on, ``0..len(remaining)``: its left edge is
    ``slot / len(remaining)`` of the strip. A PC project stands at the right edge of its
    forecast day's block, the key run at the left edge of its block, the move at the end."""
    index: int
    """Position in ``flags``; the label lift and stick height alternate on it."""
    lift_px: int
    """The label's bottom margin (2 on an even index, 18 on an odd one)."""
    stick_px: int
    """The stick's height (10 on an even index, 26 on an odd one)."""


class MoveOut(CamelModel):
    date: dt.date
    countdown_bd: int
    """Business days strictly between today and the move (61 in the fixture)."""
    remaining: list[MoveRemainingDayOut]
    flags: list[MoveFlagOut]
    """PC forecasts, the key run and the move, sorted by ``slot``; ties keep PC projects in
    project order, then the key run, then the move (the prototype's order)."""


class VerdictOut(CamelModel):
    state: VerdictState
    buffer_bd: int | None
    """Business days strictly between the last PC exit and the move."""
    last_pc_exit: dt.date | None
    key_project_id: str | None
    key_run: dt.date | None
    """The key routine's last occurrence before the move (or the settings override)."""
    to_run_bd: int | None
    """``bd_diff(key forecast, key run)``."""
    any_risk: bool


class UpcomingOverloadOut(CamelModel):
    iso: dt.date
    bdm: int
    total: float
    over_by: float


class AttentionItemOut(CamelModel):
    """Data only (decision 8): at-risk projects, overloads and stale check-ins."""

    kind: AttentionKind
    project_id: str | None
    iso: dt.date | None
    value: float
    """Delta BD (``at_risk``), hours over (``overload``) or days since check-in (``stale``)."""
    chip: str
    """e.g. "+3 BD", "+1.5h", "9 days"."""


class FlagsOut(CamelModel):
    upcoming_overloads: list[UpcomingOverloadOut]
    """Overloaded business days from today to the move + the lookahead."""
    attention: list[AttentionItemOut]
    prompt_project_id: str | None
    """The stalest project due a check-in (data only)."""
    next_due_project_id: str | None


class CountsOut(CamelModel):
    projects: int
    routines: int
    notes_total: int
    note_days: int
    notes_today: int
    recent_notes: int
    """Notes on the last five business days (sent with Tell Remi when enabled)."""


class PlanOut(CamelModel):
    """``GET /plan``. 409 ``SETUP_REQUIRED`` until setup is complete."""

    revision: int
    """The ``seq`` of the latest event that can change this bundle: every mutation moves it
    except Textbook edits and note text edits, which the plan does not show. It never goes
    down. The ``ETag`` is ``"<revision>-<today>"``."""
    today: TodayOut
    settings: SettingsOut
    calendar: CalendarOut
    """From the Monday before today - 1 week to the latest of: move + 2 weeks, the end of the
    month after the move, the rotation end and the last project end."""
    loads: dict[dt.date, DayLoadOut]
    """Every business day in ``calendar``."""
    projects: list[ProjectOut]
    """PC first, then FI; each domain in ``sortOrder``."""
    routines: list[RoutineOut]
    rotation: RotationOut
    move: MoveOut
    verdict: VerdictOut
    flags: FlagsOut
    aliases: list[AliasOut]
    counts: CountsOut
