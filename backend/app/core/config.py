"""Process configuration from ``REMI_*`` environment variables.

User-facing settings (move date, hours, AI provider, appearance ...) live in the database,
not here. This is only what the process needs to start. API keys are never part of it.
"""

import re
import socket
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


_LABEL = r"[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?"
HOST_NAME = re.compile(rf"^{_LABEL}(\.{_LABEL})*$")
"""A DNS name (lowercase), such as ``apexserver`` or ``apexserver.corp.example``."""


def _is_name_or_address(value: str) -> bool:
    if HOST_NAME.match(value):
        return True
    try:
        ip_address(value.strip("[]"))
    except ValueError:
        return False
    return True


def machine_names() -> list[str]:
    """This computer's own names and IPv4 addresses (lowercase), as other computers on the
    network would type them: the host name, its fully qualified name and its addresses.

    Server mode answers to these without further configuration. Anything the lookup cannot
    find (no DNS, say) is simply left out.
    """
    names: list[str] = []
    try:
        hostname = socket.gethostname()
        names.append(hostname)
        names.append(socket.getfqdn(hostname))
        names.extend(socket.gethostbyname_ex(hostname)[2])
    except OSError:
        pass
    found: list[str] = []
    for name in names:
        candidate = name.strip().lower()
        # A failed reverse lookup can come back as a *.arpa name, which no one types.
        if (
            candidate
            and not candidate.endswith(".arpa")
            and not is_loopback_host(candidate)
            and _is_name_or_address(candidate)
        ):
            found.append(candidate)
    return list(dict.fromkeys(found))


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
    network: bool = False
    """``REMI_NETWORK=1``: server mode, for a computer other computers open Remi on (the APEX
    server). Remi may then bind a non-loopback address such as ``0.0.0.0``, and it answers to
    this computer's own names (:func:`machine_names`) and to ``allowed_hosts``. There is no
    sign-in: anyone who can reach the port can use Remi. Off by default."""
    allowed_hosts: str = ""
    """``REMI_ALLOWED_HOSTS`` (server mode only): more names or addresses Remi answers to,
    comma-separated, such as a DNS alias (``apex``). ``*`` answers to any name."""

    @property
    def extra_hosts(self) -> list[str]:
        """``allowed_hosts`` as a list: lowercase, blanks dropped."""
        parts = (part.strip().lower() for part in self.allowed_hosts.replace(";", ",").split(","))
        return [part for part in parts if part]

    @field_validator("allowed_hosts")
    @classmethod
    def _names_only(cls, value: str) -> str:
        for part in (p.strip().lower() for p in value.replace(";", ",").split(",")):
            if part and part != "*" and not _is_name_or_address(part):
                msg = (
                    f"REMI_ALLOWED_HOSTS takes names or addresses only (such as apex or "
                    f"10.0.0.5, without http:// or a port), not {part!r}"
                )
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
        if not self.network:
            if not is_loopback_host(self.host):
                msg = (
                    f"Remi is local-only and will not bind to non-loopback host {self.host!r} "
                    "(REMI_NETWORK=1 runs it as a server for other computers)"
                )
                raise ValueError(msg)
            if self.extra_hosts:
                msg = "REMI_ALLOWED_HOSTS is for server mode only (REMI_NETWORK=1)"
                raise ValueError(msg)
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
