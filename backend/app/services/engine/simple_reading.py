"""The simple reading: a deterministic parser for check-in text (the default, no-AI path).

It is the prototype's ``simple()`` generalised to every project and routine through the shared
``AliasIndex``, with its quirks fixed:

- blocker text keeps its original case, and a blocker word must start a word and not be
  negated: "unblocked now", "no longer blocked by Finance" and "not stuck anymore" are not
  blockers (they fall through to a note, so the news is kept);
- no note is added next to a ``task_done``;
- one hours figure never becomes both ``hours_per_day`` and ``scope_add`` (a sentence can still
  carry both when it has two figures);
- a project gets one note: later note sentences for the same project are appended to it (the
  prototype made one note per sentence, but ``validate()`` keeps only the first note per project
  and cuts it to 160 characters);
- ``bau_done`` needs a routine mention followed within three words by a completion word
  (``Returns BAU is done``), or a completion word right before it (``finished the returns``),
  and the routine must count today. A routine word inside a project mention does not count.

The output is a ``RawProposal``; pass it through ``validate()`` like any AI proposal.
"""

import re
from collections.abc import Mapping, Sequence

from app.services.engine.aliases import AliasIndex, match_project, project_spans
from app.services.engine.model import EngineCtx, Task
from app.services.engine.routines import counts_on
from app.services.engine.validate import RawProposal

SIMPLE_SUMMARY = "Here is what a simple reading picked out. Untick anything that is wrong."

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
_HOURS = re.compile(r"(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b", re.IGNORECASE)
_SCOPE_WORD = re.compile(r"(want|also|add|scope|new|extra|asked)", re.IGNORECASE)
_HOURS_PHRASE = re.compile(
    r"\s*[,(]?\s*(about|probably|maybe|roughly)?\s*\d+(\.\d+)?\s*(h|hrs?|hours?)\b\)?",
    re.IGNORECASE,
)
_LEAD_IN = re.compile(r"^.*?(want|wants|asked for|add|added)\s+", re.IGNORECASE)
_BLOCKER = re.compile(
    r"(?<!\w)(?:waiting|blocked|stuck)(?:\s+(?:on|for|by))?\s+([^.;,]+)", re.IGNORECASE
)
_NEGATED = re.compile(
    r"(?:(?<!\w)(?:not|never|no\s+longer)|n['\u2019]t)\s+(?:(?:be|been|being|get|getting|got)\s+)?$",
    re.IGNORECASE,
)
"""Text right before a blocker word that turns it around: "no longer blocked", "not stuck",
"isn't waiting", "never got blocked"."""
_CONFIDENCE = re.compile(r"confidence\s*(?:is|at|now|:|of)?\s*(?:a\s+)?([1-5])", re.IGNORECASE)
_RATE = re.compile(r"(\d+(?:\.\d+)?)\s*h(?:ours?)?\s*(?:a|per)\s*day", re.IGNORECASE)
_TASK_DONE_WORD = re.compile(r"(finished|done|completed|sent|wrapped|shipped)", re.IGNORECASE)
_LETTERS = re.compile(r"[^a-z]+")
_COMPLETION = r"(?:done|finished|ran|complete|completed)"
_AFTER_ALIAS = re.compile(r"^(?:\s+[\w'\u2019]+){0,3}?\s+" + _COMPLETION + r"(?!\w)")
_BEFORE_ALIAS = re.compile(
    r"(?<!\w)(?:" + _COMPLETION + r"|ran)\s+(?:(?:the|today['\u2019]s)\s+)?$"
)


def _blocker(sentence: str) -> re.Match[str] | None:
    """The first blocker phrase that is not negated ("waiting on legal", "blocked by Finance").

    The blocker word must start a word ("unblocked" is not a blocker), and "no longer blocked",
    "not stuck" or "isn't waiting" are news that a blocker cleared, not a new one."""
    pos = 0
    while (m := _BLOCKER.search(sentence, pos)) is not None:
        if not _NEGATED.search(sentence[: m.start()]):
            return m
        pos = m.start() + 1  # the negated phrase may swallow a later blocker word
    return None


def split_sentences(text: str) -> list[str]:
    """The prototype's sentence split: after ``.``, ``!`` or ``?``, or at line breaks."""
    return [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]


def _inside(span: tuple[int, int], spans: list[tuple[int, int]]) -> bool:
    return any(a <= span[0] and span[1] <= b for a, b in spans)


