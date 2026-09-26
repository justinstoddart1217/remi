"""User settings (the singleton ``settings`` row). API keys are never part of these models."""

import datetime as dt
from functools import cache
from typing import Annotated, Literal
from zoneinfo import available_timezones

from pydantic import AfterValidator, AwareDatetime, Field

from app.schemas.base import CamelIn, CamelModel, DateIn, EntityId, HexColour

HolidayRegion = Literal["GB-ENG", "ZA"]
"""Holiday calendar: England and Wales, or South Africa (generated offline by ``holidays``)."""

AiProvider = Literal["none", "anthropic", "ollama"]
"""``none`` (default) means the deterministic simple reading; nothing leaves the machine."""

MotionPreference = Literal["system", "full", "reduced"]
"""``system`` follows ``prefers-reduced-motion``."""

MoveTaper = Literal["hard", "taper"]
"""How PC work stops at the move (``settings.move_taper``). The engine treats both as a hard stop
today; ``taper`` is stored data only (an open question). Not writable through the API yet."""

TimelineZoom = Literal["3m", "2w"]


@cache
def _known_timezones() -> frozenset[str]:
    return frozenset(available_timezones())


def _check_timezone(value: str) -> str:
    if value not in _known_timezones():
        msg = f"unknown IANA timezone {value!r}"
        raise ValueError(msg)
    return value


TimezoneName = Annotated[
    str,
    Field(min_length=1, max_length=64, examples=["Europe/London"]),
    AfterValidator(_check_timezone),
]
"""An IANA timezone name, validated against the bundled tz database."""

CapacityHours = Annotated[float, Field(ge=1, le=24)]
"""Working hours in one business day (the capacity line)."""


class UiPrefsOut(CamelModel):
    """Small UI preferences kept server-side so they survive a browser reset."""

    textbook_sidebar_open: bool
    timeline_zoom: TimelineZoom
    last_textbook_page_id: str | None
    collapsed_page_ids: list[str]


class UiPrefsPatch(CamelIn):
    textbook_sidebar_open: bool | None = None
    timeline_zoom: TimelineZoom | None = None
    last_textbook_page_id: EntityId | None = None
    collapsed_page_ids: list[EntityId] | None = Field(default=None, max_length=2000)


class SettingsOut(CamelModel):
    """``GET /settings``. Also embedded in ``PlanOut.settings``."""

    setup_complete: bool
    setup_completed_at: AwareDatetime | None

    # The plan
    move_date: dt.date | None
    """The move to Fixed Income. ``null`` only before setup."""
    move_taper: MoveTaper
    capacity_hours_per_day: float
    timezone: str
    holiday_region: HolidayRegion

    # Thresholds (data only; the design renders the defaults)
    stale_threshold_days: int
    overload_lookahead_bd: int
    new_project_horizon_bd: int
    now_ms_offset_bd: int
    next_ms_offset_bd: int

    # Key items for the verdict
    key_project_id: str | None
    key_routine_id: str | None
    key_run_date_override: dt.date | None

    # Appearance
    motion_preference: MotionPreference
    accent_pc: str
    accent_fi: str
    serif_display: bool

    # Tell Remi
    ai_provider: AiProvider
    ai_model: str | None
    ai_send_recent_notes: bool
    ollama_base_url: str
    ai_key_configured: bool
    """Whether an Anthropic key is available (env or keychain). The key itself is never sent."""

    ui_prefs: UiPrefsOut
    updated_at: AwareDatetime | None


class SettingsPatch(CamelIn):
    """``PATCH /settings``. Every key is optional; absent = unchanged, ``null`` = clear.

    ``moveDate`` snaps forward to the next business day. Changing the move date, capacity,
    region or timezone re-derives the whole plan, so the response carries ``movements``.
    """

    move_date: DateIn | None = None
    capacity_hours_per_day: CapacityHours | None = None
    timezone: TimezoneName | None = None
    holiday_region: HolidayRegion | None = None

    stale_threshold_days: int | None = Field(default=None, ge=1, le=90)
    overload_lookahead_bd: int | None = Field(default=None, ge=0, le=60)
    new_project_horizon_bd: int | None = Field(default=None, ge=1, le=260)
    now_ms_offset_bd: int | None = Field(default=None, ge=0, le=260)
    next_ms_offset_bd: int | None = Field(default=None, ge=0, le=260)

    key_project_id: EntityId | None = None
    key_routine_id: EntityId | None = None
    key_run_date_override: DateIn | None = None

    motion_preference: MotionPreference | None = None
    accent_pc: HexColour | None = None
    accent_fi: HexColour | None = None
    serif_display: bool | None = None

    ai_provider: AiProvider | None = None
    ai_model: str | None = Field(default=None, max_length=120)
    ai_send_recent_notes: bool | None = None
    ollama_base_url: str | None = Field(default=None, max_length=200)
    """Must resolve to a loopback address; anything else is a 422."""

    ui_prefs: UiPrefsPatch | None = None
