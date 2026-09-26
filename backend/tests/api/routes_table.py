"""The frozen API contract: every route, its success status and its schemas.

Changing this table is a contract change (an ADR plus ``make openapi``). Paths are relative to
``/api``. ``list[X]`` is a JSON array of ``X``; ``html`` is ``text/html``; ``None`` is no body.
"""

from typing import Any, NamedTuple
from uuid import UUID


class Route(NamedTuple):
    method: str
    path: str
    status: int
    request: str | None
    response: str | None
    tag: str


ROUTES: tuple[Route, ...] = (
    Route("GET", "/health", 200, None, "HealthOut", "health"),
    # setup and settings
    Route("GET", "/setup", 200, None, "SetupStatusOut", "setup"),
    Route("POST", "/setup", 201, "SetupIn", "SettingsMutationOut", "setup"),
    Route("GET", "/setup/countdown", 200, None, "CountdownOut", "setup"),
    Route("GET", "/settings", 200, None, "SettingsOut", "settings"),
    Route("PATCH", "/settings", 200, "SettingsPatch", "SettingsMutationOut", "settings"),
    Route("PUT", "/settings/ai-key", 200, "AiKeyPut", "AiStatusOut", "settings"),
    Route("DELETE", "/settings/ai-key", 200, None, "AiStatusOut", "settings"),
    Route("GET", "/ai/status", 200, None, "AiStatusOut", "ai"),
    Route("GET", "/ai/audit", 200, None, "AiAuditPageOut", "ai"),
    # calendar
    Route("GET", "/calendar", 200, None, "CalendarOut", "calendar"),
    Route("GET", "/loads", 200, None, "LoadsOut", "calendar"),
    Route("GET", "/holidays", 200, None, "list[HolidayOut]", "calendar"),
    Route("POST", "/holidays", 201, "HolidayCreate", "HolidayMutationOut", "calendar"),
    Route("DELETE", "/holidays/{iso}", 200, None, "MutationOut", "calendar"),
    Route("GET", "/leave", 200, None, "list[LeaveDayOut]", "calendar"),
    Route("PUT", "/leave/{iso}", 200, "LeavePut", "LeaveMutationOut", "calendar"),
    Route("DELETE", "/leave/{iso}", 200, None, "MutationOut", "calendar"),
    # read models
    Route("GET", "/plan", 200, None, "PlanOut", "plan"),
    Route("GET", "/day/{iso}", 200, None, "DayOut", "plan"),
    Route("GET", "/month-snapshot", 200, None, "MonthSnapshotOut", "plan"),
    Route("GET", "/home", 200, None, "HomeOut", "plan"),
    # projects
    Route("GET", "/projects", 200, None, "list[ProjectOut]", "projects"),
    Route("POST", "/projects", 201, "ProjectCreate", "ProjectMutationOut", "projects"),
    Route("GET", "/projects/{projectId}", 200, None, "ProjectOut", "projects"),
    Route("PATCH", "/projects/{projectId}", 200, "ProjectPatch", "ProjectMutationOut", "projects"),
    Route("DELETE", "/projects/{projectId}", 200, None, "MutationOut", "projects"),
    Route(
        "POST", "/projects/{projectId}/replan", 200, "ReplanIn", "ProjectMutationOut", "projects"
    ),
    Route(
        "POST",
        "/projects/{projectId}/replan/preview",
        200,
        "ReplanIn",
        "ReplanPreviewOut",
        "projects",
    ),
    Route(
        "GET",
        "/projects/{projectId}/snapshots",
        200,
        None,
        "list[ProjectSnapshotOut]",
        "projects",
    ),
    Route(
        "PUT",
        "/projects/{projectId}/bau-day-hours",
        200,
        "BauDayHoursPut",
        "ProjectMutationOut",
        "projects",
    ),
    Route(
        "PUT",
        "/projects/{projectId}/overrides/{iso}",
        200,
        "HourOverridePut",
        "ProjectMutationOut",
        "projects",
    ),
    Route(
        "DELETE",
        "/projects/{projectId}/overrides/{iso}",
        200,
        None,
        "ProjectMutationOut",
        "projects",
    ),
    # charter
    Route(
        "POST",
        "/projects/{projectId}/charter/{list}",
        201,
        "CharterItemCreate",
        "CharterItemMutationOut",
        "charter",
    ),
    Route(
        "PUT",
        "/projects/{projectId}/charter/{list}/order",
        200,
        "OrderPut",
        "ProjectMutationOut",
        "charter",
    ),
    Route(
        "PATCH",
        "/charter-items/{itemId}",
        200,
        "CharterItemPatch",
        "CharterItemMutationOut",
        "charter",
    ),
    Route("DELETE", "/charter-items/{itemId}", 200, None, "MutationOut", "charter"),
    # milestones and tasks
    Route(
        "POST",
        "/projects/{projectId}/milestones",
        201,
        "MilestoneCreate",
        "MilestoneMutationOut",
        "milestones",
    ),
    Route(
        "PUT",
        "/projects/{projectId}/milestones/order",
        200,
        "OrderPut",
        "ProjectMutationOut",
        "milestones",
    ),
    Route(
        "PATCH",
        "/milestones/{milestoneId}",
        200,
        "MilestonePatch",
        "MilestoneMutationOut",
        "milestones",
    ),
    Route("DELETE", "/milestones/{milestoneId}", 200, None, "MutationOut", "milestones"),
    Route("POST", "/milestones/{milestoneId}/tasks", 201, "TaskCreate", "TaskMutationOut", "tasks"),
    Route(
        "PUT",
        "/milestones/{milestoneId}/tasks/order",
        200,
        "OrderPut",
        "MilestoneMutationOut",
        "tasks",
    ),
    Route("PATCH", "/tasks/{taskId}", 200, "TaskPatch", "TaskMutationOut", "tasks"),
    Route("DELETE", "/tasks/{taskId}", 200, None, "MutationOut", "tasks"),
    # readiness items (decision 10)
    Route(
        "POST",
        "/projects/{projectId}/readiness-items",
        201,
        "ReadinessItemCreate",
        "ReadinessItemMutationOut",
        "readiness",
    ),
    Route(
        "PUT",
        "/projects/{projectId}/readiness-items/order",
        200,
        "OrderPut",
        "ProjectMutationOut",
        "readiness",
    ),
    Route(
        "PATCH",
        "/readiness-items/{itemId}",
        200,
        "ReadinessItemPatch",
        "ReadinessItemMutationOut",
        "readiness",
    ),
    Route("DELETE", "/readiness-items/{itemId}", 200, None, "MutationOut", "readiness"),
    # routines, runs, ticks and checklist items (decision 10)
    Route("GET", "/routines", 200, None, "list[RoutineOut]", "routines"),
    Route("POST", "/routines", 201, "RoutineCreate", "RoutineMutationOut", "routines"),
    Route("GET", "/routines/{routineId}", 200, None, "RoutineOut", "routines"),
    Route("PATCH", "/routines/{routineId}", 200, "RoutinePatch", "RoutineMutationOut", "routines"),
    Route("DELETE", "/routines/{routineId}", 200, None, "MutationOut", "routines"),
    Route("GET", "/routines/{routineId}/occurrences", 200, None, "list[OccurrenceOut]", "routines"),
    Route(
        "PUT",
        "/routines/{routineId}/runs/{iso}",
        200,
        "RunPut",
        "RoutineRunMutationOut",
        "routines",
    ),
    Route(
        "PUT",
        "/routines/{routineId}/runs/{iso}/items",
        200,
        "TickPut",
        "RoutineRunMutationOut",
        "routines",
    ),
    Route(
        "PUT",
        "/routines/{routineId}/runs/{iso}/items/{itemId}",
        200,
        "TickPut",
        "RoutineRunMutationOut",
        "routines",
    ),
    Route(
        "POST",
        "/routines/{routineId}/checklist-items",
        201,
        "RoutineChecklistItemCreate",
        "RoutineChecklistItemMutationOut",
        "routines",
    ),
    Route(
        "PUT",
        "/routines/{routineId}/checklist-items/order",
        200,
        "OrderPut",
        "RoutineMutationOut",
        "routines",
    ),
    Route(
        "PATCH",
        "/routine-checklist-items/{itemId}",
        200,
        "RoutineChecklistItemPatch",
        "RoutineChecklistItemMutationOut",
        "routines",
    ),
    Route("DELETE", "/routine-checklist-items/{itemId}", 200, None, "MutationOut", "routines"),
    # rotation (settings' rotation editor)
    Route("GET", "/rotation", 200, None, "RotationOut", "rotation"),
    Route("PATCH", "/rotation", 200, "RotationPatch", "RotationMutationOut", "rotation"),
    Route(
        "PUT", "/rotation/segments", 200, "RotationSegmentsPut", "RotationMutationOut", "rotation"
    ),
    # check-ins
    Route("POST", "/checkins/parse", 200, "ParseRequest", "ProposalOut", "checkins"),
    Route("POST", "/checkins/parse-simple", 200, "ParseRequest", "ProposalOut", "checkins"),
    Route("DELETE", "/checkins/parse/{parseId}", 204, None, None, "checkins"),
    Route("POST", "/checkins/preview", 200, "PreviewRequest", "PreviewOut", "checkins"),
    Route("POST", "/checkins/apply", 200, "ApplyRequest", "CheckinMutationOut", "checkins"),
    # notes
    Route("GET", "/notes/days", 200, None, "NoteDaysOut", "notes"),
    Route("GET", "/notes", 200, None, "NoteListOut", "notes"),
    Route("POST", "/notes", 201, "NoteCreate", "NoteMutationOut", "notes"),
    Route("GET", "/notes/recent", 200, None, "RecentNotesOut", "notes"),
    Route("GET", "/notes/day-text", 200, None, "DayTextOut", "notes"),
    Route("POST", "/notes/tags", 200, "TagPreviewIn", "TagPreviewOut", "notes"),
    Route("PATCH", "/notes/{noteId}", 200, "NotePatch", "NoteMutationOut", "notes"),
    Route("DELETE", "/notes/{noteId}", 200, None, "MutationOut", "notes"),
    # textbook and charts
    Route("GET", "/textbook", 200, None, "TextbookTreeOut", "textbook"),
    Route("GET", "/textbook/home", 200, None, "TextbookHomeOut", "textbook"),
    Route("GET", "/textbook/search", 200, None, "TextbookSearchOut", "textbook"),
    Route("POST", "/textbook/sections", 201, "SectionCreate", "SectionOut", "textbook"),
    Route("PUT", "/textbook/sections/order", 200, "OrderPut", "TextbookTreeOut", "textbook"),
    Route("PATCH", "/textbook/sections/{sectionId}", 200, "SectionPatch", "SectionOut", "textbook"),
    Route("DELETE", "/textbook/sections/{sectionId}", 204, None, None, "textbook"),
    Route("POST", "/textbook/pages", 201, "PageCreate", "PageCreatedOut", "textbook"),
    Route("GET", "/textbook/pages/{pageId}", 200, None, "PageOut", "textbook"),
    Route("PATCH", "/textbook/pages/{pageId}", 200, "PagePatch", "PageSummaryOut", "textbook"),
    Route("DELETE", "/textbook/pages/{pageId}", 200, None, "PageDeletedOut", "textbook"),
    Route("PUT", "/textbook/pages/{pageId}/blocks", 200, "BlocksPut", "PageSavedOut", "textbook"),
    Route("POST", "/textbook/charts", 201, "Body_upload_chart", "ChartUploadOut", "textbook"),
    Route("DELETE", "/textbook/charts/{assetId}", 204, None, None, "textbook"),
    Route("GET", "/charts/{assetId}", 200, None, "html", "charts"),
    # data only
    Route("GET", "/feed", 200, None, "FeedPageOut", "feed"),
    Route("GET", "/aliases", 200, None, "list[AliasOut]", "aliases"),
    Route("POST", "/aliases", 201, "AliasCreate", "AliasMutationOut", "aliases"),
    Route("DELETE", "/aliases/{aliasId}", 200, None, "MutationOut", "aliases"),
    Route("GET", "/events", 200, None, "EventPageOut", "events"),
)

