"""Wire conventions of the DTOs: camelCase, ISO dates, keyword aliases, unions, validators."""

import datetime as dt
from dataclasses import dataclass
from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from remi.schemas.base import CamelModel
from remi.schemas.calendar import CalendarOut, DayLoadOut
from remi.schemas.checkin import Change, PreviewRequest, ProjectPreviewOut
from remi.schemas.errors import ERROR_CODES, ErrorBody, ErrorOut
from remi.schemas.mutation import Movement
from remi.schemas.project import ReplanIn
from remi.schemas.rotation import RotationSegmentIn, RotationSegmentOut
from remi.schemas.settings import SettingsPatch
from remi.schemas.setup import SetupIn
from remi.schemas.textbook import Block, BlocksPut
from tests.api.routes_table import ALL_BLOCKS, ALL_CHANGES


class _Sample(CamelModel):
    work_left_display: float | None
    last_checkin_date: dt.date | None
    updated_at: dt.datetime


def test_camel_case_out_and_either_case_in() -> None:
    now = dt.datetime(2026, 10, 5, 8, 0, tzinfo=dt.UTC)
    by_name = _Sample(
        work_left_display=144.0, last_checkin_date=dt.date(2026, 9, 26), updated_at=now
    )
    assert by_name.model_dump(mode="json") == {
        "workLeftDisplay": 144.0,
        "lastCheckinDate": "2026-09-26",
        "updatedAt": "2026-10-05T08:00:00Z",
    }
    by_alias = _Sample.model_validate(
        {"workLeftDisplay": 1, "lastCheckinDate": None, "updatedAt": now.isoformat()}
    )
    assert by_alias.work_left_display == 1


def test_from_attributes_reads_orm_like_objects() -> None:
    @dataclass
    class Row:
        work_left_display: float | None
        last_checkin_date: dt.date | None
        updated_at: dt.datetime

    row = Row(None, None, dt.datetime(2026, 10, 5, tzinfo=dt.UTC))
    assert _Sample.model_validate(row).work_left_display is None


def test_keyword_fields_use_plain_aliases() -> None:
    out = CalendarOut(from_=dt.date(2026, 9, 28), to=dt.date(2026, 10, 2), region="GB-ENG", days=[])
    assert out.model_dump(mode="json")["from"] == "2026-09-28"
    assert CalendarOut.model_validate(out.model_dump(mode="json")).from_ == dt.date(2026, 9, 28)

    preview = ProjectPreviewOut.model_validate(
        {
            "projectId": "p",
            "from": "2026-12-02",
            "to": "2026-12-07",
            "deltaBd": 3,
            "late": True,
            "label": "+3 BD",
            "targetAfter": "2026-11-27",
            "newOver": ["2026-12-04"],
            "missesKeyRun": True,
        }
    )
    assert preview.model_dump(mode="json")["from"] == "2026-12-02"

    segment = RotationSegmentIn.model_validate(
        {"country": "Germany", "code": "DE", "lengthBd": 6, "pass": "Build"}
    )
    assert segment.pass_ == "Build"  # noqa: S105 - "pass" is the rotation pass, not a secret
    out_segment = RotationSegmentOut(
        id="s",
        order=0,
        country="Germany",
        code="DE",
        length_bd=6,
        pass_="Build",  # noqa: S106
        loop=1,
        start=dt.date(2027, 1, 4),
        end=dt.date(2027, 1, 11),
    )
    assert out_segment.model_dump(mode="json")["pass"] == "Build"  # noqa: S105


def test_load_maps_are_keyed_by_iso_date() -> None:
    load = DayLoadOut(items=[], bau=6, proj=2, total=8, free=0, capacity=8, over=False)
    adapter = TypeAdapter(dict[dt.date, DayLoadOut])
    dumped = adapter.dump_python({dt.date(2026, 10, 5): load}, mode="json")
    assert list(dumped) == ["2026-10-05"]


