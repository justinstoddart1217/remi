"""What every plan mutation returns: the new plan, the forecast movements, and the entity.

The client replaces its plan cache with ``plan`` in one commit, then plays ``movements``
(ghost bar ``flash`` for 1100 ms, the ``moved`` chip for 5200 ms). The typed ``*MutationOut``
subclasses only pin down ``entity`` for the generated TypeScript types.
"""

import datetime as dt
from typing import Literal

from app.schemas.aliases import AliasOut
from app.schemas.base import CamelModel
from app.schemas.calendar import HolidayOut, LeaveDayOut
from app.schemas.checkin import CheckinAppliedOut
from app.schemas.note import NoteOut
from app.schemas.plan import PlanOut
from app.schemas.project import (
    CharterItemOut,
    MilestoneOut,
    ProjectOut,
    ReadinessItemOut,
    TaskOut,
)
from app.schemas.rotation import RotationOut
from app.schemas.routine import RoutineChecklistItemOut, RoutineOut, RoutineRunOut
from app.schemas.settings import SettingsOut

MovementCause = Literal[
    "scope",
    "rate",
    "work_left",
    "start",
    "target",
    "checkin",
    "routine",
    "override",
    "bau_day_hours",
    "settings",
    "calendar",
]
"""What moved the forecast. A check-in reports its specific cause (scope, rate, target)."""


class Movement(CamelModel):
    """One project's forecast (or target) change caused by the mutation."""

    project_id: str
    from_forecast: dt.date | None
    to_forecast: dt.date | None
    delta_bd: int
    """``bd_diff(from, to)``; 0 when either side is ``null``."""
    from_target: dt.date | None
    to_target: dt.date | None
    cause: MovementCause
    label: str
    """``"+3 BD"``, ``"±0 BD"``, or a U+2212 minus sign for earlier (e.g. minus 2 BD)."""
    flash: bool
    """The forecast changed: play the ghost bar."""
    moved: bool
    """``deltaBd != 0``: show the moved chip."""


class MutationOut(CamelModel):
    """Returned by deletes and by mutations with no single entity."""

    plan: PlanOut
    movements: list[Movement]


class ProjectMutationOut(MutationOut):
    entity: ProjectOut


class CharterItemMutationOut(MutationOut):
    entity: CharterItemOut


class MilestoneMutationOut(MutationOut):
    entity: MilestoneOut


class TaskMutationOut(MutationOut):
    entity: TaskOut


class ReadinessItemMutationOut(MutationOut):
    entity: ReadinessItemOut


class RoutineMutationOut(MutationOut):
    entity: RoutineOut


class RoutineRunMutationOut(MutationOut):
    entity: RoutineRunOut


class RoutineChecklistItemMutationOut(MutationOut):
    entity: RoutineChecklistItemOut


class RotationMutationOut(MutationOut):
    entity: RotationOut


class SettingsMutationOut(MutationOut):
    entity: SettingsOut


class NoteMutationOut(MutationOut):
    entity: NoteOut


class AliasMutationOut(MutationOut):
    entity: AliasOut


class HolidayMutationOut(MutationOut):
    entity: HolidayOut


class LeaveMutationOut(MutationOut):
    entity: LeaveDayOut


class CheckinMutationOut(MutationOut):
    entity: CheckinAppliedOut
