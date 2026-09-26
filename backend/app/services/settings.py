"""User settings: read, validated partial update, the write-only AI key, and the clock's timezone.

``PATCH /settings`` changes only the keys the client sent (``null`` clears a nullable one; the
others refuse ``null`` with 422). Key project and routine ids must exist, the Ollama URL must be
loopback, and the move date snaps forward to a business day (a new one may not be before
today). Every change is one ``settings.updated`` event; plan-shaping changes come back with
``movements`` (cause ``settings``). A new move date or holiday region changes which days have
hours (Private Credit stops at the move; holidays move), so every forecast is placed again from
the work left it had before the change (``scope.refit_forecasts``): the work left stays, the
forecast moves. Holiday edits do the same (cause ``calendar``). A move date or region that
would push the rotation past Remi's calendar is refused before anything is written
(``rotation.check_settings_fit``).

A timezone change takes effect for the clock as soon as it commits (an ``after_commit`` hook),
so the plan in the response is already in the new zone.

The AI key never touches the database: ``PUT``/``DELETE /settings/ai-key`` call
``app.services.ai.keys`` (through ``settings_keys_bridge``) and return the provider status.
"""

import datetime as dt
import threading
import time
from collections.abc import Callable
from typing import Any, Final, cast

from pydantic import SecretStr
from sqlalchemy import select

from app.core.clock import Clock
from app.core.db import Database
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.uow import UnitOfWorkFactory, ref
from app.repositories import models as orm
from app.repositories.registry import HOLIDAYS, LEAVE, PROJECTS, ROUTINES, SETTINGS
from app.schemas.ai import AiStatusOut
from app.schemas.calendar import HolidayOut, LeaveDayOut
from app.schemas.mutation import (
    HolidayMutationOut,
    LeaveMutationOut,
    MutationOut,
    SettingsMutationOut,
)
from app.schemas.settings import SettingsOut, SettingsPatch
from app.services import settings_keys_bridge as keys
from app.services.ai.ollama_provider import NotLoopback, normalise_loopback_url
from app.services.calendar import (
    calendar_in,
    check_in_range,
    check_move_date,
    check_move_not_past,
    default_span,
    snap_to_bd,
)
from app.services.mutations import MutationScope, run_mutation
from app.services.rotation import check_settings_fit
from app.services.views import invalidate_plan_cache, leave_out, settings_out

NOT_NULLABLE: Final = frozenset(
    {
        "move_date",
        "capacity_hours_per_day",
        "timezone",
        "holiday_region",
        "stale_threshold_days",
        "overload_lookahead_bd",
        "new_project_horizon_bd",
        "now_ms_offset_bd",
        "next_ms_offset_bd",
        "motion_preference",
        "accent_pc",
        "accent_fi",
        "serif_display",
        "ai_provider",
        "ai_send_recent_notes",
        "ollama_base_url",
        "ui_prefs",
    }
)
"""Fields a ``PATCH`` may change but not clear."""

_CAMEL: Final = {name: (field.alias or name) for name, field in SettingsPatch.model_fields.items()}


def _camel(name: str) -> str:
    return _CAMEL.get(name, name)


# ---------------------------------------------------------------------------- reads
def get_settings(uow_factory: UnitOfWorkFactory) -> SettingsOut:
    """``GET /settings`` (works before setup; never includes a key)."""
    configured = keys.api_key_configured()
    with uow_factory.read() as uow:
        return settings_out(uow.repo(SETTINGS).get(), key_configured=configured)


def ai_status_out(uow_factory: UnitOfWorkFactory) -> AiStatusOut:
    with uow_factory.read() as uow:
        return keys.ai_status(uow.repo(SETTINGS).get())


# ---------------------------------------------------------------------------- update
def check_ollama_url(url: str) -> str:
    """Only a loopback ``http(s)`` URL may be used for Ollama (stay local); 422 otherwise.
    Returns the URL without a trailing slash."""
    try:
        return normalise_loopback_url(url)
    except NotLoopback as exc:
        message = str(exc)
        raise ValidationFailed(
            message[:1].upper() + message[1:] + ".", field="ollamaBaseUrl"
        ) from exc


def _merged_prefs(current: dict[str, Any], body: SettingsPatch) -> dict[str, Any]:
    prefs = dict(current)
    patch = body.ui_prefs
    if patch is None:
        return prefs
    for name in patch.model_fields_set:
        value = getattr(patch, name)
        if value is None:
            prefs.pop(name, None)
        else:
            prefs[name] = (
                [str(x) for x in cast(list[Any], value)] if isinstance(value, list) else value
            )
    return prefs