DEV_ROUTES: tuple[Route, ...] = (
    Route("POST", "/dev/fixtures", 200, "DevFixturesIn", "MutationOut", "dev"),
)

# ---------------------------------------------------------------- sample requests
PARSE_ID = str(UUID("6f1c2a7e-3b7d-4c55-9a51-2f4f8c1b9d10"))

PATH_VALUES: dict[str, str] = {
    "iso": "2026-10-05",
    "projectId": "p-ret",
    "milestoneId": "m-1",
    "taskId": "t-1",
    "itemId": "i-1",
    "routineId": "r-ret",
    "noteId": "n-1",
    "sectionId": "s-fi",
    "pageId": "pg-1",
    "assetId": "a-1",
    "aliasId": "al-1",
    "parseId": PARSE_ID,
    "list": "inScope",
}

QUERIES: dict[tuple[str, str], dict[str, str]] = {
    ("GET", "/setup/countdown"): {"moveDate": "2027-01-04", "holidayRegion": "GB-ENG"},
    ("GET", "/calendar"): {"from": "2026-09-28", "to": "2027-03-31", "holidayRegion": "ZA"},
    ("GET", "/loads"): {"from": "2026-10-01", "to": "2026-10-31"},
    ("GET", "/month-snapshot"): {"month": "2026-10"},
    ("GET", "/notes"): {"day": "2026-10-05"},
    ("GET", "/notes/day-text"): {"day": "2026-10-05"},
    ("GET", "/notes/recent"): {"businessDays": "5"},
    ("GET", "/textbook/search"): {"q": "duration"},
    ("GET", "/routines/{routineId}/occurrences"): {"after": "2026-10-05", "limit": "3"},
    ("GET", "/feed"): {"limit": "20"},
    ("GET", "/events"): {"since": "0", "limit": "10"},
}

