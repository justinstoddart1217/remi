"""Notes: daily jots filed under a notebook day, tagged on read with the engine's alias tagger.

Tags come from ``engine.aliases`` (the tagger the simple reading uses too): every project and
routine matches on its name, short name and stored aliases, case-insensitively on word
boundaries. A routine is not tagged next to its own project unless it co-tags (the returns run
does). Labels are the project's short name, or ``"{routine short} · BAU"``. Tags are never
stored, so renaming a project or adding an alias retags every note.

Reads work before setup, except ``/notes/recent`` (it needs the business calendar and the
setup-time holiday region). Writes return the plan, so they answer 409 ``SETUP_REQUIRED``
before setup (and save nothing). Each write is one event; notes never move a forecast.
"""

import datetime as dt
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Final, TypeVar

from remi.core.clock import Clock, resolve_zone
from remi.core.errors import NotFound, ValidationFailed
from remi.core.uow import UnitOfWork, UnitOfWorkFactory, ref
from remi.repositories import models as orm
from remi.repositories.registry import ALIASES, NOTES, PROJECTS, ROUTINES, SETTINGS
from remi.schemas.mutation import MutationOut, NoteMutationOut
from remi.schemas.note import (
    DayTextOut,
    NoteCreate,
    NoteDayOut,
    NoteDaysOut,
    NoteListOut,
    NoteMentionOut,
    NoteOut,
    NotePatch,
    NoteTagOut,
    RecentNotesOut,
    TagPreviewOut,
)
from remi.services.adapters import routine_of
from remi.services.calendar import (
    YearSpan,
    check_within_horizon,
    read_span,
    with_calendar,
)
from remi.services.engine.aliases import AliasIndex, Tag, build_index, tags_for
from remi.services.engine.aliases import mentions as count_mentions
from remi.services.engine.calendar import BusinessCalendar
from remi.services.engine.model import Domain, Project, ProjectPlan
from remi.services.mutations import MutationScope, run_mutation
from remi.services.views import check_range, settings_info, with_plan_state
from remi.utils.dates import fmt_s, js_weekday, monday_of

T = TypeVar("T")


RAIL_DAYS: Final = 27
"""The rail lists business days from today back this many calendar days (``TODAY - 27``)."""
ROUTINE_SUFFIX: Final = " · BAU"


# ---------------------------------------------------------------------------- tagging
@dataclass(frozen=True, slots=True)
class Tagger:
    """The alias index plus each target's label and domain."""

    index: AliasIndex
    labels: dict[tuple[str, str], tuple[str, Domain]]

    def tags(self, text: str) -> list[NoteTagOut]:
        return [self._tag_out(t) for t in tags_for(text, self.index)]

    def mentions(self, texts: Sequence[str]) -> list[NoteMentionOut]:
        out: list[NoteMentionOut] = []
        for mention in count_mentions(texts, self.index):
            label, domain = self.labels[(mention.tag.kind, mention.tag.id)]
            out.append(
                NoteMentionOut(
                    target_type=mention.tag.kind,
                    target_id=mention.tag.id,
                    label=label,
                    domain=domain,
                    count=mention.count,
                )
            )
        return out

    def _tag_out(self, tag: Tag) -> NoteTagOut:
        label, domain = self.labels[(tag.kind, tag.id)]
        return NoteTagOut(target_type=tag.kind, target_id=tag.id, label=label, domain=domain)


def tagger(uow: UnitOfWork) -> Tagger:
    """The tagger over the current projects (plan order: PC first), routines and aliases."""
    projects: list[Project] = []
    labels: dict[tuple[str, str], tuple[str, Domain]] = {}
    for p in uow.repo(PROJECTS).list(full=False):
        short = p.short or p.name
        plan = ProjectPlan(
            id=p.id, domain=p.domain, start=p.start_date, target=p.target_date, short=short
        )
        projects.append(Project(plan=plan, name=p.name))
        labels[("project", p.id)] = (short, p.domain)
    routine_rows = uow.repo(ROUTINES).list()
    for r in routine_rows:
        labels[("routine", r.id)] = ((r.short or r.name) + ROUTINE_SUFFIX, r.domain)
    index = build_index(
        projects, [routine_of(r) for r in routine_rows], uow.repo(ALIASES).by_entity()
    )
    return Tagger(index=index, labels=labels)


