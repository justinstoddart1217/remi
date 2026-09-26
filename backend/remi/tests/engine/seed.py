"""The prototype's seed (``Remi.dc.html``) as engine dataclasses. Test fixture only.

Today is Mon 5 Oct 2026 (BD3) and the move is Mon 4 Jan 2027. Holidays are England's, generated
here with the ``holidays`` package (the engine itself never imports it). The prototype's
``bd3``/``bd8`` hooks become ``project_bau_day_hours``:

    ret {r-ret 0, r-man 2}; manco {r-ret 2, r-man 1.5}; play {r-ret 0, r-man 0.5};
    fion {0, 0}; alpha {0, 0}
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from functools import cache

import holidays

from remi.services.engine.allocation import RunState
from remi.services.engine.calendar import BusinessCalendar
from remi.services.engine.model import (
    EngineCtx,
    Horizon,
    Milestone,
    Project,
    ProjectPlan,
    RotationDef,
    RoutineDef,
    SegmentDef,
    Task,
)

TODAY = date(2026, 10, 5)
MOVE = date(2027, 1, 4)
CAPACITY = 8.0

FUNDS = (
    "Senior Direct Lending I",
    "Senior Direct Lending II",
    "Unitranche Partners",
    "Mezzanine Opportunities",
    "Asset-Backed Finance",
    "Infrastructure Debt",
    "Real Estate Debt",
    "Trade Finance",
    "Special Situations",
    "Opportunistic Credit",
    "Credit Co-invest",
    "Evergreen Income",
)


def d(s: str) -> date:
    return date.fromisoformat(s)


@cache
def gb_eng_holidays() -> Mapping[date, str]:
    """England and Wales bank holidays, 2026-2029."""
    generated = holidays.country_holidays("GB", subdiv="ENG", years=range(2026, 2030))
    return {day: str(name) for day, name in generated.items()}


@cache
def calendar() -> BusinessCalendar:
    return BusinessCalendar.build(date(2026, 1, 1), date(2029, 12, 31), gb_eng_holidays())


ROUTINES = (
    RoutineDef(
        id="r-ret",
        domain="pc",
        kind="monthly",
        bd=3,
        hours=6,
        stage=1,
        project_id="ret",
        name="Fund & security-level returns",
        short="Returns",
        checklist_size=len(FUNDS),
        co_tag=True,
    ),
    RoutineDef(
        id="r-man",
        domain="pc",
        kind="monthly",
        bd=8,
        hours=4,
        stage=1,
        project_id="manco",
        name="Managing Committee pack",
        short="ManCo pack",
    ),
)

ROTATION = RotationDef(
    segments=(
        SegmentDef("Germany", "DE", 6, "Build"),
        SegmentDef("France", "FR", 5, "Build"),
        SegmentDef("Italy", "IT", 6, "Build"),
        SegmentDef("Spain", "ES", 5, "Build"),
        SegmentDef("Netherlands", "NL", 4, "Build"),
        SegmentDef("Belgium", "BE", 4, "Build"),
        SegmentDef("Austria", "AT", 4, "Build"),
        SegmentDef("Portugal", "PT", 4, "Build"),
        SegmentDef("Ireland", "IE", 4, "Build"),
        SegmentDef("Finland", "FI", 4, "Build"),
        SegmentDef("Germany", "DE", 3, "Refresh"),
    ),
    hours_per_day=4,
)


def ctx(today: date = TODAY) -> EngineCtx:
    """The seed context (key project ``ret``, key routine ``r-ret``)."""
    return EngineCtx(
        today=today,
        move=MOVE,
        capacity=CAPACITY,
        cal=calendar(),
        routines=ROUTINES,
        rotation=ROTATION,
        key_project_id="ret",
        key_routine_id="r-ret",
    )


def _task(
    tid: str, text: str, hours: float, done_on: str | None = None, due: str | None = None
) -> Task:
    return Task(
        id=tid,
        text=text,
        hours=hours,
        done=done_on is not None,
        done_on=d(done_on) if done_on else None,
        due=d(due) if due else None,
    )


def _ms(mid: str, name: str, due: str, horizon: Horizon, tasks: tuple[Task, ...] = ()) -> Milestone:
    return Milestone(id=mid, name=name, due=d(due), horizon=horizon, tasks=tasks)


PLANS = {
    "ret": ProjectPlan(
        id="ret",
        domain="pc",
        start=d("2026-09-14"),
        target=d("2026-11-27"),
        forecast=d("2026-12-02"),
        prev=d("2026-11-27"),
        rate=3.5,
        rate_after=0,
        bau_day_hours={"r-ret": 0, "r-man": 2},
        overrides={d("2026-11-04"): 3.5},
        short="Returns pipeline",
    ),
    "manco": ProjectPlan(
        id="manco",
        domain="pc",
        start=d("2026-09-21"),
        target=d("2026-12-11"),
        forecast=d("2026-12-11"),
        rate=1.5,
        rate_after=0,
        bau_day_hours={"r-ret": 2, "r-man": 1.5},
        overrides={d("2026-11-04"): 0},
        short="ManCo automation",
    ),
    "play": ProjectPlan(
        id="play",
        domain="pc",
        start=d("2026-09-28"),
        target=d("2026-12-18"),
        forecast=d("2026-12-18"),
        rate=1,
        rate_after=0,
        bau_day_hours={"r-ret": 0, "r-man": 0.5},
        short="Handover playbook",
    ),
    "fion": ProjectPlan(
        id="fion",
        domain="fi",
        start=d("2026-09-21"),
        target=d("2027-01-04"),
        forecast=d("2027-01-04"),
        rate=1,
        rate_after=1,
        bau_day_hours={"r-ret": 0, "r-man": 0},
        short="FI onboarding",
    ),
    "alpha": ProjectPlan(
        id="alpha",
        domain="fi",
        start=d("2026-12-03"),
        target=d("2027-03-25"),
        forecast=None,
        rate=2,
        rate_after=3,
        bau_day_hours={"r-ret": 0, "r-man": 0},
        short="Alpha engine",
    ),
}

MILESTONES: dict[str, tuple[Milestone, ...]] = {
    "ret": (
        _ms(
            "ret-now-0",
            "Security-level data feed connected",
            "2026-10-15",
            "now",
            (
                _task(
                    "ret-1",
                    "Request the security-level extract from the administrator",
                    0.5,
                    done_on="2026-10-01",
                ),
                _task("ret-2", "Parse and validate the extract", 4),
            ),
        ),
        _ms(
            "ret-now-1",
            "Fund-level engine reconciles",
            "2026-10-16",
            "now",
            (
                _task("ret-3", "Map source files for the last 4 funds", 3),
                _task("ret-4", "Reconcile September to administrator NAVs", 4),
                _task("ret-5", "Handle FX-hedged share classes", 3),
            ),
        ),
        _ms("ret-next-0", "Parallel run on November BD3", "2026-11-04", "next"),
        _ms("ret-next-1", "Security-level attribution", "2026-11-20", "next"),
        _ms("ret-next-2", "Runbook drafted", "2026-11-27", "next"),
        _ms("ret-ms-0", "Fund-level engine reconciles", "2026-10-16", "explicit"),
        _ms("ret-ms-1", "Parallel run on November BD3", "2026-11-04", "explicit"),
        _ms("ret-ms-2", "Security-level attribution", "2026-11-20", "explicit"),
    ),
    "manco": (
        _ms(
            "manco-now-0",
            "Performance section builds itself",
            "2026-10-16",
            "now",
            (
                _task("man-0", "Send the NAV bridge spec to Finance", 0.5, due="2026-10-02"),
                _task("man-1", "Map NAV bridge to source tables", 0.75),
                _task("man-2", "Template the performance section", 0.75),
                _task("man-3", "Test build against the September pack", 0.5),
                _task("man-4", "Exposure tables from source", 3),
            ),
        ),
        _ms("manco-next-0", "First self-built pack, November BD8", "2026-11-11", "next"),
        _ms("manco-next-1", "Exposure and pipeline sections", "2026-11-27", "next"),
        _ms("manco-ms-0", "Performance section builds itself", "2026-10-16", "explicit"),
        _ms("manco-ms-1", "First self-built pack, November BD8", "2026-11-11", "explicit"),
    ),
    "play": (
        _ms(
            "play-now-0",
            "Returns runbook outline",
            "2026-10-16",
            "now",
            (
                _task("pl-1", "Record the October BD3 run step by step", 2),
                _task("pl-2", "Draft the runbook outline", 1.5),
            ),
        ),
        _ms("play-next-0", "Returns runbook", "2026-11-06", "next"),
        _ms("play-next-1", "ManCo runbook", "2026-11-27", "next"),
        _ms("play-next-2", "Successor runs December BD3 alone", "2026-12-03", "next"),
        _ms("play-ms-0", "Returns runbook", "2026-11-06", "explicit"),
        _ms("play-ms-1", "ManCo runbook", "2026-11-27", "explicit"),
        _ms("play-ms-2", "Successor runs BD3 alone", "2026-12-03", "explicit"),
    ),
    "fion": (
        _ms(
            "fion-now-0",
            "Data entitlements requested",
            "2026-10-16",
            "now",
            (
                _task("fi-1", "Submit entitlement forms", 1, done_on="2026-10-02"),
                _task("fi-2", "Agree curve data sources with the FI desk", 1.5),
            ),
        ),
        _ms("fion-next-0", "Curve & auction data feeds", "2026-10-30", "next"),
        _ms("fion-next-1", "Sovereign model walkthrough", "2026-11-26", "next"),
        _ms("fion-ms-0", "Curve & auction feeds", "2026-10-30", "explicit"),
        _ms("fion-ms-1", "Sovereign model walkthrough", "2026-11-26", "explicit"),
        _ms("fion-ms-2", "Day-one dry run", "2026-12-17", "explicit"),
    ),
    "alpha": (),
}

NAMES = {
    "ret": "Returns pipeline automation",
    "manco": "ManCo pack automation",
    "play": "PC handover playbook",
    "fion": "FI onboarding & data access",
    "alpha": "Alpha engine v0",
}
CONFIDENCE = {"ret": 3, "manco": 4, "play": 4, "fion": 4, "alpha": None}
CHECKIN = {
    "ret": "2026-10-03",
    "manco": "2026-09-26",
    "play": "2026-10-02",
    "fion": "2026-09-30",
    "alpha": None,
}
BASELINE = {"ret": 60.0, "manco": 40.0, "play": 30.0, "fion": 35.0, "alpha": 0.0}
SCOPE_ADDED = {"ret": 10.0, "manco": 0.0, "play": 0.0, "fion": 0.0, "alpha": 0.0}
TARGET_LABEL = {"alpha": "Late Mar 2027"}

ORDER = ("ret", "manco", "play", "fion", "alpha")


def project(pid: str, plan: ProjectPlan | None = None) -> Project:
    checkin = CHECKIN[pid]
    return Project(
        plan=plan if plan is not None else PLANS[pid],
        name=NAMES[pid],
        confidence=CONFIDENCE[pid],
        last_checkin=d(checkin) if checkin else None,
        baseline_h=BASELINE[pid],
        scope_added_h=SCOPE_ADDED[pid],
        milestones=MILESTONES[pid],
        target_label=TARGET_LABEL.get(pid),
    )


def projects() -> list[Project]:
    return [project(pid) for pid in ORDER]


def plans() -> list[ProjectPlan]:
    return [PLANS[pid] for pid in ORDER]


# The two alias tables of the prototype (Notes and the simple reading), merged.
ALIASES: dict[str, tuple[str, ...]] = {
    "ret": ("returns pipeline", "pipeline", "attribution", "returns automation"),
    "manco": ("manco", "nav bridge", "managing committee"),
    "play": ("playbook", "runbook", "successor"),
    "fion": ("onboarding", "entitlement", "fi desk", "curve data", "bloomberg", "data access"),
    "alpha": ("alpha engine", "alpha", "signal"),
    "r-ret": ("returns", "funds"),
    "r-man": ("manco pack", "bd8"),
}

NOTES: dict[str, tuple[str, ...]] = {
    "2026-10-05": (
        "Admin files landed at 07:40 this morning instead of last night, so returns started late.",
        "5 of 12 funds done. Unitranche needed the manual FX fix again, which is exactly what "
        "the pipeline should remove.",
        "Finance happy to review the ManCo NAV bridge spec on Thursday.",
    ),
    "2026-10-02": (
        "Recorded the September BD3 run as raw notes for the playbook. Needs tidying into steps.",
        "FI desk suggested Bloomberg curve data rather than the internal feed for day one.",
    ),
    "2026-10-01": ("Chased the entitlement forms. Market data approved; feeds still pending.",),
}

# Today's returns run: the first 5 of 12 funds ticked.
RUNS: dict[tuple[str, date], RunState] = {
    ("r-ret", TODAY): RunState(ticks_done=5, last_tick_on=TODAY),
}


@dataclass(frozen=True)
class Seed:
    ctx: EngineCtx
    projects: list[Project]
    plans: list[ProjectPlan]


def seed() -> Seed:
    return Seed(ctx(), projects(), plans())
