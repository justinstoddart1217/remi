"""First-run setup: the wizard's reads and its single commit."""

import datetime as dt

from pydantic import Field

from app.schemas.ai import AiStatusOut
from app.schemas.base import CamelIn, CamelModel, DateIn
from app.schemas.rotation import RotationSetupIn
from app.schemas.settings import (
    AiProvider,
    CapacityHours,
    HolidayRegion,
    MotionPreference,
    TimezoneName,
)


class HolidayRegionOut(CamelModel):
    code: HolidayRegion
    label: str
    """e.g. "England and Wales"."""


class SetupDefaultsOut(CamelModel):
    """What the wizard pre-fills."""

    timezone: str
    """From the machine (``/etc/localtime``), falling back to Europe/London."""
    holiday_region: HolidayRegion
    capacity_hours_per_day: float
    ai_provider: AiProvider
    rotation_hours_per_day: float


class SetupStatusOut(CamelModel):
    """``GET /setup``. Works before setup; the SetupGate reads ``needsSetup``."""

    needs_setup: bool
    missing: list[str]
    """Settings still to provide, camelCase (e.g. ``["moveDate"]``)."""
    today: dt.date
    defaults: SetupDefaultsOut
    regions: list[HolidayRegionOut]
    ai: AiStatusOut


class SetupIn(CamelIn):
    """``POST /setup``: one transaction. Generates holidays, creates the default Textbook
    sections, stores the rotation (if given) and marks setup complete. ``moveDate`` snaps
    forward to the next business day."""

    move_date: DateIn
    timezone: TimezoneName
    holiday_region: HolidayRegion
    capacity_hours_per_day: CapacityHours = 8
    rotation: RotationSetupIn | None = None
    ai_provider: AiProvider = "none"
    ai_model: str | None = Field(default=None, max_length=120)
    motion_preference: MotionPreference = "system"


class CountdownOut(CamelModel):
    """``GET /setup/countdown``: the wizard's live Roll for a candidate move date."""

    today: dt.date
    move_date: dt.date
    """The candidate, snapped forward to a business day."""
    snapped: bool
    """``true`` when ``moveDate`` differs from the requested date."""
    countdown_bd: int
    """Business days strictly between today and the move (today and move day excluded)."""