def _apply_patch(m: MutationScope, body: SettingsPatch) -> list[str]:
    """Apply the sent fields; returns the camelCase names that changed."""
    uow = m.uow
    settings = uow.repo(SETTINGS).get()
    sent = body.model_fields_set
    for name in sent:
        if name in NOT_NULLABLE and getattr(body, name) is None:
            raise ValidationFailed(f"{_camel(name)} cannot be cleared.", field=_camel(name))
    changes: dict[str, Any] = {}

    for name in (
        "capacity_hours_per_day",
        "timezone",
        "holiday_region",
        "stale_threshold_days",
        "overload_lookahead_bd",
        "new_project_horizon_bd",
        "now_ms_offset_bd",
        "next_ms_offset_bd",
        "key_run_date_override",
        "motion_preference",
        "accent_pc",
        "accent_fi",
        "serif_display",
        "ai_provider",
        "ai_model",
        "ai_send_recent_notes",
    ):
        if name in sent:
            changes[name] = getattr(body, name)

    if "key_project_id" in sent:
        project_id = body.key_project_id
        if project_id is not None and not uow.repo(PROJECTS).exists(project_id):
            raise ValidationFailed("No project with that id.", field="keyProjectId")
        changes["key_project_id"] = project_id
    if "key_routine_id" in sent:
        routine_id = body.key_routine_id
        if routine_id is not None and not uow.repo(ROUTINES).exists(routine_id):
            raise ValidationFailed("No routine with that id.", field="keyRoutineId")
        changes["key_routine_id"] = routine_id
    if "ollama_base_url" in sent and body.ollama_base_url is not None:
        changes["ollama_base_url"] = check_ollama_url(body.ollama_base_url)
    if "ui_prefs" in sent:
        changes["ui_prefs"] = _merged_prefs(dict(settings.ui_prefs or {}), body)

    region = changes.get("holiday_region", settings.holiday_region)
    move = body.move_date if "move_date" in sent else settings.move_date
    if move is not None and ("move_date" in sent or "holiday_region" in sent):
        today = m.today
        check_move_date(move, today)
        if "move_date" in sent:
            check_move_not_past(move, today)
        cal = calendar_in(uow, region, default_span(today, move), today)
        changes["move_date"] = snap_to_bd(cal, move, "moveDate")

    changed = [name for name, value in changes.items() if getattr(settings, name) != value]
    for name in changed:
        setattr(settings, name, changes[name])
    return [_camel(name) for name in changed]


def update_settings(
    uow_factory: UnitOfWorkFactory, clock: Clock, body: SettingsPatch
) -> SettingsMutationOut:
    """``PATCH /settings`` (409 ``SETUP_REQUIRED`` before setup: use ``POST /setup``).

    A new move date or holiday region that would push the rotation past Remi's calendar is
    refused (422 ``OUT_OF_RANGE``) before anything is written, as ``PATCH /rotation`` is."""
    sent = body.model_fields_set
    check_settings_fit(
        uow_factory,
        clock,
        move=body.move_date if "move_date" in sent else None,
        region=body.holiday_region if "holiday_region" in sent else None,
    )

    def change(m: MutationScope) -> list[str]:
        changed = _apply_patch(m, body)
        if "timezone" in changed:
            # The clock re-reads the timezone once this commits, so the plan built after the
            # change (``today``, ``nextRolloverAt``) is in the new zone.
            m.uow.after_commit(timezone_changed)
        if {"moveDate", "holidayRegion"} & set(changed):
            m.refit_forecasts()
        if changed:
            m.uow.record(
                "settings.updated",
                [ref("settings", str(orm.SETTINGS_ID))],
                body.model_dump(mode="json", by_alias=True, exclude_unset=True),
                effects={"changed": changed},
            )
        return changed

    result = run_mutation(uow_factory, clock, change, "settings")
    return result.with_entity(SettingsMutationOut, result.require_plan().settings)


# ---------------------------------------------------------------------------- holidays and leave
def add_holiday(
    uow_factory: UnitOfWorkFactory, clock: Clock, day: dt.date, name: str
) -> HolidayMutationOut:
    """``POST /holidays``: a manual holiday in the current region (weekdays only)."""
    check_in_range(day)
    if day.isoweekday() > 5:
        raise ValidationFailed("That day is a weekend already.", field="date")
    label = " ".join(name.split())
    if not label:
        raise ValidationFailed("Give the holiday a name.", field="name")

    def change(m: MutationScope) -> tuple[orm.HolidayRegion, dt.date]:
        region = m.uow.repo(SETTINGS).get().holiday_region
        repo = m.uow.repo(HOLIDAYS)
        existing = repo.get(region, day)
        if existing is not None and not existing.suppressed:
            raise Conflict("There is already a holiday on that day.", field="date")
        repo.add_manual(region, day, label)
        m.refit_forecasts()
        m.uow.record(
            "holiday.added",
            [ref("holiday", f"{region}:{day.isoformat()}")],
            {"region": region, "date": day, "name": label},
        )
        return region, day

    result = run_mutation(uow_factory, clock, change, "calendar")
    region, _ = result.value
    return result.with_entity(
        HolidayMutationOut,
        HolidayOut(date=day, name=label, region=region, source="manual", suppressed=False),
    )


