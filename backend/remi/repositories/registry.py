"""Every repository, registered with the unit of work.

Import the typed keys from here::

    from remi.repositories.registry import PROJECTS, SETTINGS

    with uow_factory() as uow:
        project = uow.repo(PROJECTS).require(project_id)

Importing this module registers all of them, so ``uow.projects`` (untyped) works too.
"""

from typing import Final

from remi.core.uow import RepoKey, register_repository
from remi.repositories.ai_audit_repo import AiAuditRepository
from remi.repositories.alias_repo import AliasRepository
from remi.repositories.chart_asset_repo import ChartAssetRepository
from remi.repositories.event_repo import EventRepository
from remi.repositories.feed_repo import FeedRepository
from remi.repositories.holiday_repo import HolidayRepository, LeaveRepository
from remi.repositories.note_repo import NoteRepository
from remi.repositories.project_repo import ProjectRepository
from remi.repositories.rotation_repo import RotationRepository
from remi.repositories.routine_repo import RoutineRepository
from remi.repositories.settings_repo import SettingsRepository
from remi.repositories.textbook_repo import TextbookRepository

SETTINGS: Final[RepoKey[SettingsRepository]] = register_repository("settings", SettingsRepository)
HOLIDAYS: Final[RepoKey[HolidayRepository]] = register_repository("holidays", HolidayRepository)
LEAVE: Final[RepoKey[LeaveRepository]] = register_repository("leave", LeaveRepository)
PROJECTS: Final[RepoKey[ProjectRepository]] = register_repository("projects", ProjectRepository)
ROUTINES: Final[RepoKey[RoutineRepository]] = register_repository("routines", RoutineRepository)
ROTATION: Final[RepoKey[RotationRepository]] = register_repository("rotation", RotationRepository)
NOTES: Final[RepoKey[NoteRepository]] = register_repository("notes", NoteRepository)
ALIASES: Final[RepoKey[AliasRepository]] = register_repository("aliases", AliasRepository)
FEED: Final[RepoKey[FeedRepository]] = register_repository("feed", FeedRepository)
EVENTS: Final[RepoKey[EventRepository]] = register_repository("events", EventRepository)
TEXTBOOK: Final[RepoKey[TextbookRepository]] = register_repository("textbook", TextbookRepository)
CHART_ASSETS: Final[RepoKey[ChartAssetRepository]] = register_repository(
    "chart_assets", ChartAssetRepository
)
AI_AUDIT: Final[RepoKey[AiAuditRepository]] = register_repository("ai_audit", AiAuditRepository)

__all__ = [
    "AI_AUDIT",
    "ALIASES",
    "CHART_ASSETS",
    "EVENTS",
    "FEED",
    "HOLIDAYS",
    "LEAVE",
    "NOTES",
    "PROJECTS",
    "ROTATION",
    "ROUTINES",
    "SETTINGS",
    "TEXTBOOK",
]