ALL_CHANGES: list[dict[str, Any]] = [
    {"type": "task_done", "projectId": "p-ret", "taskId": "t-1"},
    {"type": "task_add", "projectId": "p-ret", "text": "FX share classes", "hours": 2},
    {"type": "scope_add", "projectId": "p-ret", "text": "FX attribution", "hours": 6},
    {"type": "blocker", "projectId": "p-ret", "text": "Waiting on the admin extract"},
    {"type": "confidence", "projectId": "p-ret", "value": 3},
    {"type": "target_move", "projectId": "p-play", "date": "2027-01-08"},
    {"type": "hours_per_day", "projectId": "p-manco", "value": 2},
    {"type": "note", "projectId": "p-manco", "text": "Sent the NAV bridge spec to Finance"},
    {"type": "bau_done", "routineId": "r-ret"},
]

ALL_BLOCKS: list[dict[str, Any]] = [
    {"id": "b1", "type": "h1", "text": "Rates and duration"},
    {"id": "b2", "type": "h2", "text": "Price and yield"},
    {"id": "b3", "type": "h3", "text": "Convexity"},
    {"id": "b4", "type": "p", "text": "When yields rise, bond prices fall."},
    {"id": "b5", "type": "formula", "tex": "\\frac{\\Delta P}{P} \\approx -D \\times \\Delta y"},
    {"id": "b6", "type": "bullet", "text": "Duration is first order"},
    {"id": "b7", "type": "callout", "text": "A note worth remembering"},
    {"id": "b8", "type": "page", "targetPageId": "pg-2"},
    {
        "id": "b9",
        "type": "chart",
        "assetId": "a-1",
        "name": "price-yield.html",
        "height": 380,
        "caption": "Price against yield",
    },
    {"id": "b10", "type": "divider"},
]

