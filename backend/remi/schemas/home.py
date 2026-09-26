"""``HomeOut``: the launcher page (``GET /home``). Works before setup."""

import datetime as dt

from remi.schemas.base import CamelModel, Domain
from remi.schemas.project import ProjectStatus


class HomeKeyProjectOut(CamelModel):
    """The key project on the Control Panel card ("Returns pipeline · Wed 2 Dec · +3 BD")."""

    id: str
    name: str
    short: str
    domain: Domain
    status: ProjectStatus
    forecast_date: dt.date | None
    target_date: dt.date
    delta_bd: int | None


class HomeTextbookOut(CamelModel):
    pages: int
    live_charts: int


class HomeOut(CamelModel):
    needs_setup: bool
    today: dt.date
    is_bd: bool
    bdm: int | None
    move_date: dt.date | None
    countdown_bd: int | None
    """Business days strictly between today and the move; ``null`` before setup."""
    project_count: int
    routine_count: int
    notes_today: int
    key_project: HomeKeyProjectOut | None
    """The settings' key project, else the first PC project, else ``null``."""
    textbook: HomeTextbookOut
