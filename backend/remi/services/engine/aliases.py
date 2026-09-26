"""The one tagger Notes and the simple reading share.

Every project matches on its name, short name and aliases; every routine on its name, short
name and aliases. Keys are casefolded, must be at least 3 characters, and match only on word
boundaries (``(?<!\\w)key(?!\\w)``), so ``alpha`` no longer matches ``alphabet``.

Tags list projects first, then routines, each in the given order. A routine is not tagged
when its linked project is already tagged, unless the routine is marked ``co_tag``.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from remi.services.engine.model import Project, RoutineDef

MIN_ALIAS_LEN = 3

TagKind = Literal["project", "routine"]


def normalise_key(text: str) -> str:
    """Casefold and collapse whitespace."""
    return " ".join(text.casefold().split())


@dataclass(frozen=True, slots=True)
class AliasEntry:
    kind: TagKind
    id: str
    keys: tuple[str, ...]
    pattern: re.Pattern[str] | None
    project_id: str | None = None
    """The routine's linked project."""
    co_tag: bool = False


@dataclass(frozen=True, slots=True)
class AliasIndex:
    projects: tuple[AliasEntry, ...]
    routines: tuple[AliasEntry, ...]


@dataclass(frozen=True, slots=True)
class Tag:
    kind: TagKind
    id: str


def _keys(*sources: str) -> tuple[str, ...]:
    seen: list[str] = []
    for source in sources:
        key = normalise_key(source)
        if len(key) >= MIN_ALIAS_LEN and key not in seen:
            seen.append(key)
    return tuple(seen)


def _pattern(keys: tuple[str, ...]) -> re.Pattern[str] | None:
    if not keys:
        return None
    parts = [r"\s+".join(re.escape(w) for w in k.split(" ")) for k in keys]
    parts.sort(key=len, reverse=True)
    return re.compile(r"(?<!\w)(?:" + "|".join(parts) + r")(?!\w)")


def build_index(
    projects: Sequence[Project],
    routines: Sequence[RoutineDef],
    aliases: Mapping[str, Sequence[str]],
) -> AliasIndex:
    """Build the tagger. ``aliases`` maps a project or routine id to its extra aliases."""
    project_entries: list[AliasEntry] = []
    for p in projects:
        keys = _keys(p.name, p.short, *aliases.get(p.id, ()))
        project_entries.append(AliasEntry("project", p.id, keys, _pattern(keys)))
    routine_entries: list[AliasEntry] = []
    for r in routines:
        keys = _keys(r.name, r.short, *aliases.get(r.id, ()))
        routine_entries.append(
            AliasEntry("routine", r.id, keys, _pattern(keys), r.project_id, r.co_tag)
        )
    return AliasIndex(tuple(project_entries), tuple(routine_entries))


def tags_for(text: str, idx: AliasIndex) -> list[Tag]:
    """The projects and routines ``text`` mentions."""
    folded = text.casefold()
    tags: list[Tag] = []
    tagged_projects: set[str] = set()
    for e in idx.projects:
        if e.pattern is not None and e.pattern.search(folded):
            tags.append(Tag("project", e.id))
            tagged_projects.add(e.id)
    for e in idx.routines:
        if e.pattern is None or not e.pattern.search(folded):
            continue
        if e.project_id is not None and e.project_id in tagged_projects and not e.co_tag:
            continue
        tags.append(Tag("routine", e.id))
    return tags


def match_project(text: str, idx: AliasIndex) -> str | None:
    """The first project (in order) that ``text`` mentions."""
    folded = text.casefold()
    for e in idx.projects:
        if e.pattern is not None and e.pattern.search(folded):
            return e.id
    return None


def project_spans(folded: str, idx: AliasIndex) -> list[tuple[int, int]]:
    """Spans of every project mention in already-casefolded text."""
    spans: list[tuple[int, int]] = []
    for e in idx.projects:
        if e.pattern is not None:
            spans.extend(m.span() for m in e.pattern.finditer(folded))
    return spans


@dataclass(frozen=True, slots=True)
class Mention:
    tag: Tag
    count: int
    """Number of notes that mention it."""


def mentions(texts: Sequence[str], idx: AliasIndex) -> list[Mention]:
    """Per tag, how many of ``texts`` mention it; most mentioned first (stable)."""
    counts: dict[Tag, int] = {}
    for text in texts:
        for tag in tags_for(text, idx):
            counts[tag] = counts.get(tag, 0) + 1
    ordered = sorted(counts.items(), key=lambda kv: -kv[1])
    return [Mention(tag, n) for tag, n in ordered]