def _bau_done_routine(sentence: str, ctx: EngineCtx, idx: AliasIndex) -> str | None:
    """The routine this sentence reports as done today, if any."""
    folded = sentence.casefold()
    taken = project_spans(folded, idx)
    for e in idx.routines:
        if e.pattern is None:
            continue
        for m in e.pattern.finditer(folded):
            if _inside(m.span(), taken):
                continue
            if _AFTER_ALIAS.match(folded[m.end() :]) or _BEFORE_ALIAS.search(folded[: m.start()]):
                r = ctx.routine(e.id)
                if r is not None and counts_on(r, ctx.today, ctx):
                    return e.id
    return None


def _scope_text(sentence: str, hours_match: re.Match[str]) -> str:
    text = sentence
    for m in _HOURS_PHRASE.finditer(sentence):
        if m.start() <= hours_match.start() < m.end() or hours_match.start() <= m.start() < (
            hours_match.end()
        ):
            text = sentence[: m.start()] + sentence[m.end() :]
            break
    text = _LEAD_IN.sub("", text, count=1)
    text = text.removesuffix(".")
    return text[:80]


def _task_words(text: str) -> list[str]:
    return [w for w in _LETTERS.split(text.casefold()) if len(w) > 3]


def parse_simple(
    text: str,
    focus_id: str | None,
    ctx: EngineCtx,
    idx: AliasIndex,
    open_tasks: Mapping[str, Sequence[Task]],
) -> RawProposal:
    """Read ``text`` sentence by sentence.

    Each sentence belongs to the first project it mentions, else to the previous sentence's
    project, else to ``focus_id``; with none it goes to ``unplaced``. From each sentence:
    scope (hours plus a word such as "want" or "add"), a blocker, a confidence 1-5, hours a
    day, finished tasks (enough words of an open Now task), and otherwise a note (one per
    project: later note sentences are appended to it).
    ``open_tasks`` maps a project id to its open Now tasks in plan order.
    """
    changes: list[dict[str, object]] = []
    notes: dict[str, dict[str, object]] = {}
    unplaced: list[str] = []
    last = focus_id
    for sentence in split_sentences(text):
        routine_id = _bau_done_routine(sentence, ctx, idx)
        if routine_id is not None:
            changes.append({"type": "bau_done", "routine_id": routine_id})
            continue
        pid = match_project(sentence, idx) or last
        if pid is None:
            unplaced.append(sentence)
            continue
        last = pid
        folded = sentence.casefold()
        rate = _RATE.search(sentence)
        scope_hours = next(
            (
                h
                for h in _HOURS.finditer(sentence)
                if rate is None or not (rate.start() <= h.start() < rate.end())
            ),
            None,
        )
        scope = scope_hours is not None and _SCOPE_WORD.search(sentence) is not None
        if scope and scope_hours is not None:
            changes.append(
                {
                    "type": "scope_add",
                    "project_id": pid,
                    "text": _scope_text(sentence, scope_hours),
                    "hours": float(scope_hours.group(1)),
                }
            )
        blocker = _blocker(sentence)
        if blocker is not None:
            changes.append({"type": "blocker", "project_id": pid, "text": blocker.group(1).strip()})
        confidence = _CONFIDENCE.search(sentence)
        if confidence is not None:
            changes.append(
                {"type": "confidence", "project_id": pid, "value": int(confidence.group(1))}
            )
        if rate is not None:
            changes.append(
                {"type": "hours_per_day", "project_id": pid, "value": float(rate.group(1))}
            )
        ticked = False
        if _TASK_DONE_WORD.search(sentence):
            for t in open_tasks.get(pid, ()):
                words = _task_words(t.text)
                hit = sum(1 for w in words if w in folded)
                if hit >= 2 or (0 < len(words) <= 3 and hit >= 1):
                    changes.append({"type": "task_done", "project_id": pid, "task_id": t.id})
                    ticked = True
        if not (blocker or confidence or scope or rate or ticked):
            note = notes.get(pid)
            if note is None:
                notes[pid] = {"type": "note", "project_id": pid, "text": sentence[:140]}
                changes.append(notes[pid])
            else:
                note["text"] = f"{note['text']} {sentence[:140]}"
    summary = SIMPLE_SUMMARY if changes else ""
    return RawProposal(summary=summary, changes=list(changes), unplaced=list(unplaced))
