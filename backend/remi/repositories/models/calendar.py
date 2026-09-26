"""Holidays (generated offline per region and year, plus manual ones) and personal leave."""

import datetime as dt
from typing import Final, Literal, get_args

from sqlalchemy import Boolean, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from remi.repositories.models.base import (
    HOLIDAY_REGIONS,
    Base,
    HolidayRegion,
    UTCDateTime,
    check_in,
    check_range,
)

HolidaySource = Literal["generated", "manual"]
HOLIDAY_SOURCES: Final = get_args(HolidaySource)


class Holiday(Base):
    """A public holiday. Removing a generated one sets ``suppressed`` (so regeneration keeps
    it removed); removing a manual one deletes the row."""

    __tablename__ = "holidays"
    __table_args__ = (
        check_in("region", HOLIDAY_REGIONS),
        check_in("source", HOLIDAY_SOURCES),
    )

    region: Mapped[HolidayRegion] = mapped_column(String(16), primary_key=True)
    date: Mapped[dt.date] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    source: Mapped[HolidaySource] = mapped_column(String(16), default="generated")
    suppressed: Mapped[bool] = mapped_column(Boolean, default=False)


class HolidayYear(Base):
    """Which (region, year) pairs have been generated, and by which ``holidays`` version."""

    __tablename__ = "holiday_years"
    __table_args__ = (
        check_in("region", HOLIDAY_REGIONS),
        check_range("year", 1900, 2200),
    )

    region: Mapped[HolidayRegion] = mapped_column(String(16), primary_key=True)
    year: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    package_version: Mapped[str] = mapped_column(String(32))
    generated_at: Mapped[dt.datetime] = mapped_column(UTCDateTime())


class LeaveDay(Base):
    """Personal leave (data only). ``hours`` NULL means the whole day."""

    __tablename__ = "leave_days"
    __table_args__ = (check_range("hours", 0, 24, nullable=True),)

    date: Mapped[dt.date] = mapped_column(primary_key=True)
    hours: Mapped[float | None] = mapped_column(Float)
    note: Mapped[str] = mapped_column(Text, default="")
