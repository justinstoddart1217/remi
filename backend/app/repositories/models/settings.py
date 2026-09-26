"""``settings``: the one row (``id = 1``) of user settings. It never holds API keys.

The row is inserted by migration ``0001`` with the server defaults below, so a fresh database
already has settings and ``setup_completed_at IS NULL`` (first-run setup required).
"""

from datetime import date, datetime
from typing import Final, Literal, get_args

from sqlalchemy import Boolean, CheckConstraint, Float, ForeignKey, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.repositories.models.base import (
    HOLIDAY_REGIONS,
    Base,
    HolidayRegion,
    JSONDict,
    Timestamps,
    UTCDateTime,
    check_in,
    check_range,
)

MoveTaper = Literal["hard", "taper"]
MotionPreference = Literal["system", "full", "reduced"]
AIProvider = Literal["none", "anthropic", "ollama"]
MOVE_TAPERS: Final = get_args(MoveTaper)
MOTION_PREFERENCES: Final = get_args(MotionPreference)
AI_PROVIDERS: Final = get_args(AIProvider)

SETTINGS_ID: Final = 1
DEFAULT_TIMEZONE: Final = "Europe/London"
DEFAULT_ACCENT_PC: Final = "#009D80"
"""Ninety One teal: the redesign's default ``accents`` pair (migration ``0004``)."""
DEFAULT_ACCENT_FI: Final = "#2F6B9A"
DEFAULT_OLLAMA_BASE_URL: Final = "http://127.0.0.1:11434"


class Settings(Timestamps, Base):
    __tablename__ = "settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="singleton"),
        check_in("holiday_region", HOLIDAY_REGIONS),
        check_in("move_taper", MOVE_TAPERS),
        check_range("capacity_hours_per_day", 1, 24),
        check_range("stale_threshold_days", 1, None),
        check_range("overload_lookahead_bd", 0, None),
        check_range("new_project_horizon_bd", 1, None),
        check_range("now_ms_offset_bd", 0, None),
        check_range("next_ms_offset_bd", 0, None),
        check_in("motion_preference", MOTION_PREFERENCES),
        check_in("ai_provider", AI_PROVIDERS),
        check_range("ai_timeout_s", 1, 600, nullable=True),
        check_range("ai_audit_retention_days", 1, None),
    )

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=False, default=SETTINGS_ID
    )

    # Plan
    timezone: Mapped[str] = mapped_column(
        String(64), default=DEFAULT_TIMEZONE, server_default=DEFAULT_TIMEZONE
    )
    holiday_region: Mapped[HolidayRegion] = mapped_column(
        String(16), default="GB-ENG", server_default="GB-ENG"
    )
    move_date: Mapped[date | None]
    move_taper: Mapped[MoveTaper] = mapped_column(String(8), default="hard", server_default="hard")
    capacity_hours_per_day: Mapped[float] = mapped_column(
        Float, default=8.0, server_default=text("8")
    )

    # Thresholds
    stale_threshold_days: Mapped[int] = mapped_column(Integer, default=7, server_default=text("7"))
    overload_lookahead_bd: Mapped[int] = mapped_column(
        Integer, default=10, server_default=text("10")
    )
    new_project_horizon_bd: Mapped[int] = mapped_column(
        Integer, default=30, server_default=text("30")
    )
    now_ms_offset_bd: Mapped[int] = mapped_column(Integer, default=9, server_default=text("9"))
    next_ms_offset_bd: Mapped[int] = mapped_column(Integer, default=20, server_default=text("20"))

    # Key items for the verdict (a deleted project/routine just clears the key)
    key_project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="SET NULL")
    )
    key_routine_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("routines.id", ondelete="SET NULL")
    )
    key_run_date_override: Mapped[date | None]

    # Appearance
    motion_preference: Mapped[MotionPreference] = mapped_column(
        String(8), default="system", server_default="system"
    )
    accent_pc: Mapped[str] = mapped_column(
        String(64), default=DEFAULT_ACCENT_PC, server_default=DEFAULT_ACCENT_PC
    )
    accent_fi: Mapped[str] = mapped_column(
        String(64), default=DEFAULT_ACCENT_FI, server_default=DEFAULT_ACCENT_FI
    )
    serif_display: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("1"))

    # AI check-in (keys live in the environment or Keychain, never here)
    ai_provider: Mapped[AIProvider] = mapped_column(
        String(16), default="none", server_default="none"
    )
    ai_model: Mapped[str | None] = mapped_column(String(120))
    ai_send_recent_notes: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("0")
    )
    ollama_base_url: Mapped[str] = mapped_column(
        String(255), default=DEFAULT_OLLAMA_BASE_URL, server_default=DEFAULT_OLLAMA_BASE_URL
    )
    ai_timeout_s: Mapped[float | None] = mapped_column(Float)
    """``None`` = the provider default (30s Anthropic, 90s Ollama)."""
    ai_server_fallback: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("0")
    )
    ai_audit_retention_days: Mapped[int] = mapped_column(
        Integer, default=90, server_default=text("90")
    )

    # Client UI state: sidebar, timeline_zoom, last_textbook_page_id, collapsed page ids ...
    ui_prefs: Mapped[JSONDict] = mapped_column(default=dict, server_default=text("'{}'"))

    setup_completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
