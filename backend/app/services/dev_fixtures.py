"""Dev and test fixtures: reset the database to a named fixture (``POST /dev/fixtures``).

Refused unless ``REMI_ENV`` is ``dev`` or ``test`` (the route is not even mounted otherwise).
Remi starts empty (ADR-0006); the design's sample data exists only here, loaded from the
parity harness's ``parity/golden/prototype_seed.json`` (the prototype's ``BASE_*`` constants).

``design`` resets every state table and then, in the same unit of work (one
``dev.fixture_loaded`` event), runs first-run setup (Europe/London, England and Wales holidays,
move Mon 4 Jan 2027, 8h days, the prototype's rotation at 4h a day) and loads the sample plan.
The prototype's string ids are kept (``ret``, ``manco``, ``play``, ``fion``, ``alpha``,
``r-ret``, ``r-man``, ``man-0`` ...) so deep links and parity drivers match. The prototype's
``bd3``/``bd8`` hooks become ``project_bau_day_hours`` rows (ADR-0007).

``empty`` resets to a fresh database that still needs setup.
"""

import datetime as dt
import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any, Final, cast
from zoneinfo import ZoneInfo

from sqlalchemy import delete

from app.core.clock import Clock
from app.core.config import RemiConfig
from app.core.errors import DomainError, NotFound
from app.core.paths import repo_root
from app.core.uow import UnitOfWork, UnitOfWorkFactory, ref
from app.repositories import models as orm
from app.repositories.registry import ROTATION, SETTINGS
from app.schemas.dev import FixtureName
from app.schemas.mutation import MutationOut
from app.schemas.rotation import RotationSegmentIn, RotationSetupIn
from app.schemas.setup import SetupIn
from app.services import chart_store
from app.services.mutations import MutationScope, run_mutation
from app.services.settings import timezone_changed
from app.services.setup import apply_setup

FIXTURE_ENVS: Final = frozenset({"dev", "test"})
SEED_RELPATH: Final = Path("parity") / "golden" / "prototype_seed.json"
LONDON: Final = ZoneInfo("Europe/London")

DESIGN_MOVE: Final = dt.date(2027, 1, 4)
DESIGN_CAPACITY: Final = 8.0
DESIGN_ROTATION_HOURS: Final = 4.0
DESIGN_ROTATION_TITLE: Final = "Eurozone sovereign rotation"
DESIGN_KEY_PROJECT: Final = "ret"
DESIGN_KEY_ROUTINE: Final = "r-ret"
CHART_ASSET_ID: Final = "chart-price-yield"

BAU_DAY_ROUTINES: Final = {"bd3": "r-ret", "bd8": "r-man"}
"""The prototype's per-project ``bd3``/``bd8`` hours map to these routines' BAU-day hours."""

TRANSITION_NOTES: Final[Mapping[str, str]] = {
    "r-ret": "Successor shadows the Thu 3 Dec run on the automated pipeline",
    "r-man": "Successor builds the Thu 10 Dec pack; commentary stays manual",
}
"""The prototype hard-codes these Transition notes per routine; here they are data."""

AFTER_DAY_ONE_NOTES: Final[Mapping[str, str]] = {
    "alpha": "In Define, charter half-written. Planning starts once the rotation is under way.",
}
"""The Transition screen's "After day one" notes, hard-coded per project in the prototype
(``Transition.dc.html``); here they are data (``ProjectOut.afterDayOneNote``)."""

CO_TAG_ROUTINES: Final = frozenset({"r-ret"})
"""Routines tagged in notes even when their project is tagged too."""

ROUTINE_LABELS: Final[Mapping[str, str]] = {"r-ret": "Fund & security returns"}
"""The Timeline's curated row labels (``Timeline.dc.html:309`` shortens r-ret's name)."""

_STATE_TABLES: Final[tuple[type[orm.Base], ...]] = (
    orm.TextbookBlock,
    orm.TextbookPage,
    orm.TextbookSection,
    orm.ChartAsset,
    orm.Note,
    orm.EntityAlias,
    orm.FeedEvent,
    orm.RoutineRunTick,
    orm.RoutineRun,
    orm.RoutineChecklistItem,
    orm.ProjectBauDayHours,
    orm.HourOverride,
    orm.ScopeChange,
    orm.Task,
    orm.Milestone,
    orm.CharterItem,
    orm.CheckIn,
    orm.ReadinessItem,
    orm.ChecklistItem,
    orm.Checklist,
    orm.Risk,
    orm.Routine,
    orm.Project,
    orm.RotationSegment,
    orm.Rotation,
    orm.Holiday,
    orm.HolidayYear,
    orm.LeaveDay,
)
"""Every state table, children first. ``remi_events`` (append-only) and ``ai_audit`` stay."""