def remove_holiday(uow_factory: UnitOfWorkFactory, clock: Clock, day: dt.date) -> MutationOut:
    """``DELETE /holidays/{iso}``: generated holidays are suppressed, manual ones deleted."""

    def change(m: MutationScope) -> None:
        region = m.uow.repo(SETTINGS).get().holiday_region
        repo = m.uow.repo(HOLIDAYS)
        row = repo.get(region, day)
        if row is None or row.suppressed:
            raise NotFound("No holiday on that day.")
        source = row.source
        if source == "generated":
            repo.suppress(row)
        else:
            repo.delete(row)
        m.refit_forecasts()
        m.uow.record(
            "holiday.removed",
            [ref("holiday", f"{region}:{day.isoformat()}")],
            {"region": region, "date": day, "source": source},
        )

    return run_mutation(uow_factory, clock, change, "calendar").out()


def put_leave(
    uow_factory: UnitOfWorkFactory, clock: Clock, day: dt.date, hours: float | None, note: str
) -> LeaveMutationOut:
    """``PUT /leave/{iso}``: set a leave day (``hours`` ``None`` = the whole day)."""
    check_in_range(day)

    def change(m: MutationScope) -> LeaveDayOut:
        row = m.uow.repo(LEAVE).put(day, hours, note)
        m.uow.record(
            "leave.set",
            [ref("leave", day.isoformat())],
            {"date": day, "hours": hours, "note": note},
        )
        return leave_out(row)

    result = run_mutation(uow_factory, clock, change, "calendar")
    return result.with_entity(LeaveMutationOut, result.value)


def delete_leave(uow_factory: UnitOfWorkFactory, clock: Clock, day: dt.date) -> MutationOut:
    """``DELETE /leave/{iso}`` (404 when there is no leave that day)."""

    def change(m: MutationScope) -> None:
        repo = m.uow.repo(LEAVE)
        row = repo.get(day)
        if row is None:
            raise NotFound("No leave on that day.")
        repo.delete(row)
        m.uow.record("leave.cleared", [ref("leave", day.isoformat())], {"date": day})

    return run_mutation(uow_factory, clock, change, "calendar").out()


# ---------------------------------------------------------------------------- AI key
def put_ai_key(uow_factory: UnitOfWorkFactory, value: str | SecretStr) -> AiStatusOut:
    """Store the Anthropic key (keychain). Write-only: the response never contains it."""
    keys.set_api_key(value)
    invalidate_plan_cache(uow_factory)
    return ai_status_out(uow_factory)


def delete_ai_key(uow_factory: UnitOfWorkFactory) -> AiStatusOut:
    keys.clear_api_key()
    invalidate_plan_cache(uow_factory)
    return ai_status_out(uow_factory)


# ---------------------------------------------------------------------------- clock timezone
_generation_lock = threading.Lock()
_generation = 0


def timezone_changed() -> None:
    """Make every ``SettingsTimezone`` re-read the timezone on its next call."""
    global _generation
    with _generation_lock:
        _generation += 1


class SettingsTimezone:
    """The clock's ``tz_getter``: ``settings.timezone`` from the database.

    The value is cached for ``ttl`` seconds and dropped whenever settings or setup change the
    timezone (``timezone_changed``). Before the database is open it returns ``None`` (the clock
    then uses Europe/London).
    """

    def __init__(self, database: Callable[[], Database | None], ttl: float = 5.0) -> None:
        self._database = database
        self._ttl = ttl
        self._value: str | None = None
        self._read_at = 0.0
        self._generation = -1
        self._lock = threading.Lock()

    def __call__(self) -> str | None:
        now = time.monotonic()
        with self._lock:
            if (
                self._value is not None
                and self._generation == _generation
                and now - self._read_at < self._ttl
            ):
                return self._value
        database = self._database()
        if database is None:
            return None
        generation = _generation
        try:
            with database.session_factory() as session:
                value = session.scalar(
                    select(orm.Settings.timezone).where(orm.Settings.id == orm.SETTINGS_ID)
                )
        except Exception:
            return self._value
        with self._lock:
            self._value = value
            self._read_at = now
            self._generation = generation
        return value