def _time_label(at: dt.datetime, timezone: str) -> str:
    return at.astimezone(resolve_zone(timezone)).strftime("%H:%M")


def note_out(n: orm.Note, tags: Tagger, timezone: str) -> NoteOut:
    return NoteOut(
        id=n.id,
        day=n.day,
        text=n.text,
        seq=n.seq,
        time_label=_time_label(n.created_at, timezone),
        created_at=n.created_at,
        updated_at=n.updated_at,
        tags=tags.tags(n.text),
    )


def _timezone(uow: UnitOfWork) -> str:
    return uow.repo(SETTINGS).get().timezone


# ---------------------------------------------------------------------------- reads
def list_notes(uow_factory: UnitOfWorkFactory, day: dt.date) -> NoteListOut:
    """``GET /notes?day=``: one day's notes, oldest first, and what they mention."""
    with uow_factory.read() as uow:
        tags = tagger(uow)
        timezone = _timezone(uow)
        rows = uow.repo(NOTES).list_day(day)
        notes = [note_out(n, tags, timezone) for n in rows]
        found = tags.mentions([n.text for n in rows])
    return NoteListOut(day=day, notes=notes, mentions=found)


def tag_preview(uow_factory: UnitOfWorkFactory, text: str) -> TagPreviewOut:
    """``POST /notes/tags``: the tags an unsaved draft would get."""
    with uow_factory.read() as uow:
        return TagPreviewOut(tags=tagger(uow).tags(text))


def _with_cal(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    days: Iterable[dt.date],
    fn: Callable[[BusinessCalendar], T],
) -> T:
    """Run ``fn`` on a business calendar covering ``days`` inside the read horizon (the plan's
    calendar after setup; one generated in memory before it)."""
    today = clock.today()
    horizon = read_span(today)
    inside = sorted({today, *(d for d in days if horizon.covers(d))})
    ends = [inside[0], inside[-1]]
    info = settings_info(uow_factory)
    if info.complete:
        return with_plan_state(uow_factory, clock, lambda s: fn(s.cal), days=ends)
    span = YearSpan(today.year, today.year).including(ends)
    return with_calendar(uow_factory, clock, info.region, span, fn, persist=False)


def _day_out(
    cal: BusinessCalendar, day: dt.date, today: dt.date, count: int, preview: str
) -> NoteDayOut:
    if cal.covers(day):
        info = cal.day_info(day)
        bd, bdm, hol = info.bd, info.bdm, info.holiday
    else:  # outside the read horizon: weekdays only
        bd, bdm, hol = day.weekday() < 5, None, None
    return NoteDayOut(
        day=day,
        count=count,
        latest_preview=preview,
        w=js_weekday(day),
        bd=bd,
        bdm=bdm,
        hol=hol,
        week_of=monday_of(day),
        today=day == today,
    )


def list_note_days(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    frm: dt.date | None,
    to: dt.date | None,
) -> NoteDaysOut:
    """``GET /notes/days``: days with notes in the range (all of them without one), the rail,
    and the totals across every day."""
    if frm is not None and to is not None:
        check_range(frm, to)
    today = clock.today()
    with uow_factory.read() as uow:
        repo = uow.repo(NOTES)
        counts = repo.day_counts()
        previews = repo.latest_per_day()
        total = repo.count_total()
    rail_start = today - dt.timedelta(days=RAIL_DAYS)

    def build(cal: BusinessCalendar) -> NoteDaysOut:
        def row(day: dt.date) -> NoteDayOut:
            return _day_out(cal, day, today, counts.get(day, 0), previews.get(day, ""))

        in_range = [d for d in counts if (frm is None or d >= frm) and (to is None or d <= to)]
        rail_days = set(counts)
        d = rail_start
        while d <= today:
            if cal.covers(d) and cal.is_bd(d):
                rail_days.add(d)
            d += dt.timedelta(days=1)
        return NoteDaysOut(
            from_=frm,
            to=to,
            days=[row(d) for d in sorted(in_range, reverse=True)],
            rail=[row(d) for d in sorted(rail_days, reverse=True)],
            total=total,
            day_count=len(counts),
        )

    return _with_cal(uow_factory, clock, [rail_start, *counts], build)