_GOOGLE_FONTS = re.compile(r"[ \t]*<link[^>]+fonts\.googleapis\.com[^>]*>\r?\n?", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class SeedIds:
    """What the design fixture created."""

    projects: tuple[str, ...]
    routines: tuple[str, ...]
    rotation_id: str
    chart_asset_id: str
    event_seq: int | None = None


# ---------------------------------------------------------------------------- guards and data
def require_fixture_env(config: RemiConfig) -> None:
    """Fixtures exist only in dev and test (404 otherwise, as if the route were absent)."""
    if config.env not in FIXTURE_ENVS:
        raise NotFound("Not found.")


def seed_path() -> Path:
    return repo_root() / SEED_RELPATH


@cache
def _load_seed(path: str) -> Mapping[str, Any]:
    with Path(path).open(encoding="utf-8") as handle:
        return cast(dict[str, Any], json.load(handle))


def load_seed(path: Path | None = None) -> Mapping[str, Any]:
    """The prototype's sample data (``prototype_seed.json``)."""
    target = path if path is not None else seed_path()
    if not target.is_file():
        raise DomainError(
            "FIXTURE_MISSING",
            "The design fixture needs parity/golden/prototype_seed.json (a source checkout).",
            status=409,
        )
    return _load_seed(str(target))


def _d(value: Any) -> dt.date | None:
    return dt.date.fromisoformat(value) if isinstance(value, str) and value else None


def _req_d(value: Any) -> dt.date:
    day = _d(value)
    if day is None:
        msg = f"expected an ISO date, got {value!r}"
        raise ValueError(msg)
    return day


def _london(day: dt.date, hhmm: str = "09:00") -> dt.datetime:
    hour, minute = (int(x) for x in hhmm.split(":"))
    return dt.datetime.combine(day, dt.time(hour, minute), tzinfo=LONDON).astimezone(dt.UTC)


_MONTHS: Final = (
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
)


def _day_month(text: str | None, near: dt.date) -> dt.date | None:
    """``"27 Nov"`` or ``"Sat 3 Oct"`` as the nearest such date to ``near``."""
    if not text:
        return None
    match = re.search(r"(\d{1,2})\s+([A-Za-z]{3})", text)
    if match is None:
        return None
    day, month = int(match.group(1)), _MONTHS.index(match.group(2).lower()) + 1
    candidates = [dt.date(near.year + k, month, day) for k in (-1, 0, 1)]
    return min(candidates, key=lambda c: abs((c - near).days))


def _list(value: Any) -> list[Any]:
    return cast(list[Any], value) if isinstance(value, list) else []


def _dict(value: Any) -> dict[str, Any]:
    return cast(dict[str, Any], value) if isinstance(value, dict) else {}


# ---------------------------------------------------------------------------- reset
def reset_state(uow: UnitOfWork) -> None:
    """Delete every state row and put the settings back to their defaults (setup needed)."""
    session = uow.session
    for model in _STATE_TABLES:
        session.execute(delete(model))
    session.expire_all()
    uow.repo(SETTINGS).reset()


# ---------------------------------------------------------------------------- chart file
def sample_chart_html(seed: Mapping[str, Any]) -> str:
    """The sample chart without its Google Fonts link (the chart CSP blocks it; system fonts
    are used instead)."""
    html = str(_dict(_dict(seed.get("textbook")).get("sampleChart")).get("html") or "")
    return _GOOGLE_FONTS.sub("", html)


def write_chart_file(uow: UnitOfWork, data_dir: Path, html: str) -> tuple[str, str, int]:
    """Store ``html`` in the chart store (``<data>/charts/<h[:2]>/<h>.html``).

    Returns ``(sha256, storage_relpath, size)``. A file this call created is removed again if
    the unit of work rolls back.
    """
    stored = chart_store.store_file(uow, data_dir, html.encode("utf-8"))
    return stored.content_hash, stored.storage_relpath, stored.size_bytes


# ---------------------------------------------------------------------------- the design seed
def design_setup(seed: Mapping[str, Any]) -> SetupIn:
    """First-run setup as the prototype's constants imply."""
    segments = [
        RotationSegmentIn(
            id=f"rot-{i}",
            country=str(s["country"]),
            code=str(s["code"]),
            length_bd=int(s["len"]),
            pass_=s["pass"],
        )
        for i, s in enumerate(_list(seed.get("rotation")))
    ]
    return SetupIn(
        move_date=_d(seed.get("move")) or DESIGN_MOVE,
        timezone="Europe/London",
        holiday_region="GB-ENG",
        capacity_hours_per_day=float(seed.get("capacity") or DESIGN_CAPACITY),
        rotation=RotationSetupIn(hours_per_day=DESIGN_ROTATION_HOURS, segments=segments),
        ai_provider="none",
    )


def _add_projects(uow: UnitOfWork, seed: Mapping[str, Any]) -> list[str]:
    session = uow.session
    done_tasks = _dict(seed.get("tasks"))
    done_on = _dict(seed.get("doneOn"))
    order: dict[str, int] = {"pc": 0, "fi": 0}
    ids: list[str] = []
    raw_projects = [_dict(p) for p in _list(seed.get("projects"))]
    for raw in raw_projects:
        pid = str(raw["id"])
        domain = cast(orm.Domain, raw["domain"])
        charter = _dict(raw.get("charter"))
        exit_routes = raw.get("exit")
        session.add(
            orm.Project(
                id=pid,
                domain=domain,
                name=str(raw.get("name") or ""),
                short=str(raw.get("short") or ""),
                goal=str(raw.get("goal") or ""),
                why_now=str(charter.get("why") or ""),
                later_intent=str(raw.get("later") or ""),
                end_name=str(raw.get("endName") or "Done"),
                start_date=_req_d(raw.get("start")),
                target_date=_req_d(raw.get("target")),
                target_label=raw.get("targetLabel"),
                forecast_date=_d(raw.get("forecast")),
                prev_forecast_date=_d(raw.get("prev")),
                rate_hours_per_day=float(raw.get("rate") or 0),
                rate_after_move=float(raw.get("rateAfter") or 0),
                baseline_hours=float(raw.get("baseline") or 0),
                unplaced_hours=0.0,
                confidence=raw.get("confidence"),
                last_checkin_date=_d(raw.get("checkin")),
                blocker=None,
                readiness=raw.get("readiness"),
                after_day_one_note=AFTER_DAY_ONE_NOTES.get(pid),
                phase=int(raw.get("phase") or 0),
                exit_routes=list(_list(exit_routes)) if exit_routes is not None else None,
                sort_order=order[domain],
            )
        )
        order[domain] += 1
        ids.append(pid)
    session.flush()

    for raw in raw_projects:
        pid = str(raw["id"])
        charter = _dict(raw.get("charter"))
        for list_name in ("success", "inScope", "outScope", "constraints"):
            for i, text in enumerate(_list(charter.get(list_name))):
                session.add(
                    orm.CharterItem(
                        id=f"{pid}-{list_name}-{i}",
                        project_id=pid,
                        list_name=list_name,
                        text=str(text),
                        sort_order=i,
                    )
                )
        for i, item in enumerate(_dict(x) for x in _list(raw.get("now"))):
            milestone = orm.Milestone(
                id=f"{pid}-now-{i}",
                project_id=pid,
                horizon="now",
                name=str(item.get("m") or ""),
                due_date=_d(item.get("due")),
                sort_order=i,
            )
            session.add(milestone)
            for j, task in enumerate(_dict(t) for t in _list(item.get("tasks"))):
                tid = str(task["id"])
                is_done = bool(done_tasks.get(tid))
                session.add(
                    orm.Task(
                        id=tid,
                        project_id=pid,
                        milestone=milestone,
                        text=str(task.get("t") or ""),
                        hours=float(task.get("h") or 0),
                        due_date=_d(task.get("due")),
                        sort_order=j,
                        done=is_done,
                        done_on=_d(done_on.get(tid)) if is_done else None,
                    )
                )
        for i, item in enumerate(_dict(x) for x in _list(raw.get("next"))):
            session.add(
                orm.Milestone(
                    id=f"{pid}-next-{i}",
                    project_id=pid,
                    horizon="next",
                    name=str(item.get("m") or ""),
                    due_date=_d(item.get("due")),
                    sort_order=i,
                )
            )
        for i, item in enumerate(_dict(x) for x in _list(raw.get("milestones"))):
            session.add(
                orm.Milestone(
                    id=f"{pid}-ms-{i}",
                    project_id=pid,
                    horizon="explicit",
                    name=str(item.get("name") or ""),
                    due_date=_d(item.get("date")),
                    sort_order=i,
                )
            )
        for day, hours in _dict(raw.get("ov")).items():
            session.add(orm.HourOverride(project_id=pid, date=_req_d(day), hours=float(hours)))
        checkin_ids: dict[dt.date, str] = {}
        for i, item in enumerate(_dict(x) for x in _list(raw.get("checkins"))):
            day = _req_d(item.get("date"))
            cid = f"{pid}-ci-{i}"
            checkin_ids[day] = cid
            session.add(
                orm.CheckIn(
                    id=cid,
                    project_id=pid,
                    date=day,
                    note=str(item.get("note") or ""),
                    forecast_date=_d(item.get("forecast")),
                    target_date=None,
                    confidence=item.get("conf"),
                    source="form",
                    snapshot={
                        "target": None,
                        "forecast": item.get("forecast"),
                        "milestones": [
                            {"milestoneId": None, "name": m.get("name"), "date": m.get("date")}
                            for m in (_dict(x) for x in _list(item.get("ms")))
                        ],
                    },
                    created_at=_london(day),
                )
            )
        session.flush()
        for i, item in enumerate(_dict(x) for x in _list(raw.get("scope"))):
            day = _req_d(item.get("date"))
            session.add(
                orm.ScopeChange(
                    id=f"{pid}-scope-{i}",
                    project_id=pid,
                    checkin_id=checkin_ids.get(day),
                    date=day,
                    what=str(item.get("what") or ""),
                    hours=float(item.get("h") or 0),
                    slip_bd=int(item.get("bd") or 0),
                    from_forecast=_day_month(item.get("from"), day),
                    to_forecast=_day_month(item.get("to"), day),
                    created_at=_london(day),
                )
            )
        for i, item in enumerate(_dict(x) for x in _list(raw.get("readinessList"))):
            session.add(
                orm.ReadinessItem(
                    id=f"{pid}-rd-{i}",
                    project_id=pid,
                    text=str(item.get("t") or ""),
                    done=bool(item.get("done")),
                    due_date=_d(item.get("due")),
                    done_on=None,
                    sort_order=i,
                )
            )
        for i, item in enumerate(_dict(x) for x in _list(raw.get("risks"))):
            session.add(
                orm.Risk(
                    id=f"{pid}-risk-{i}",
                    project_id=pid,
                    risk=str(item.get("r") or ""),
                    mitigation=str(item.get("m") or ""),
                    sort_order=i,
                )
            )
        for i, item in enumerate(_dict(x) for x in _list(raw.get("checklists"))):
            checklist = orm.Checklist(
                id=str(item.get("id") or f"{pid}-cl-{i}"),
                project_id=pid,
                title=str(item.get("title") or ""),
                sort_order=i,
            )
            session.add(checklist)
            for j, entry in enumerate(_dict(x) for x in _list(item.get("items"))):
                checklist.items.append(
                    orm.ChecklistItem(
                        id=str(entry.get("id") or f"{checklist.id}-{j}"),
                        text=str(entry.get("t") or ""),
                        done=bool(entry.get("done")),
                        sort_order=j,
                    )
                )
    session.flush()
    return ids


def _add_routines(uow: UnitOfWork, seed: Mapping[str, Any]) -> list[str]:
    session = uow.session
    ids: list[str] = []
    for i, raw in enumerate(_dict(r) for r in _list(seed.get("routines"))):
        rid = str(raw["id"])
        session.add(
            orm.Routine(
                id=rid,
                domain=cast(orm.Domain, raw.get("domain") or "pc"),
                name=str(raw.get("name") or ""),
                short=str(raw.get("short") or ""),
                label=ROUTINE_LABELS.get(rid),
                detail=str(raw.get("detail") or ""),
                kind=cast(orm.RoutineKind, raw.get("kind") or "monthly"),
                bd=int(raw.get("bd") or 1),
                weekday=int(raw.get("wd") or 2),
                hours=float(raw.get("h") or 0),
                stage=int(raw.get("stage") or 0),
                status_note=str(raw.get("statusNote") or ""),
                transition_note=TRANSITION_NOTES.get(rid),
                project_id=raw.get("pid"),
                co_tag_with_project=rid in CO_TAG_ROUTINES,
                sort_order=i,
            )
        )
        ids.append(rid)
    session.flush()
    for j, fund in enumerate(_list(seed.get("funds"))):
        session.add(
            orm.RoutineChecklistItem(
                id=f"r-ret-fund-{j + 1:02d}", routine_id="r-ret", label=str(fund), sort_order=j
            )
        )
    session.flush()
    return ids


def _add_bau_day_hours(uow: UnitOfWork, seed: Mapping[str, Any]) -> None:
    for raw in (_dict(p) for p in _list(seed.get("projects"))):
        for key, routine_id in BAU_DAY_ROUTINES.items():
            if key in raw:
                uow.session.add(
                    orm.ProjectBauDayHours(
                        project_id=str(raw["id"]), routine_id=routine_id, hours=float(raw[key])
                    )
                )


def merged_aliases(seed: Mapping[str, Any]) -> dict[str, list[str]]:
    """The prototype's two alias tables (Notes and the simple reading), merged per entity."""
    tables = _dict(seed.get("aliases"))
    merged: dict[str, list[str]] = {}
    for table in ("notesProjects", "simpleReaderProjects", "notesRoutines"):
        for owner, words in _dict(tables.get(table)).items():
            bucket = merged.setdefault(owner, [])
            for word in _list(words):
                alias = " ".join(str(word).lower().split())
                if alias and alias not in bucket:
                    bucket.append(alias)
    return merged


def _add_aliases(uow: UnitOfWork, seed: Mapping[str, Any], routines: Sequence[str]) -> None:
    for owner, words in merged_aliases(seed).items():
        is_routine = owner in routines
        for i, alias in enumerate(words):
            uow.session.add(
                orm.EntityAlias(
                    id=f"al-{owner}-{i}",
                    project_id=None if is_routine else owner,
                    routine_id=owner if is_routine else None,
                    alias=alias,
                )
            )


def _add_notes(uow: UnitOfWork, seed: Mapping[str, Any]) -> None:
    for day_iso, notes in _dict(seed.get("notes")).items():
        day = _req_d(day_iso)
        for seq, note in enumerate(_dict(n) for n in _list(notes)):
            at = _london(day, str(note.get("t") or "09:00"))
            uow.session.add(
                orm.Note(
                    id=str(note.get("id") or f"n-{day_iso}-{seq}"),
                    day=day,
                    text=str(note.get("text") or ""),
                    seq=seq,
                    created_at=at,
                    updated_at=at,
                )
            )


def _add_feed(uow: UnitOfWork, seed: Mapping[str, Any], today: dt.date) -> None:
    for i, item in enumerate(_dict(f) for f in _list(seed.get("feed"))):
        day = _d(item.get("day")) or _day_month(item.get("when"), today)
        uow.session.add(
            orm.FeedEvent(
                id=str(item.get("id") or f"feed-{i}"),
                project_id=item.get("pid"),
                routine_id=None,
                day=day,
                kind=str(item.get("kind") or "edit"),
                title=str(item.get("title") or ""),
                body=str(item.get("body") or ""),
                delta=str(item.get("delta") or ""),
                tone=str(item.get("tone") or "quiet"),
                created_at=_london(day or today, "12:00"),
            )
        )


def _add_ticks(uow: UnitOfWork, seed: Mapping[str, Any], today: dt.date) -> None:
    """Today's returns run: the funds the prototype marks done (1-5 of 12)."""
    at = _london(today, "09:55")
    for j, done in enumerate(_list(seed.get("fundsDone"))):
        if done:
            uow.session.add(
                orm.RoutineRunTick(
                    routine_id="r-ret",
                    occurrence_date=today,
                    item_id=f"r-ret-fund-{j + 1:02d}",
                    done_at=at,
                )
            )


def _add_textbook(uow: UnitOfWork, seed: Mapping[str, Any], data_dir: Path) -> str | None:
    session = uow.session
    book = _dict(seed.get("textbook"))
    for i, section in enumerate(_dict(s) for s in _list(book.get("sections"))):
        session.add(
            orm.TextbookSection(
                id=str(section["id"]),
                label=str(section.get("label") or ""),
                accent=str(section.get("accent") or ""),
                sort_order=i,
            )
        )
    session.flush()

    asset_id: str | None = None
    chart = _dict(book.get("sampleChart"))
    if chart.get("html"):
        digest, relpath, size = write_chart_file(uow, data_dir, sample_chart_html(seed))
        session.add(
            orm.ChartAsset(
                id=CHART_ASSET_ID,
                content_hash=digest,
                filename=str(chart.get("name") or "chart.html"),
                size_bytes=size,
                storage_relpath=relpath,
                uploaded_at=_london(_req_d(seed.get("today")), "09:30"),
            )
        )
        session.flush()
        asset_id = CHART_ASSET_ID

    per_section: dict[str, int] = {}
    for page in (_dict(p) for p in _list(book.get("pages"))):
        section_id = str(page["section"])
        order = per_section.get(section_id, 0)
        per_section[section_id] = order + 1
        updated = str(page.get("updated") or "")
        stamp = (
            dt.datetime.fromisoformat(updated.replace("Z", "+00:00"))
            if updated
            else _london(_req_d(seed.get("today")))
        )
        session.add(
            orm.TextbookPage(
                id=str(page["id"]),
                section_id=section_id,
                parent_id=page.get("parent"),
                title=str(page.get("title") or ""),
                sort_order=order,
                version=1,
                created_at=stamp,
                updated_at=stamp,
            )
        )
        session.flush()
        for k, block in enumerate(_dict(b) for b in _list(page.get("blocks"))):
            kind = cast(orm.BlockType, block.get("type") or "p")
            session.add(
                orm.TextbookBlock(
                    id=str(block["id"]),
                    page_id=str(page["id"]),
                    sort_order=k,
                    type=kind,
                    # A chart block's ``text`` holds its file name (``ChartBlock.name``).
                    text=str(block.get("name") if kind == "chart" else block.get("text") or ""),
                    target_page_id=block.get("target") if kind == "page" else None,
                    chart_asset_id=asset_id if kind == "chart" and block.get("src") else None,
                    height=int(block.get("h") or orm.DEFAULT_CHART_HEIGHT),
                    caption=str(block.get("cap") or ""),
                )
            )
    first_page = book.get("cur")
    return str(first_page) if isinstance(first_page, str) else None


def load_design(uow: UnitOfWork, *, data_dir: Path, today: dt.date) -> SeedIds:
    """Reset the database and load the design seed into ``uow`` (no event: callers record it)."""
    seed = load_seed()
    seed_today = _d(seed.get("today")) or today
    reset_state(uow)
    last_page = _add_textbook(uow, seed, data_dir)
    apply_setup(uow, design_setup(seed), today=today, rotation_title=DESIGN_ROTATION_TITLE)
    projects = _add_projects(uow, seed)
    routines = _add_routines(uow, seed)
    _add_bau_day_hours(uow, seed)
    _add_aliases(uow, seed, routines)
    _add_notes(uow, seed)
    _add_feed(uow, seed, seed_today)
    _add_ticks(uow, seed, seed_today)
    uow.session.flush()
    settings = uow.repo(SETTINGS).get()
    settings.key_project_id = DESIGN_KEY_PROJECT
    settings.key_routine_id = DESIGN_KEY_ROUTINE
    if last_page is not None:
        settings.ui_prefs = {"last_textbook_page_id": last_page}
    active = uow.repo(ROTATION).get_active()
    return SeedIds(
        projects=tuple(projects),
        routines=tuple(routines),
        rotation_id=active.id if active is not None else "",
        chart_asset_id=CHART_ASSET_ID,
    )


# ---------------------------------------------------------------------------- entry points
def load_fixture(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    config: RemiConfig,
    fixture: FixtureName,
) -> MutationOut | None:
    """``POST /dev/fixtures``: reset to ``fixture`` in one unit of work (one event).

    Returns the new plan for ``design``; ``None`` for ``empty`` (no plan exists before setup).
    The reset deletes every ``chart_assets`` row, so once it commits a chart garbage-collection
    sweep removes the chart files no row names any more (the design's own chart is kept).
    """
    require_fixture_env(config)

    def change(m: MutationScope) -> SeedIds | None:
        loaded: SeedIds | None = None
        if fixture == "design":
            loaded = load_design(m.uow, data_dir=config.data_dir, today=m.today)
        else:
            reset_state(m.uow)
        m.uow.after_commit(timezone_changed)
        chart_store.schedule_gc(m.uow, uow_factory, config.data_dir)
        m.uow.record("dev.fixture_loaded", [ref("fixture", fixture)], {"fixture": fixture})
        return loaded

    result = run_mutation(
        uow_factory,
        clock,
        change,
        "settings",
        actor="import",
        require_setup=False,
        track_movements=False,
    )
    return result.out() if result.plan is not None else None