def test_every_change_type_parses_through_the_union() -> None:
    adapter: TypeAdapter[list[Change]] = TypeAdapter(list[Change])
    changes = adapter.validate_python(ALL_CHANGES)
    assert [c.type for c in changes] == [c["type"] for c in ALL_CHANGES]
    assert adapter.dump_python(changes, mode="json") == ALL_CHANGES


@pytest.mark.parametrize(
    "bad",
    [
        {"type": "task_add", "projectId": "p", "text": "x", "hours": 0.1},
        {"type": "task_add", "projectId": "p", "text": "x" * 121, "hours": 1},
        {"type": "confidence", "projectId": "p", "value": 6},
        {"type": "hours_per_day", "projectId": "p", "value": 0},
        {"type": "note", "projectId": "p", "text": ""},
        {"type": "launch_rocket", "projectId": "p"},
        {"type": "bau_done"},
        {"type": "blocker", "project_id": "p", "text": "x", "extra": 1},
    ],
)
def test_invalid_changes_are_rejected(bad: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        PreviewRequest.model_validate({"changes": [bad]})


def test_every_block_type_round_trips() -> None:
    adapter: TypeAdapter[list[Block]] = TypeAdapter(list[Block])
    blocks = adapter.validate_python(ALL_BLOCKS)
    assert adapter.dump_python(blocks, mode="json") == ALL_BLOCKS
    assert len({b.type for b in blocks}) == 10


@pytest.mark.parametrize("height", [199, 901])
def test_chart_height_is_clamped_by_validation(height: int) -> None:
    chart = {**ALL_BLOCKS[8], "height": height}
    with pytest.raises(ValidationError):
        BlocksPut.model_validate({"blocks": [chart], "baseVersion": 1})


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"rate": 4, "workLeft": 10},
        {"rate": 4, "startDate": "2026-10-06"},
        {"rate": 25},
        {"workLeft": 1000},
    ],
)
def test_replan_rejects_anything_but_one_valid_input(body: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        ReplanIn.model_validate(body)


@pytest.mark.parametrize(
    "body", [{"rate": 0}, {"workLeft": 0}, {"startDate": "2026-10-10"}, {"rate": 3.8}]
)
def test_replan_accepts_exactly_one_input(body: dict[str, Any]) -> None:
    ReplanIn.model_validate(body)


def test_settings_patch_distinguishes_absent_from_null() -> None:
    patch = SettingsPatch.model_validate({"keyProjectId": None})
    assert patch.model_fields_set == {"key_project_id"}
    assert SettingsPatch.model_validate({}).model_fields_set == set()


@pytest.mark.parametrize(
    "body",
    [
        {"timezone": "Mars/Olympus_Mons"},
        {"capacityHoursPerDay": 0.5},
        {"capacityHoursPerDay": 25},
        {"holidayRegion": "US"},
        {"accentPc": "red"},
        {"aiProvider": "openai"},
        {"motionPreference": "fast"},
    ],
)
def test_settings_patch_validation(body: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        SettingsPatch.model_validate(body)


def test_setup_defaults() -> None:
    setup = SetupIn.model_validate(
        {"moveDate": "2027-01-04", "timezone": "Europe/London", "holidayRegion": "GB-ENG"}
    )
    assert setup.capacity_hours_per_day == 8
    assert setup.ai_provider == "none"
    assert setup.rotation is None


def test_movement_serialises_every_key() -> None:
    movement = Movement(
        project_id="p",
        from_forecast=dt.date(2026, 12, 2),
        to_forecast=dt.date(2026, 12, 7),
        delta_bd=3,
        from_target=None,
        to_target=None,
        cause="scope",
        label="+3 BD",
        flash=True,
        moved=True,
    )
    assert movement.model_dump(mode="json") == {
        "projectId": "p",
        "fromForecast": "2026-12-02",
        "toForecast": "2026-12-07",
        "deltaBd": 3,
        "fromTarget": None,
        "toTarget": None,
        "cause": "scope",
        "label": "+3 BD",
        "flash": True,
        "moved": True,
    }


def test_error_envelope_always_has_field() -> None:
    body = ErrorOut(error=ErrorBody(code="NOT_FOUND", message="No such project."))
    assert body.model_dump(mode="json") == {
        "error": {"code": "NOT_FOUND", "message": "No such project.", "field": None}
    }
    assert "NOT_IMPLEMENTED" in ERROR_CODES
    assert all(code.isupper() for code in ERROR_CODES)


# ---------------------------------------------------------------- response enums cover the ORM
def _response_enums() -> list[tuple[str, tuple[object, ...], tuple[object, ...]]]:
    from typing import get_args

    from remi.repositories.models import base as m_base
    from remi.repositories.models import calendar as m_calendar
    from remi.repositories.models import events as m_events
    from remi.repositories.models import project as m_project
    from remi.repositories.models import rotation as m_rotation
    from remi.repositories.models import routine as m_routine
    from remi.repositories.models import settings as m_settings
    from remi.repositories.models import textbook as m_textbook
    from remi.schemas import base as s_base
    from remi.schemas import calendar as s_calendar
    from remi.schemas import events as s_events
    from remi.schemas import project as s_project
    from remi.schemas import rotation as s_rotation
    from remi.schemas import routine as s_routine
    from remi.schemas import settings as s_settings
    from remi.schemas import textbook as s_textbook

    return [
        ("Domain", m_base.DOMAINS, get_args(s_base.Domain)),
        ("HolidayRegion", m_base.HOLIDAY_REGIONS, get_args(s_settings.HolidayRegion)),
        ("HolidaySource", m_calendar.HOLIDAY_SOURCES, get_args(s_calendar.HolidaySource)),
        ("EventActor", m_events.ACTORS, get_args(s_events.EventActor)),
        ("CharterList", m_project.CHARTER_LISTS, get_args(s_project.CharterList)),
        ("MilestoneHorizon", m_project.MILESTONE_HORIZONS, get_args(s_project.MilestoneHorizon)),
        ("CheckInSource", m_project.CHECKIN_SOURCES, get_args(s_project.CheckInSource)),
        ("RotationPass", m_rotation.ROTATION_PASSES, get_args(s_rotation.RotationPass)),
        ("RoutineKind", m_routine.ROUTINE_KINDS, get_args(s_routine.RoutineKind)),
        ("MoveTaper", m_settings.MOVE_TAPERS, get_args(s_settings.MoveTaper)),
        (
            "MotionPreference",
            m_settings.MOTION_PREFERENCES,
            get_args(s_settings.MotionPreference),
        ),
        ("AiProvider", m_settings.AI_PROVIDERS, get_args(s_settings.AiProvider)),
        ("BlockType", m_textbook.BLOCK_TYPES, get_args(s_textbook.BlockType)),
    ]


@pytest.mark.parametrize(("name", "stored", "served"), _response_enums())
def test_response_enums_accept_every_stored_value(
    name: str, stored: tuple[object, ...], served: tuple[object, ...]
) -> None:
    """A stored value the response Literal lacks would make serialising the row a 500."""
    missing = set(stored) - set(served)
    assert not missing, f"{name} response enum lacks stored values {sorted(map(str, missing))}"


def test_snapshot_and_event_rows_with_the_wider_values_serialise() -> None:
    from remi.schemas.events import RemiEventOut
    from remi.schemas.project import ProjectSnapshotOut

    snapshot = ProjectSnapshotOut.model_validate(
        {
            "checkinId": "c-1",
            "date": "2026-10-05",
            "forecastDate": None,
            "targetDate": None,
            "confidence": None,
            "note": "",
            "source": "form",
            "milestones": [],
        }
    )
    assert snapshot.model_dump(mode="json")["source"] == "form"
    event = RemiEventOut.model_validate(
        {
            "seq": 1,
            "id": "e-1",
            "at": "2026-10-05T08:00:00+00:00",
            "businessDate": "2026-10-05",
            "type": "project.created",
            "actor": "import",
            "refs": [],
            "payload": {},
            "schemaVersion": 1,
        }
    )
    assert event.model_dump(mode="json")["actor"] == "import"
