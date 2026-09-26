"""Row builders shared by the persistence-core tests."""

from datetime import date
from typing import Any

from remi.repositories.models import Project


def make_project(name: str = "Returns pipeline", **fields: Any) -> Project:
    values: dict[str, Any] = {
        "domain": "pc",
        "name": name,
        "short": name.split()[0],
        "start_date": date(2026, 9, 1),
        "target_date": date(2026, 11, 27),
        "forecast_date": date(2026, 12, 2),
        "rate_hours_per_day": 3.5,
        "rate_after_move": 1.0,
    }
    values.update(fields)
    return Project(**values)
