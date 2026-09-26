"""``HolidayRepository`` (holidays and generated years) and ``LeaveRepository`` (leave days).

Holidays are keyed by (region, date). Generated rows come from ``services/holidays``; a removed
generated holiday stays as a ``suppressed`` row so regeneration keeps it removed, and manual
rows are the user's own. ``holiday_years`` records which (region, year) pairs were generated and
by which ``holidays`` package version.
"""

import builtins
import datetime as dt
from collections.abc import Iterable, Mapping

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from remi.repositories.models import Holiday, HolidayRegion, HolidayYear, LeaveDay


class HolidayRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list(
        self,
        region: HolidayRegion,
        frm: dt.date | None = None,
        to: dt.date | None = None,
        *,
        include_suppressed: bool = True,
    ) -> builtins.list[Holiday]:
        """Holidays in ``[frm, to]`` (either end open), by date."""
        stmt = select(Holiday).where(Holiday.region == region)
        if frm is not None:
            stmt = stmt.where(Holiday.date >= frm)
        if to is not None:
            stmt = stmt.where(Holiday.date <= to)
        if not include_suppressed:
            stmt = stmt.where(Holiday.suppressed.is_(False))
        return list(self.session.scalars(stmt.order_by(Holiday.date)))

    def effective(self, region: HolidayRegion, frm: dt.date, to: dt.date) -> dict[dt.date, str]:
        """``{date: name}`` of the holidays that count (not suppressed) in ``[frm, to]``."""
        return {h.date: h.name for h in self.list(region, frm, to, include_suppressed=False)}

    def get(self, region: HolidayRegion, day: dt.date) -> Holiday | None:
        return self.session.get(Holiday, (region, day))

    def covered_years(self, region: HolidayRegion) -> dict[int, str]:
        """``{year: package_version}`` for every generated year of ``region``."""
        rows = self.session.scalars(select(HolidayYear).where(HolidayYear.region == region))
        return {row.year: row.package_version for row in rows}

    def replace_generated_year(
        self,
        region: HolidayRegion,
        year: int,
        generated: Mapping[dt.date, str],
        *,
        package_version: str,
        generated_at: dt.datetime,
    ) -> int:
        """Replace ``year``'s generated rows with ``generated``; manual and suppressed rows stay.

        Returns the number of rows inserted.
        """
        first, last = dt.date(year, 1, 1), dt.date(year, 12, 31)
        self.session.execute(
            delete(Holiday).where(
                Holiday.region == region,
                Holiday.date >= first,
                Holiday.date <= last,
                Holiday.source == "generated",
                Holiday.suppressed.is_(False),
            )
        )
        kept = {h.date for h in self.list(region, first, last)}
        inserted = 0
        for day, name in sorted(generated.items()):
            if day in kept or not first <= day <= last:
                continue
            self.session.add(
                Holiday(region=region, date=day, name=name, source="generated", suppressed=False)
            )
            inserted += 1
        marker = self.session.get(HolidayYear, (region, year))
        if marker is None:
            self.session.add(
                HolidayYear(
                    region=region,
                    year=year,
                    package_version=package_version,
                    generated_at=generated_at,
                )
            )
        else:
            marker.package_version = package_version
            marker.generated_at = generated_at
        self.session.flush()
        return inserted

    def add_manual(self, region: HolidayRegion, day: dt.date, name: str) -> Holiday:
        """A user-added holiday (replaces a suppressed generated row on the same day)."""
        row = self.get(region, day)
        if row is None:
            row = Holiday(region=region, date=day, name=name, source="manual", suppressed=False)
            self.session.add(row)
        else:
            row.name = name
            row.source = "manual"
            row.suppressed = False
        self.session.flush()
        return row

    def suppress(self, row: Holiday) -> None:
        """Remove a generated holiday but remember it, so regeneration keeps it removed."""
        row.suppressed = True

    def delete(self, row: Holiday) -> None:
        self.session.delete(row)

    def delete_all(self) -> None:
        """Every holiday and generated-year marker (dev fixtures)."""
        self.session.execute(delete(Holiday))
        self.session.execute(delete(HolidayYear))


class LeaveRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list(
        self, frm: dt.date | None = None, to: dt.date | None = None
    ) -> builtins.list[LeaveDay]:
        stmt = select(LeaveDay)
        if frm is not None:
            stmt = stmt.where(LeaveDay.date >= frm)
        if to is not None:
            stmt = stmt.where(LeaveDay.date <= to)
        return list(self.session.scalars(stmt.order_by(LeaveDay.date)))

    def as_mapping(
        self, frm: dt.date | None = None, to: dt.date | None = None
    ) -> dict[dt.date, float | None]:
        """``{date: hours off}`` (``None`` = the whole day), the engine's ``leave`` input."""
        return {row.date: row.hours for row in self.list(frm, to)}

    def get(self, day: dt.date) -> LeaveDay | None:
        return self.session.get(LeaveDay, day)

    def put(self, day: dt.date, hours: float | None, note: str) -> LeaveDay:
        row = self.get(day)
        if row is None:
            row = LeaveDay(date=day, hours=hours, note=note)
            self.session.add(row)
        else:
            row.hours = hours
            row.note = note
        self.session.flush()
        return row

    def delete(self, row: LeaveDay) -> None:
        self.session.delete(row)

    def delete_many(self, days: Iterable[dt.date]) -> None:
        for day in days:
            row = self.get(day)
            if row is not None:
                self.session.delete(row)
