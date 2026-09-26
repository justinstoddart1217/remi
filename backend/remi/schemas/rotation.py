"""The Fixed Income country rotation that starts at the move."""

import datetime as dt
from typing import Annotated, Literal

from pydantic import AliasChoices, AwareDatetime, Field

from remi.schemas.base import CamelIn, CamelModel, DateIn, EntityId, HoursPerDay

RotationPass = Literal["Build", "Refresh"]
"""``Build``: first pass, models and views built from scratch. ``Refresh``: a return visit."""

RotationStatus = Literal["none", "waiting", "active", "done"]
"""``none``: no segments. ``waiting``: before the start. ``active``: a segment covers today."""

CountryCode = Annotated[str, Field(pattern=r"^[A-Z]{2}$", examples=["DE"])]


class RotationSegmentOut(CamelModel):
    id: str
    order: int
    """0-based position in the rotation."""
    country: str
    code: str
    length_bd: int
    pass_: RotationPass = Field(
        validation_alias=AliasChoices("pass", "pass_"), serialization_alias="pass"
    )
    loop: int
    """1 for the first loop of Build passes; Refresh passes that follow are loop 2."""
    start: dt.date
    end: dt.date
    """Both derived: segments run back to back on business days, skipping holidays."""


class RotationRefreshOut(CamelModel):
    start: dt.date
    end: dt.date


class RotationCurrentOut(CamelModel):
    status: RotationStatus
    order: int | None
    """The active segment's order (``active``), else ``null``."""
    segment_id: str | None
    bd_to_start: int | None
    """Business days strictly between today and the start (``waiting`` only)."""


class RotationOut(CamelModel):
    """``GET /rotation`` and ``PlanOut.rotation``. Exists after setup; may have no segments."""

    id: str
    domain: Literal["fi"]
    title: str
    start_date: dt.date | None
    """Effective start: the stored start, or the move date when none is stored."""
    start_follows_move: bool
    """``true`` when no start is stored, so the rotation moves with the move date."""
    hours_per_day: float
    segments: list[RotationSegmentOut]
    loop_bd: int
    """Business days in loop 1: the Build segments before the first Refresh. A Build pass
    after the refresh (loop 3) does not count."""
    loop_end: dt.date | None
    """End of loop 1 (its last Build segment); ``null`` when there is none."""
    refresh: RotationRefreshOut | None
    """The first Refresh pass (consecutive Refresh segments), if any."""
    total_bd: int
    current: RotationCurrentOut
    updated_at: AwareDatetime | None


class RotationPatch(CamelIn):
    """``PATCH /rotation``. ``startDate: null`` makes the rotation follow the move date again."""

    title: str | None = Field(default=None, min_length=1, max_length=120)
    hours_per_day: HoursPerDay | None = None
    start_date: DateIn | None = None


class RotationSegmentIn(CamelIn):
    """One segment in a full replace. Send the existing ``id`` to keep it, omit it for a new one."""

    id: EntityId | None = None
    country: str = Field(min_length=1, max_length=60)
    code: CountryCode
    length_bd: int = Field(ge=1, le=130)
    pass_: RotationPass = Field(
        validation_alias=AliasChoices("pass", "pass_"), serialization_alias="pass"
    )


class RotationSegmentsPut(CamelIn):
    """``PUT /rotation/segments``: the whole ordered list (the rotation editor saves it at once)."""

    segments: list[RotationSegmentIn] = Field(max_length=60)


class RotationSetupIn(CamelIn):
    """The optional rotation step of the first-run wizard."""

    hours_per_day: HoursPerDay = 4
    segments: list[RotationSegmentIn] = Field(
        default_factory=list[RotationSegmentIn], max_length=60
    )
