from datetime import UTC, date, datetime, timedelta, timezone
from uuid import UUID

import pytest

from remi.core import ids
from remi.core.clock import (
    DEFAULT_TIMEZONE,
    FixedClock,
    OffsetClock,
    SystemClock,
    build_clock,
    clock_overridden,
    resolve_zone,
)
from remi.core.errors import (
    Conflict,
    DomainError,
    NotFound,
    OutOfRange,
    SetupRequired,
    ValidationFailed,
    VersionConflict,
)
from remi.repositories.models import Note

# ------------------------------------------------------------------ ids


def test_new_id_is_a_uuid4_string() -> None:
    value = ids.new_id()
    assert len(value) == 36
    assert UUID(value).version == 4
    assert ids.new_id() != value


def test_id_factory_makes_ids_deterministic_and_restores() -> None:
    with ids.id_factory(ids.sequential_ids("t")):
        assert [ids.new_id(), ids.new_id()] == ["t-0001", "t-0002"]
        # ORM primary keys come from the same factory.
        assert Note(day=date(2026, 10, 5), text="x").id == "t-0003"
    assert UUID(ids.new_id()).version == 4


def test_monkeypatching_new_id_reaches_model_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ids, "new_id", lambda: "fixed-id")
    assert Note(day=date(2026, 10, 5), text="x").id == "fixed-id"


def test_explicit_ids_win_over_the_factory() -> None:
    assert Note(id="ret", day=date(2026, 10, 5), text="x").id == "ret"


# ------------------------------------------------------------------ errors


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (NotFound(), 404, "NOT_FOUND"),
        (Conflict(), 409, "CONFLICT"),
        (VersionConflict(), 409, "VERSION_CONFLICT"),
        (SetupRequired(), 409, "SETUP_REQUIRED"),
        (ValidationFailed(), 422, "VALIDATION_FAILED"),
        (OutOfRange(), 422, "OUT_OF_RANGE"),
    ],
)
def test_error_subclasses_carry_status_and_code(error: DomainError, status: int, code: str) -> None:
    assert isinstance(error, DomainError)
    assert (error.status, error.code) == (status, code)
    assert error.message
    assert error.field is None


def test_domain_error_fields_and_body() -> None:
    error = DomainError("BAD_HOURS", "Hours must be 0 to 24.", field="hours")
    assert error.status == 400
    assert str(error) == "Hours must be 0 to 24."
    assert error.to_dict() == {
        "code": "BAD_HOURS",
        "message": "Hours must be 0 to 24.",
        "field": "hours",
    }

    custom = NotFound("No such project.", "projectId", code="PROJECT_NOT_FOUND")
    assert custom.to_dict() == {
        "code": "PROJECT_NOT_FOUND",
        "message": "No such project.",
        "field": "projectId",
    }
    assert custom.status == 404
    assert DomainError("X", "y", status=418).status == 418
    assert "field" not in SetupRequired().to_dict()


# ------------------------------------------------------------------ clocks


def test_system_clock_reads_the_timezone_on_every_call() -> None:
    zone = {"name": "Pacific/Kiritimati"}  # UTC+14: usually a day ahead of London
    clock = SystemClock(lambda: zone["name"])
    now = clock.now()
    assert now.tzinfo is UTC
    assert clock.today() == datetime.now(resolve_zone("Pacific/Kiritimati")).date()
    zone["name"] = "Pacific/Pago_Pago"  # UTC-11
    assert clock.today() == datetime.now(resolve_zone("Pacific/Pago_Pago")).date()
    assert not clock.overridden


def test_system_clock_falls_back_to_london_for_bad_zones() -> None:
    assert str(SystemClock(lambda: "Not/AZone").zone()) == DEFAULT_TIMEZONE
    assert str(SystemClock(lambda: None).zone()) == DEFAULT_TIMEZONE
    assert str(SystemClock().zone()) == DEFAULT_TIMEZONE


def test_fixed_clock() -> None:
    now = datetime(2026, 10, 5, 9, 30, tzinfo=timezone(timedelta(hours=1)))
    clock = FixedClock(date(2026, 10, 5), now=now)
    assert clock.today() == date(2026, 10, 5)
    assert clock.now() == now
    assert clock.now().tzinfo is UTC
    assert clock.fixed_today == date(2026, 10, 5)
    assert clock.fixed_now == now
    assert FixedClock(date(2026, 10, 5)).now() == datetime(2026, 10, 5, 12, tzinfo=UTC)
    with pytest.raises(ValueError, match="timezone-aware"):
        FixedClock(date(2026, 10, 5), datetime(2026, 10, 5, 9, 30))  # noqa: DTZ001
    assert clock_overridden(clock)


class _Ticking:
    """A 'real' clock whose time can be advanced."""

    def __init__(self, now: datetime) -> None:
        self.current = now

    def now(self) -> datetime:
        return self.current

    def today(self) -> date:
        return self.current.astimezone(resolve_zone("Europe/London")).date()


def test_offset_clock_shifts_the_date_and_keeps_the_wall_clock_running() -> None:
    real = _Ticking(datetime(2026, 9, 24, 13, 15, tzinfo=UTC))  # 14:15 in London (BST)
    clock = OffsetClock(real, date(2026, 10, 5), tz_getter=lambda: "Europe/London")
    assert clock.offset == timedelta(days=11)
    assert clock.today() == date(2026, 10, 5)
    assert clock.now() == datetime(2026, 10, 5, 13, 15, tzinfo=UTC)

    real.current += timedelta(minutes=30)  # time keeps running
    assert clock.now() == datetime(2026, 10, 5, 13, 45, tzinfo=UTC)
    assert clock.today() == date(2026, 10, 5)

    real.current += timedelta(hours=12)  # past local midnight: the day rolls over
    assert clock.today() == date(2026, 10, 6)
    assert clock.now().astimezone(resolve_zone("Europe/London")).date() == date(2026, 10, 6)
    assert clock_overridden(clock)


def test_offset_clock_keeps_local_wall_time_across_dst() -> None:
    real = _Ticking(datetime(2026, 9, 24, 8, 30, tzinfo=UTC))  # 09:30 BST
    clock = OffsetClock(real, date(2027, 1, 4), tz_getter=lambda: "Europe/London")
    # 09:30 local on the shifted date, which is GMT in January.
    assert clock.now() == datetime(2027, 1, 4, 9, 30, tzinfo=UTC)


def test_build_clock() -> None:
    assert isinstance(build_clock(None), SystemClock)
    pinned = build_clock(date(2026, 10, 5))
    assert isinstance(pinned, OffsetClock)
    assert pinned.today() == date(2026, 10, 5)
    assert pinned.now().tzinfo is UTC
    assert not clock_overridden(build_clock(None))
