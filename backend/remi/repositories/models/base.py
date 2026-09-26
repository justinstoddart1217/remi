"""Declarative base, mixins and column types shared by every table.

* Constraint names follow :data:`NAMING_CONVENTION`; Alembic's batch mode on SQLite needs them.
* :class:`UUIDPk` gives a ``String(36)`` primary key from :func:`app.core.ids.new_id`, assigned
  as soon as the object is constructed (so services can reference ``obj.id`` before a flush).
* :class:`Timestamps` adds ``created_at``/``updated_at``; the unit of work stamps them from its
  clock, and the column defaults are only a fallback for writes made outside one.
* :class:`UTCDateTime` stores aware datetimes as fixed-width ISO-8601 UTC text
  (``2026-10-05T08:00:00.000000Z``), which sorts correctly as text.
* Business dates use ``Date``; JSON columns use ``JSON`` (mutate by reassigning, not in place).
* Enum-like columns are ``String`` + a named ``CHECK``, generated from ``Literal`` types by
  :func:`check_in`, so the Python type and the database agree.
"""

from datetime import UTC, date, datetime
from typing import Any, Final, Literal, get_args

from sqlalchemy import JSON, CheckConstraint, Date, Dialect, MetaData, String, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

from remi.core import ids

NAMING_CONVENTION: Final = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

JSONDict = dict[str, Any]
JSONList = list[Any]

# ------------------------------------------------------------------ shared enums
Domain = Literal["pc", "fi"]
HolidayRegion = Literal["GB-ENG", "ZA"]
DOMAINS: Final = get_args(Domain)
HOLIDAY_REGIONS: Final = get_args(HolidayRegion)

UTC_TEXT_FORMAT: Final = "%Y-%m-%dT%H:%M:%S.%fZ"


def format_utc(value: datetime) -> str:
    """Aware datetime -> ``YYYY-MM-DDTHH:MM:SS.ffffffZ``. Naive datetimes are refused."""
    if value.tzinfo is None or value.utcoffset() is None:
        msg = f"naive datetime {value!r}: Remi stores timezone-aware UTC instants only"
        raise ValueError(msg)
    return value.astimezone(UTC).strftime(UTC_TEXT_FORMAT)


def parse_utc(text: str) -> datetime:
    """The inverse of :func:`format_utc`; also accepts other ISO-8601 forms with an offset."""
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


class UTCDateTime(TypeDecorator[datetime]):
    """An aware ``datetime`` stored as ISO-8601 UTC text; loads back as aware UTC."""

    impl = String(32)
    cache_ok = True

    @property
    def python_type(self) -> type[datetime]:
        return datetime

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> str | None:
        return None if value is None else format_utc(value)

    def process_literal_param(self, value: datetime | None, dialect: Dialect) -> str:
        return "NULL" if value is None else f"'{format_utc(value)}'"

    def process_result_value(self, value: str | None, dialect: Dialect) -> datetime | None:
        return None if value is None else parse_utc(value)


def utcnow() -> datetime:
    """Fallback for timestamp defaults; units of work stamp from their clock instead."""
    return datetime.now(UTC)


def new_pk() -> str:
    # Looked up at call time so tests can patch app.core.ids.new_id.
    return ids.new_id()


def check_in(column: str, values: tuple[str, ...], name: str | None = None) -> CheckConstraint:
    """``CHECK ("column" IN ('a', 'b'))`` named ``<column>_valid`` unless ``name`` is given."""
    if not values:
        msg = f"check_in({column!r}) needs at least one value"
        raise ValueError(msg)
    quoted = ", ".join("'" + v.replace("'", "''") + "'" for v in values)
    return CheckConstraint(f'"{column}" IN ({quoted})', name=name or f"{column}_valid")


def check_range(
    column: str,
    low: float | None,
    high: float | None,
    *,
    nullable: bool = False,
    name: str | None = None,
) -> CheckConstraint:
    """``CHECK (low <= column <= high)``; ``nullable`` also allows NULL."""
    parts: list[str] = []
    if low is not None:
        parts.append(f'"{column}" >= {low:g}')
    if high is not None:
        parts.append(f'"{column}" <= {high:g}')
    if not parts:
        msg = f"check_range({column!r}) needs a bound"
        raise ValueError(msg)
    expr = " AND ".join(parts)
    if nullable:
        expr = f'"{column}" IS NULL OR ({expr})'
    return CheckConstraint(expr, name=name or f"{column}_range")


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {  # noqa: RUF012 - SQLAlchemy reads this class attribute
        datetime: UTCDateTime(),
        date: Date(),
        JSONDict: JSON(),
        JSONList: JSON(),
    }


class UUIDPk:
    """``id``: a UUID string primary key, assigned when the object is constructed."""

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_pk, sort_order=-100)


class CreatedAt:
    """``created_at`` only (append-style rows)."""

    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, sort_order=100)


class Timestamps:
    """``created_at`` and ``updated_at``, stamped by the unit of work from its clock.

    ``updated_at`` has no ``onupdate``: the unit of work stamps every modified row in
    ``before_flush``. An ``onupdate`` would fire whenever that stamp equals the stored value
    (a frozen ``REMI_NOW`` clock) and write wall-clock time instead. ``default`` is only a
    fallback for rows inserted outside a unit of work."""

    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, sort_order=100)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, sort_order=101)


@event.listens_for(Base, "init", propagate=True)
def _assign_uuid_on_init(  # pyright: ignore[reportUnusedFunction]
    target: Any, _args: Any, kwargs: dict[str, Any]
) -> None:
    if isinstance(target, UUIDPk) and kwargs.get("id") is None:
        kwargs["id"] = new_pk()
