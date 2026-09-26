"""Process configuration from ``REMI_*`` environment variables.

User-facing settings (move date, hours, AI provider, appearance ...) live in the database,
not here. This is only what the process needs to start. API keys are never part of it.
"""

from datetime import date
from ipaddress import ip_address
from pathlib import Path
from typing import Final, Literal, Self
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AwareDatetime, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.paths import default_data_dir, default_frontend_dist

LOOPBACK_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_CHART_MAX_BYTES = 4 * 1024 * 1024

Env = Literal["prod", "dev", "test"]
DEV_ONLY: Final = ("now", "default_timezone")
"""Fields that pin behaviour for deterministic dev and test runs; ``REMI_ENV=prod`` refuses
them at startup."""


def is_loopback_host(host: str) -> bool:
    """True for ``localhost`` and any loopback IP (``127.0.0.0/8``, ``::1``)."""
    candidate = host.strip().strip("[]").lower()
    if candidate == "localhost":
        return True
    try:
        return ip_address(candidate).is_loopback
    except ValueError:
        return False


class RemiConfig(BaseSettings):
    """Startup configuration. Every field can be set as ``REMI_<FIELD>``."""

    model_config = SettingsConfigDict(env_prefix="REMI_", extra="ignore", frozen=True)

    data_dir: Path = Field(default_factory=default_data_dir)
    host: str = LOOPBACK_HOST
    port: int = Field(default=DEFAULT_PORT, ge=1, le=65535)
    # The Vite dev server's port (dev/test only): mutations from it pass the Origin guard.
    web_port: int = Field(default=5173, ge=1, le=65535)
    env: Env = "prod"
    today: date | None = None
    """``REMI_TODAY``: the business date starts on this day; the wall clock keeps running."""
    now: AwareDatetime | None = None
    """``REMI_NOW`` (dev and test only): the clock stands still at this instant, so notes and
    other timestamps are deterministic. "Today" is ``REMI_TODAY`` when set (it must be the same
    day), else this instant's own date."""
    default_timezone: str | None = None
    """``REMI_DEFAULT_TIMEZONE`` (dev and test only): the IANA zone the first-run wizard
    pre-fills (``GET /setup``) instead of the machine's ``/etc/localtime``."""
    frontend_dist: Path = Field(default_factory=default_frontend_dist)
    chart_max_bytes: int = Field(default=DEFAULT_CHART_MAX_BYTES, gt=0)
    open_browser: bool = True

    @field_validator("host")
    @classmethod
    def _loopback_only(cls, value: str) -> str:
        if not is_loopback_host(value):
            msg = f"Remi is local-only and will not bind to non-loopback host {value!r}"
            raise ValueError(msg)
        return value

    @field_validator("default_timezone")
    @classmethod
    def _known_zone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as error:
            msg = f"REMI_DEFAULT_TIMEZONE must be an IANA zone such as Europe/London, not {value!r}"
            raise ValueError(msg) from error
        return value

    @model_validator(mode="after")
    def _dev_only_and_consistent(self) -> Self:
        if self.env == "prod":
            pinned = [
                f"REMI_{name.upper()}" for name in DEV_ONLY if getattr(self, name) is not None
            ]
            if pinned:
                verb = "is" if len(pinned) == 1 else "are"
                msg = (
                    f"{' and '.join(pinned)} {verb} for dev and test runs only (REMI_ENV=dev|test)"
                )
                raise ValueError(msg)
        if self.now is not None and self.today is not None and self.now.date() != self.today:
            msg = (
                f"REMI_NOW falls on {self.now.date().isoformat()} but REMI_TODAY is "
                f"{self.today.isoformat()}"
            )
            raise ValueError(msg)
        return self