def recent_business_days(cal: BusinessCalendar, today: dt.date, n: int) -> list[dt.date]:
    """The last ``n`` business days up to and including today, oldest first."""
    days: list[dt.date] = []
    if cal.is_bd(today):
        days.append(today)
    for d in cal.iter_bds_before(today):
        if len(days) >= n:
            break
        days.append(d)
    return sorted(days[:n])


def recent_notes(uow_factory: UnitOfWorkFactory, clock: Clock, n: int) -> RecentNotesOut:
    """``GET /notes/recent``: notes from the last ``n`` business days, oldest first (what Tell
    Remi may send). 409 before setup."""
    today = clock.today()
    days = with_plan_state(
        uow_factory,
        clock,
        lambda s: recent_business_days(s.cal, s.today, n),
        days=[today],
    )
    with uow_factory.read() as uow:
        tags = tagger(uow)
        timezone = _timezone(uow)
        notes = [note_out(x, tags, timezone) for x in uow.repo(NOTES).list_days(days)]
    return RecentNotesOut(business_days=days, count=len(notes), notes=notes)


def day_text(uow_factory: UnitOfWorkFactory, clock: Clock, day: dt.date) -> DayTextOut:
    """``GET /notes/day-text``: ``"HH:MM text"`` lines, oldest first; a day other than today
    starts with its date line (``"Fri 2 Oct"``)."""
    with uow_factory.read() as uow:
        timezone = _timezone(uow)
        notes = [
            f"{_time_label(n.created_at, timezone)} {n.text}" for n in uow.repo(NOTES).list_day(day)
        ]
    lines = [fmt_s(day), *notes] if notes and day != clock.today() else notes
    return DayTextOut(day=day, text="\n".join(lines), count=len(notes))


# ---------------------------------------------------------------------------- writes
def _clean(text: str) -> str:
    cleaned = text.strip()
    if not cleaned:
        raise ValidationFailed("A note needs some text.", "text")
    return cleaned


def _require_note(uow: UnitOfWork, note_id: str) -> orm.Note:
    note = uow.repo(NOTES).get(note_id)
    if note is None:
        raise NotFound("No note with that id.", "noteId")
    return note


def _note_mutation(
    uow_factory: UnitOfWorkFactory, clock: Clock, fn: Callable[[MutationScope], NoteOut]
) -> NoteMutationOut:
    result = run_mutation(uow_factory, clock, fn, "checkin", track_movements=False)
    return result.with_entity(NoteMutationOut, result.value)


def create_note(uow_factory: UnitOfWorkFactory, clock: Clock, body: NoteCreate) -> NoteMutationOut:
    """``POST /notes``: jot a note on ``day`` (created now; blank text is a 422)."""
    text = _clean(body.text)
    check_within_horizon(body.day, clock.today(), "day", field="day")

    def change(m: MutationScope) -> NoteOut:
        m.require_before()
        repo = m.uow.repo(NOTES)
        note = repo.add(orm.Note(day=body.day, text=text, seq=repo.next_seq(body.day)))
        m.uow.session.flush()
        m.uow.record(
            "note.created",
            [ref("note", note.id)],
            {"day": body.day.isoformat(), "text": text},
        )
        return note_out(note, tagger(m.uow), _timezone(m.uow))

    return _note_mutation(uow_factory, clock, change)


def update_note(
    uow_factory: UnitOfWorkFactory, clock: Clock, note_id: str, body: NotePatch
) -> NoteMutationOut:
    """``PATCH /notes/{id}``: new text (blank is a 422: the client deletes blanked notes)."""
    text = _clean(body.text)

    def change(m: MutationScope) -> NoteOut:
        m.require_before()
        note = _require_note(m.uow, note_id)
        note.text = text
        m.uow.session.flush()
        m.uow.record("note.updated", [ref("note", note_id)], {"text": text})
        return note_out(note, tagger(m.uow), _timezone(m.uow))

    return _note_mutation(uow_factory, clock, change)


def delete_note(uow_factory: UnitOfWorkFactory, clock: Clock, note_id: str) -> MutationOut:
    """``DELETE /notes/{id}``."""

    def change(m: MutationScope) -> None:
        m.require_before()
        note = _require_note(m.uow, note_id)
        day = note.day
        m.uow.repo(NOTES).delete(note)
        m.uow.record("note.deleted", [ref("note", note_id)], {"day": day.isoformat()})

    return run_mutation(uow_factory, clock, change, "checkin", track_movements=False).out()