SEGMENTS: list[dict[str, Any]] = [
    {"country": "Germany", "code": "DE", "lengthBd": 6, "pass": "Build"},
    {"id": "seg-2", "country": "France", "code": "FR", "lengthBd": 5, "pass": "Build"},
    {"country": "Germany", "code": "DE", "lengthBd": 3, "pass": "Refresh"},
]

BODIES: dict[tuple[str, str], dict[str, Any]] = {
    ("POST", "/setup"): {
        "moveDate": "2027-01-04",
        "timezone": "Europe/London",
        "holidayRegion": "GB-ENG",
        "capacityHoursPerDay": 8,
        "rotation": {"hoursPerDay": 4, "segments": SEGMENTS},
        "aiProvider": "none",
    },
    ("PATCH", "/settings"): {
        "moveDate": "2027-01-04",
        "capacityHoursPerDay": 7.5,
        "timezone": "Europe/London",
        "keyProjectId": "p-ret",
        "keyRoutineId": None,
        "motionPreference": "reduced",
        "accentPc": "#526e2a",
        "accentFi": "#47619c",
        "serifDisplay": False,
        "aiProvider": "ollama",
        "uiPrefs": {"timelineZoom": "2w"},
    },
    ("PUT", "/settings/ai-key"): {"apiKey": "sk-ant-not-a-real-key"},
    ("POST", "/holidays"): {"date": "2026-12-24", "name": "Christmas Eve"},
    ("PUT", "/leave/{iso}"): {"hours": None, "note": "Day off"},
    ("POST", "/projects"): {"domain": "pc"},
    ("PATCH", "/projects/{projectId}"): {
        "name": "Returns pipeline automation",
        "goal": "Returns run themselves.",
        "targetDate": "2026-11-27",
        "targetLabel": None,
        "confidence": 3,
        "exitRoutes": ["Automate", "Hand over"],
    },
    ("POST", "/projects/{projectId}/replan"): {"rate": 3.8},
    ("POST", "/projects/{projectId}/replan/preview"): {"workLeft": 144},
    ("PUT", "/projects/{projectId}/bau-day-hours"): {
        "rules": [{"routineId": "r-ret", "hours": 0}, {"routineId": "r-man", "hours": 2}]
    },
    ("PUT", "/projects/{projectId}/overrides/{iso}"): {"hours": 3.5},
    ("POST", "/projects/{projectId}/charter/{list}"): {"text": ""},
    ("PUT", "/projects/{projectId}/charter/{list}/order"): {"ids": ["c-2", "c-1"]},
    ("PATCH", "/charter-items/{itemId}"): {"text": "A measurable outcome"},
    ("POST", "/projects/{projectId}/milestones"): {"horizon": "now"},
    ("PUT", "/projects/{projectId}/milestones/order"): {"ids": ["m-2", "m-1"]},
    ("PATCH", "/milestones/{milestoneId}"): {"dueDate": "2026-10-16", "done": True},
    ("POST", "/milestones/{milestoneId}/tasks"): {"text": "Map the last four funds", "hours": 1.5},
    ("PUT", "/milestones/{milestoneId}/tasks/order"): {"ids": ["t-2", "t-1"]},
    ("PATCH", "/tasks/{taskId}"): {"done": True, "dueDate": None},
    ("POST", "/projects/{projectId}/readiness-items"): {
        "text": "Market data entitlements",
        "dueDate": "2026-10-30",
    },
    ("PUT", "/projects/{projectId}/readiness-items/order"): {"ids": []},
    ("PATCH", "/readiness-items/{itemId}"): {"done": True},
    ("POST", "/routines"): {},
    ("PATCH", "/routines/{routineId}"): {
        "name": "Fund & security-level returns",
        "kind": "monthly",
        "bd": 3,
        "hours": 6,
        "stage": 1,
        "projectId": "p-ret",
    },
    ("PUT", "/routines/{routineId}/runs/{iso}"): {"completed": True},
    ("PUT", "/routines/{routineId}/runs/{iso}/items"): {"done": True},
    ("PUT", "/routines/{routineId}/runs/{iso}/items/{itemId}"): {"done": False},
    ("POST", "/routines/{routineId}/checklist-items"): {"label": "Senior Direct Lending I"},
    ("PUT", "/routines/{routineId}/checklist-items/order"): {"ids": ["i-2", "i-1"]},
    ("PATCH", "/routine-checklist-items/{itemId}"): {"label": "Unitranche Partners"},
    ("PATCH", "/rotation"): {"hoursPerDay": 4, "startDate": None},
    ("PUT", "/rotation/segments"): {"segments": SEGMENTS},
    ("POST", "/checkins/parse"): {"text": "+6h returns", "parseId": PARSE_ID},
    ("POST", "/checkins/parse-simple"): {
        "text": "Returns BAU is done for today.",
        "focusProjectId": "p-ret",
        "parseId": PARSE_ID,
    },
    ("POST", "/checkins/preview"): {"changes": ALL_CHANGES},
    ("POST", "/checkins/apply"): {
        "changes": ALL_CHANGES,
        "rawText": "Finished the FX share classes.",
        "focusProjectId": None,
        "source": "simple",
        "parseId": PARSE_ID,
    },
    ("POST", "/notes"): {"day": "2026-10-05", "text": "5 of 12 funds done."},
    ("POST", "/notes/tags"): {"text": "Chased the entitlement forms"},
    ("PATCH", "/notes/{noteId}"): {"text": "6 of 12 funds done."},
    ("POST", "/textbook/sections"): {"label": "Rates", "accent": "oklch(0.5 0.1 200)"},
    ("PUT", "/textbook/sections/order"): {"ids": ["s-pc", "s-fi"]},
    ("PATCH", "/textbook/sections/{sectionId}"): {"collapsed": True},
    ("POST", "/textbook/pages"): {"sectionId": "s-fi", "title": "Rates primer"},
    ("PATCH", "/textbook/pages/{pageId}"): {"title": "Rates primer"},
    ("PUT", "/textbook/pages/{pageId}/blocks"): {"blocks": ALL_BLOCKS, "baseVersion": 3},
    ("POST", "/aliases"): {"entityType": "project", "entityId": "p-ret", "alias": "pipeline"},
    ("POST", "/dev/fixtures"): {"fixture": "design"},
}

CHART_FILE = ("price-yield.html", b"<!doctype html><title>Chart</title>", "text/html")


def concrete_path(path: str) -> str:
    """``/projects/{projectId}`` -> ``/api/projects/p-ret``."""
    for name, value in PATH_VALUES.items():
        path = path.replace("{" + name + "}", value)
    assert "{" not in path, path
    return "/api" + path
