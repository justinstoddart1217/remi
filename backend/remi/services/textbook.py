"""The Textbook: sections, a tree of pages, typed blocks, home and search.

Every command is one unit of work with one event. The Textbook never touches the plan, so the
commands use the unit of work directly (not ``run_mutation``) and work before first-run setup.

Behaviour follows ``Remi Textbook.dc.html``:

* **Sections.** New sections cycle through five accent hues. Committing a blank name on an
  empty, unnamed section removes it (the prototype's rename ``commit``); a blank name on a named
  section keeps the old name. Only an empty section that is not the last can be deleted (409
  ``SECTION_NOT_EMPTY`` / ``LAST_SECTION``).
* **Pages.** A new page starts with one empty paragraph; a new top-level page also expands its
  collapsed section. A sub-page stays in its parent's
  section; the parent gets a link block, either replacing ``replaceBlockId`` or inserted before
  a trailing empty paragraph. Newlines are stripped from titles. Deleting a page deletes
  everything inside it and strips links to the deleted pages from other pages; the prototype's
  re-seeding of a help page when the last page goes is not reproduced.
* **Blocks** are saved whole (autosave) against ``baseVersion``: 409 ``VERSION_CONFLICT`` when
  stale, otherwise the version goes up by one. The event keeps only ``{pageId, version,
  blockCount}``. Links to pages that no longer exist, and charts whose asset is gone, are saved
  empty (``null``) rather than failing the save.
* **Words** count whitespace-separated tokens in text blocks (``p``, headings, bullets,
  callouts), as the editor does; **charts** count chart blocks that show an uploaded asset
  ("live charts").
"""

import builtins
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Final, cast

from remi.core.errors import Conflict, NotFound, ValidationFailed, VersionConflict
from remi.core.ids import new_id
from remi.core.uow import UnitOfWork, UnitOfWorkFactory, ref
from remi.repositories import models as orm
from remi.repositories.registry import CHART_ASSETS, SETTINGS, TEXTBOOK
from remi.schemas.base import OrderPut
from remi.schemas.textbook import (
    TEXT_BLOCK_TYPES,
    Block,
    BlocksPut,
    BulletBlock,
    CalloutBlock,
    ChartBlock,
    DividerBlock,
    FormulaBlock,
    Heading1Block,
    Heading2Block,
    Heading3Block,
    HomeChartOut,
    PageCreate,
    PageCreatedOut,
    PageDeletedOut,
    PageLinkBlock,
    PageOut,
    PagePatch,
    PageSavedOut,
    PageSummaryOut,
    ParagraphBlock,
    RecentPageOut,
    SearchHitOut,
    SectionCardOut,
    SectionCreate,
    SectionOut,
    SectionPatch,
    SectionTopPageOut,
    TextbookCountsOut,
    TextbookHomeOut,
    TextbookSearchOut,
    TextbookTreeOut,
)
from remi.services import chart_store

NEW_ACCENTS: Final = (
    "oklch(0.5 0.1 200)",
    "oklch(0.5 0.1 320)",
    "oklch(0.5 0.1 170)",
    "oklch(0.5 0.1 300)",
    "oklch(0.5 0.1 230)",
)
"""Accents for new sections: index ``(sections - 3) mod 5`` (the three defaults come first)."""
UNTITLED_SECTION: Final = "Untitled section"
UNTITLED_PAGE: Final = "Untitled"
RECENT_PAGES: Final = 6
HOME_CHARTS: Final = 3
TOP_PAGES: Final = 5
SEARCH_LIMIT: Final = 200
SNIPPET_CHARS: Final = 160
DEFAULT_CHART_NAME: Final = chart_store.DEFAULT_CHART_NAME

_TEXT_TYPES: Final = frozenset(TEXT_BLOCK_TYPES)
_SNIPPET_TYPES: Final = frozenset({"p", "callout"})
_NOT_SEARCHED: Final = frozenset({"chart", "page", "divider"})
"""Block types whose ``text`` column is not user prose (a chart's ``text`` is its file name)."""


# ============================================================================ snapshots
@dataclass(frozen=True, slots=True)
class _BlockRow:
    id: str
    type: orm.BlockType
    text: str
    target_page_id: str | None
    chart_asset_id: str | None
    height: int
    caption: str

    @classmethod
    def of(cls, row: orm.TextbookBlock) -> "_BlockRow":
        return cls(
            id=row.id,
            type=row.type,
            text=row.text or "",
            target_page_id=row.target_page_id,
            chart_asset_id=row.chart_asset_id,
            height=row.height,
            caption=row.caption or "",
        )


@dataclass(frozen=True, slots=True)
class _PageRow:
    id: str
    section_id: str
    parent_id: str | None
    title: str
    sort_order: int
    version: int
    created_at: datetime
    updated_at: datetime
    blocks: tuple[_BlockRow, ...]

    @classmethod
    def of(cls, row: orm.TextbookPage) -> "_PageRow":
        return cls(
            id=row.id,
            section_id=row.section_id,
            parent_id=row.parent_id,
            title=row.title or "",
            sort_order=row.sort_order,
            version=row.version,
            created_at=row.created_at,
            updated_at=row.updated_at,
            blocks=tuple(_BlockRow.of(b) for b in sorted(row.blocks, key=_block_order)),
        )


@dataclass(frozen=True, slots=True)
class _SectionRow:
    id: str
    label: str
    accent: str
    sort_order: int
    collapsed: bool

    @classmethod
    def of(cls, row: orm.TextbookSection) -> "_SectionRow":
        return cls(
            id=row.id,
            label=row.label or "",
            accent=row.accent or "",
            sort_order=row.sort_order,
            collapsed=bool(row.collapsed),
        )


def _block_order(block: orm.TextbookBlock) -> tuple[int, str]:
    return (block.sort_order, block.id)


def words_in(text: str) -> int:
    r"""The prototype's ``text ? text.trim().split(/\s+/).length : 0``: a non-empty text of
    only spaces counts as one word, exactly as the editor counts it."""
    if not text:
        return 0
    return max(1, len(text.split()))


def word_count(blocks: Iterable[_BlockRow]) -> int:
    return sum(words_in(b.text) for b in blocks if b.type in _TEXT_TYPES)


def chart_count(blocks: Iterable[_BlockRow]) -> int:
    return sum(1 for b in blocks if b.type == "chart" and b.chart_asset_id is not None)


@dataclass(slots=True)
class _Book:
    """Everything in the Textbook, read once, with the page tree in sidebar order."""

    sections: list[_SectionRow]
    pages: list[_PageRow]
    """Depth-first: section order, then each top-level page followed by its sub-pages."""
    by_id: dict[str, _PageRow] = field(default_factory=dict[str, _PageRow])
    children: dict[str | None, list[_PageRow]] = field(
        default_factory=dict[str | None, list[_PageRow]]
    )
    section_by_id: dict[str, _SectionRow] = field(default_factory=dict[str, _SectionRow])

    @classmethod
    def read(cls, uow: UnitOfWork) -> "_Book":
        repo = uow.repo(TEXTBOOK)
        sections = [_SectionRow.of(s) for s in repo.sections()]
        rows = [_PageRow.of(p) for p in repo.pages_with_blocks()]
        return cls.build(sections, rows)

    @classmethod
    def build(cls, sections: list[_SectionRow], rows: list[_PageRow]) -> "_Book":
        by_id = {p.id: p for p in rows}
        children: dict[str | None, list[_PageRow]] = {}
        for page in rows:
            parent = page.parent_id if page.parent_id in by_id else None
            children.setdefault(parent, []).append(page)
        for siblings in children.values():
            siblings.sort(key=lambda p: (p.sort_order, p.created_at, p.id))
        ordered: list[_PageRow] = []
        seen: set[str] = set()

        def walk(page: _PageRow) -> None:
            if page.id in seen:  # defensive: a cycle cannot come from the API
                return
            seen.add(page.id)
            ordered.append(page)
            for child in children.get(page.id, []):
                walk(child)

        section_ids = [s.id for s in sections]
        for section_id in section_ids:
            for page in children.get(None, []):
                if page.section_id == section_id:
                    walk(page)
        for page in rows:  # anything unreachable (should not happen) still shows
            if page.id not in seen:
                walk(page)
        return cls(
            sections=sections,
            pages=ordered,
            by_id=by_id,
            children=children,
            section_by_id={s.id: s for s in sections},
        )

    def kids(self, page_id: str) -> list[_PageRow]:
        return self.children.get(page_id, [])

    def descendants(self, page_id: str) -> list[str]:
        out: list[str] = []
        stack = list(reversed(self.kids(page_id)))
        while stack:
            page = stack.pop()
            if page.id in out:
                continue
            out.append(page.id)
            stack.extend(reversed(self.kids(page.id)))
        return out

    def ancestors(self, page: _PageRow) -> list[_PageRow]:
        """Outermost first."""
        out: list[_PageRow] = []
        seen = {page.id}
        current = page
        while current.parent_id is not None and current.parent_id not in seen:
            parent = self.by_id.get(current.parent_id)
            if parent is None:
                break
            seen.add(parent.id)
            out.insert(0, parent)
            current = parent
        return out

    def section_label(self, section_id: str) -> str:
        section = self.section_by_id.get(section_id)
        return (section.label if section is not None else "") or UNTITLED_SECTION

    def page_count(self, section_id: str) -> int:
        return sum(1 for p in self.pages if p.section_id == section_id)

    def summary(self, page: _PageRow) -> PageSummaryOut:
        return PageSummaryOut(
            id=page.id,
            section_id=page.section_id,
            parent_id=page.parent_id,
            title=page.title,
            sort_order=page.sort_order,
            version=page.version,
            updated_at=page.updated_at,
            child_count=len(self.kids(page.id)),
            descendant_count=len(self.descendants(page.id)),
            chart_count=chart_count(page.blocks),
            word_count=word_count(page.blocks),
        )

    def section_out(self, section: _SectionRow) -> SectionOut:
        return SectionOut(
            id=section.id,
            label=section.label,
            accent=section.accent,
            sort_order=section.sort_order,
            collapsed=section.collapsed,
            page_count=self.page_count(section.id),
        )

    def tree(self) -> TextbookTreeOut:
        return TextbookTreeOut(
            sections=[self.section_out(s) for s in self.sections],
            pages=[self.summary(p) for p in self.pages],
        )


# ============================================================================ block mapping
def block_out(row: _BlockRow, asset_names: Mapping[str, str]) -> Block:
    """The wire form of a stored block."""
    match row.type:
        case "p":
            return ParagraphBlock(id=row.id, type="p", text=row.text)
        case "h1":
            return Heading1Block(id=row.id, type="h1", text=row.text)
        case "h2":
            return Heading2Block(id=row.id, type="h2", text=row.text)
        case "h3":
            return Heading3Block(id=row.id, type="h3", text=row.text)
        case "bullet":
            return BulletBlock(id=row.id, type="bullet", text=row.text)
        case "callout":
            return CalloutBlock(id=row.id, type="callout", text=row.text)
        case "formula":
            return FormulaBlock(id=row.id, type="formula", tex=row.text)
        case "page":
            return PageLinkBlock(id=row.id, type="page", target_page_id=row.target_page_id)
        case "chart":
            name = row.text or (
                asset_names.get(row.chart_asset_id, "") if row.chart_asset_id else ""
            )
            return ChartBlock(
                id=row.id,
                type="chart",
                asset_id=row.chart_asset_id,
                name=name or (DEFAULT_CHART_NAME if row.chart_asset_id else ""),
                height=min(900, max(200, row.height)),
                caption=row.caption,
            )
        case "divider":
            return DividerBlock(id=row.id, type="divider")


@dataclass(frozen=True, slots=True)
class _BlockFields:
    type: orm.BlockType
    text: str = ""
    target_page_id: str | None = None
    chart_asset_id: str | None = None
    height: int = orm.DEFAULT_CHART_HEIGHT
    caption: str = ""

    def apply(self, row: orm.TextbookBlock) -> None:
        row.type = self.type
        row.text = self.text
        row.target_page_id = self.target_page_id
        row.chart_asset_id = self.chart_asset_id
        row.height = self.height
        row.caption = self.caption


def block_fields(block: Block, pages: set[str], assets: set[str]) -> _BlockFields:
    """Stored columns for a wire block. Unknown link targets and chart assets become ``None``."""
    match block:
        case FormulaBlock():
            return _BlockFields(type="formula", text=block.tex)
        case PageLinkBlock():
            target = block.target_page_id if block.target_page_id in pages else None
            return _BlockFields(type="page", target_page_id=target)
        case ChartBlock():
            asset = block.asset_id if block.asset_id in assets else None
            return _BlockFields(
                type="chart",
                text=block.name,
                chart_asset_id=asset,
                height=block.height,
                caption=block.caption,
            )
        case DividerBlock():
            return _BlockFields(type="divider")
        case (
            ParagraphBlock()
            | Heading1Block()
            | Heading2Block()
            | Heading3Block()
            | BulletBlock()
            | CalloutBlock()
        ):
            return _BlockFields(type=block.type, text=block.text)


def _asset_names(uow: UnitOfWork, rows: Iterable[_BlockRow]) -> dict[str, str]:
    """File names of the assets that unnamed chart blocks show."""
    wanted = {
        b.chart_asset_id for b in rows if b.type == "chart" and b.chart_asset_id and not b.text
    }
    names: dict[str, str] = {}
    assets = uow.repo(CHART_ASSETS)
    for asset_id in wanted:
        asset = assets.get(asset_id)
        if asset is not None:
            names[asset_id] = asset.filename
    return names


def _page_out(uow: UnitOfWork, row: orm.TextbookPage) -> PageOut:
    snap = _PageRow.of(row)
    names = _asset_names(uow, snap.blocks)
    return PageOut(
        id=snap.id,
        section_id=snap.section_id,
        parent_id=snap.parent_id,
        title=snap.title,
        sort_order=snap.sort_order,
        version=snap.version,
        created_at=snap.created_at,
        updated_at=snap.updated_at,
        blocks=[block_out(b, names) for b in snap.blocks],
    )


# ============================================================================ text helpers
def clean_title(title: str) -> str:
    """The prototype strips newlines from titles as you type (no trimming)."""
    return title.replace("\r", "").replace("\n", "")


def clean_label(label: str) -> str:
    """Section names are trimmed when committed (and never contain newlines)."""
    return clean_title(label).strip()


def _snippet(text: str, needle: str) -> str:
    """``text`` trimmed, cut to a window around ``needle`` when it is long."""
    flat = " ".join(text.split())
    if len(flat) <= SNIPPET_CHARS:
        return flat
    at = flat.lower().find(needle)
    start = max(0, at - SNIPPET_CHARS // 3) if at >= 0 else 0
    end = min(len(flat), start + SNIPPET_CHARS)
    start = max(0, end - SNIPPET_CHARS)
    out = flat[start:end].strip()
    return ("…" if start > 0 else "") + out + ("…" if end < len(flat) else "")


# ============================================================================ reads
def get_tree(uow_factory: UnitOfWorkFactory) -> TextbookTreeOut:
    """``GET /textbook``: sections and the page tree (depth-first, sidebar order)."""
    with uow_factory.read() as uow:
        return _Book.read(uow).tree()


def get_page(uow_factory: UnitOfWorkFactory, page_id: str) -> PageOut:
    with uow_factory.read() as uow:
        row = uow.repo(TEXTBOOK).get_page(page_id)
        if row is None:
            raise NotFound("No such page.", "pageId")
        return _page_out(uow, row)


def get_home(uow_factory: UnitOfWorkFactory) -> TextbookHomeOut:
    """``GET /textbook/home``: "Everything you have written down"."""
    with uow_factory.read() as uow:
        book = _Book.read(uow)
        names = _asset_names(uow, (b for p in book.pages for b in p.blocks))

    charts: list[HomeChartOut] = []
    for page in book.pages:
        for block in page.blocks:
            if block.type == "chart" and block.chart_asset_id is not None:
                charts.append(
                    HomeChartOut(
                        page_id=page.id,
                        page_title=page.title,
                        block_id=block.id,
                        asset_id=block.chart_asset_id,
                        name=block.text or names.get(block.chart_asset_id) or DEFAULT_CHART_NAME,
                        caption=block.caption,
                    )
                )

    recent_pages = sorted(book.pages, key=lambda p: (p.updated_at, p.created_at), reverse=True)[
        :RECENT_PAGES
    ]
    recent = [
        RecentPageOut(
            id=p.id,
            title=p.title,
            section_id=p.section_id,
            path=[
                book.section_label(p.section_id),
                *[a.title or UNTITLED_PAGE for a in book.ancestors(p)],
            ],
            snippet=next(
                (b.text for b in p.blocks if b.type in _SNIPPET_TYPES and b.text.strip()), ""
            ),
            updated_at=p.updated_at,
            descendant_count=len(book.descendants(p.id)),
            chart_count=chart_count(p.blocks),
        )
        for p in recent_pages
    ]

    sections: list[SectionCardOut] = []
    for section in book.sections:
        top = [p for p in book.children.get(None, []) if p.section_id == section.id]
        sections.append(
            SectionCardOut(
                id=section.id,
                label=section.label,
                accent=section.accent,
                page_count=book.page_count(section.id),
                top_pages=[
                    SectionTopPageOut(
                        id=p.id,
                        title=p.title,
                        descendant_count=len(book.descendants(p.id)),
                        chart_count=chart_count(p.blocks),
                    )
                    for p in top[:TOP_PAGES]
                ],
                more_count=max(0, len(top) - TOP_PAGES),
            )
        )

    return TextbookHomeOut(
        counts=TextbookCountsOut(
            pages=len(book.pages),
            sections=len(book.sections),
            charts=len(charts),
            words=sum(word_count(p.blocks) for p in book.pages),
        ),
        recent=recent,
        charts=charts[:HOME_CHARTS],
        sections=sections,
    )


def search(uow_factory: UnitOfWorkFactory, q: str) -> TextbookSearchOut:
    """``GET /textbook/search``: case-insensitive substring match on titles and block text.

    Hits come as the prototype's filter lists them: flat, section by section, and within a
    section in creation order (its page array), not nested under their parents.
    """
    needle = q.strip().lower()
    if not needle:
        return TextbookSearchOut(q=q, hits=[])
    with uow_factory.read() as uow:
        book = _Book.read(uow)
        created = {pid: n for n, pid in enumerate(uow.repo(TEXTBOOK).page_ids_by_creation())}
    section_rank = {s.id: n for n, s in enumerate(book.sections)}
    in_order = sorted(
        book.pages,
        key=lambda p: (
            section_rank.get(p.section_id, len(section_rank)),
            created.get(p.id, len(created)),
        ),
    )
    hits: list[SearchHitOut] = []
    for page in in_order:
        in_title = needle in page.title.lower()
        match = (
            None
            if in_title
            else next(
                (
                    b
                    for b in page.blocks
                    if b.type not in _NOT_SEARCHED and needle in b.text.lower()
                ),
                None,
            )
        )
        if not in_title and match is None:
            continue
        hits.append(
            SearchHitOut(
                page_id=page.id,
                title=page.title,
                section_id=page.section_id,
                in_title=in_title,
                snippet="" if match is None else _snippet(match.text, needle),
            )
        )
        if len(hits) >= SEARCH_LIMIT:
            break
    return TextbookSearchOut(q=q, hits=hits)


# ============================================================================ sections
def _require_section(uow: UnitOfWork, section_id: str, field_name: str) -> orm.TextbookSection:
    section = uow.repo(TEXTBOOK).get_section(section_id)
    if section is None:
        raise NotFound("No such section.", field_name)
    return section


def _section_out(uow: UnitOfWork, section: orm.TextbookSection) -> SectionOut:
    return SectionOut(
        id=section.id,
        label=section.label or "",
        accent=section.accent or "",
        sort_order=section.sort_order,
        collapsed=bool(section.collapsed),
        page_count=uow.repo(TEXTBOOK).count_pages_in(section.id),
    )


def create_section(uow_factory: UnitOfWorkFactory, body: SectionCreate) -> SectionOut:
    with uow_factory() as uow:
        repo = uow.repo(TEXTBOOK)
        count = repo.count_sections()
        accent = body.accent or NEW_ACCENTS[(count - 3) % len(NEW_ACCENTS)]
        section = repo.add_section(
            orm.TextbookSection(
                label=clean_label(body.label),
                accent=accent,
                sort_order=repo.next_section_sort_order(),
                collapsed=False,
            )
        )
        uow.session.flush()
        uow.record(
            "textbook.section_created",
            [ref("textbook_section", section.id)],
            {"label": section.label, "accent": section.accent},
        )
        return _section_out(uow, section)


def update_section(
    uow_factory: UnitOfWorkFactory, section_id: str, body: SectionPatch
) -> SectionOut:
    """Rename, recolour or collapse. A blank name on an empty, unnamed section that is not the
    last one removes it (the answer is then the section as it was); a blank name on a named
    section is ignored."""
    fields = body.model_fields_set
    with uow_factory() as uow:
        repo = uow.repo(TEXTBOOK)
        section = _require_section(uow, section_id, "sectionId")
        before = _section_out(uow, section)
        changed: dict[str, Any] = {}
        if "label" in fields and body.label is not None:
            label = clean_label(body.label)
            if label:
                if label != section.label:
                    section.label = label
                    changed["label"] = label
            elif not section.label and before.page_count == 0 and repo.count_sections() > 1:
                repo.delete_section(section)
                uow.session.flush()
                uow.record(
                    "textbook.section_deleted",
                    [ref("textbook_section", section_id)],
                    {"sectionId": section_id, "reason": "blank_name"},
                )
                return before
        if "accent" in fields and body.accent is not None and body.accent != section.accent:
            section.accent = body.accent
            changed["accent"] = body.accent
        if (
            "collapsed" in fields
            and body.collapsed is not None
            and body.collapsed != section.collapsed
        ):
            section.collapsed = body.collapsed
            changed["collapsed"] = body.collapsed
        if changed:
            uow.session.flush()
            uow.record("textbook.section_updated", [ref("textbook_section", section_id)], changed)
        return _section_out(uow, section)


def delete_section(uow_factory: UnitOfWorkFactory, section_id: str) -> None:
    with uow_factory() as uow:
        repo = uow.repo(TEXTBOOK)
        section = _require_section(uow, section_id, "sectionId")
        if repo.count_pages_in(section_id) > 0:
            raise Conflict(
                "Only an empty section can be deleted; move or delete its pages first.",
                code="SECTION_NOT_EMPTY",
            )
        if repo.count_sections() <= 1:
            raise Conflict("The Textbook needs at least one section.", code="LAST_SECTION")
        repo.delete_section(section)
        uow.session.flush()
        uow.record(
            "textbook.section_deleted",
            [ref("textbook_section", section_id)],
            {"sectionId": section_id},
        )


def reorder_sections(uow_factory: UnitOfWorkFactory, body: OrderPut) -> TextbookTreeOut:
    with uow_factory() as uow:
        repo = uow.repo(TEXTBOOK)
        sections = repo.sections()
        current = {s.id: s for s in sections}
        if len(set(body.ids)) != len(body.ids) or set(body.ids) != set(current):
            raise ValidationFailed("Send every section id exactly once, in the new order.", "ids")
        if [s.id for s in sections] != body.ids:
            for order, section_id in enumerate(body.ids):
                current[section_id].sort_order = order
            uow.session.flush()
            uow.record(
                "textbook.sections_reordered",
                [ref("textbook_section", sid) for sid in body.ids],
                {"ids": body.ids},
            )
    return get_tree(uow_factory)


# ============================================================================ pages
def _require_page(uow: UnitOfWork, page_id: str, field_name: str) -> orm.TextbookPage:
    page = uow.repo(TEXTBOOK).get_page(page_id)
    if page is None:
        raise NotFound("No such page.", field_name)
    return page


def _renumber(blocks: Sequence[orm.TextbookBlock]) -> None:
    for order, block in enumerate(blocks):
        block.sort_order = order


def create_page(uow_factory: UnitOfWorkFactory, data_dir: Path, body: PageCreate) -> PageCreatedOut:
    """A page, or a sub-page linked from its parent (``replaceBlockId`` or a new link block)."""
    dropped: dict[str, datetime] = {}
    with uow_factory() as uow:
        repo = uow.repo(TEXTBOOK)
        section = _require_section(uow, body.section_id, "sectionId")
        parent: orm.TextbookPage | None = None
        if body.parent_id is not None:
            parent = _require_page(uow, body.parent_id, "parentId")
            if parent.section_id != body.section_id:
                raise ValidationFailed("A sub-page must be in its parent's section.", "sectionId")
        elif body.replace_block_id is not None:
            raise ValidationFailed("replaceBlockId needs a parentId.", "replaceBlockId")
        else:
            section.collapsed = False  # a new top-level page opens its section (``newPageIn``)
        page_id = body.id or new_id()
        if repo.get_page(page_id, with_blocks=False) is not None:
            raise Conflict("A page with this id already exists.", "id")

        page = repo.add_page(
            orm.TextbookPage(
                id=page_id,
                section_id=body.section_id,
                parent_id=body.parent_id,
                title=clean_title(body.title),
                sort_order=repo.next_page_sort_order(body.section_id, body.parent_id),
                version=1,
                blocks_saved_at=uow.clock.now(),
            )
        )
        page.blocks = [orm.TextbookBlock(id=new_id(), type="p", text="", sort_order=0)]
        uow.session.flush()

        link_block_id: str | None = None
        if parent is not None:
            blocks = sorted(parent.blocks, key=_block_order)
            if body.replace_block_id is not None:
                target = next((b for b in blocks if b.id == body.replace_block_id), None)
                if target is None:
                    raise NotFound("No such block on the parent page.", "replaceBlockId")
                if target.chart_asset_id is not None:
                    # When the parent last saved the chart (for the GC; see ``schedule_gc``).
                    dropped[target.chart_asset_id] = blocks_saved_at(parent)
                _BlockFields(type="page", target_page_id=page.id).apply(target)
                link_block_id = target.id
            else:
                link = orm.TextbookBlock(id=new_id(), page_id=parent.id)
                _BlockFields(type="page", target_page_id=page.id).apply(link)
                last = blocks[-1] if blocks else None
                if last is not None and last.type == "p" and not last.text:
                    blocks.insert(len(blocks) - 1, link)
                else:
                    blocks.append(link)
                parent.blocks = blocks
                link_block_id = link.id
            _renumber(blocks)
            parent.version += 1
            parent.blocks_saved_at = uow.clock.now()
        uow.session.flush()
        uow.record(
            "textbook.page_created",
            [
                ref("textbook_page", page.id),
                *([ref("textbook_page", parent.id)] if parent is not None else []),
            ],
            {
                "pageId": page.id,
                "sectionId": page.section_id,
                "parentId": page.parent_id,
                "title": page.title,
                "linkBlockId": link_block_id,
            },
        )
        if dropped:
            chart_store.schedule_gc(uow, uow_factory, data_dir, dropped)
        out = PageCreatedOut(
            page=_page_out(uow, page),
            parent=_page_out(uow, parent) if parent is not None else None,
        )
    return out


def blocks_saved_at(page: orm.TextbookPage) -> datetime:
    """When ``page``'s blocks were last written (its creation if never since). A rename moves
    ``updated_at`` but not this, so a dropped chart is dated by the last blocks save."""
    return page.blocks_saved_at or page.created_at


def rename_page(uow_factory: UnitOfWorkFactory, page_id: str, body: PagePatch) -> PageSummaryOut:
    """Newlines are stripped. The block version is unchanged (autosave keeps its lock)."""
    title = clean_title(body.title)
    with uow_factory() as uow:
        page = _require_page(uow, page_id, "pageId")
        if page.title != title:
            page.title = title
            uow.session.flush()
            uow.record("textbook.page_renamed", [ref("textbook_page", page_id)], {"title": title})
        book = _Book.read(uow)
    return book.summary(book.by_id[page_id])


def save_blocks(
    uow_factory: UnitOfWorkFactory, data_dir: Path, page_id: str, body: BlocksPut
) -> PageSavedOut:
    """Autosave: replace the page's blocks if ``baseVersion`` is current, else 409."""
    seen: dict[str, int] = {}
    for index, block in enumerate(body.blocks):
        if block.id in seen:
            raise ValidationFailed("Each block needs its own id.", f"blocks.{index}.id")
        seen[block.id] = index

    with uow_factory() as uow:
        repo = uow.repo(TEXTBOOK)
        page = _require_page(uow, page_id, "pageId")
        if page.version != body.base_version:
            raise VersionConflict()
        saved_at = blocks_saved_at(page)  # when the blocks being replaced were saved (the GC)
        foreign = {bid: pid for bid, pid in repo.block_owners(list(seen)).items() if pid != page_id}
        if foreign:
            index = min(seen[bid] for bid in foreign)
            raise ValidationFailed("That block id is used on another page.", f"blocks.{index}.id")

        targets = {
            b.target_page_id
            for b in body.blocks
            if isinstance(b, PageLinkBlock) and b.target_page_id is not None
        }
        assets = {
            b.asset_id for b in body.blocks if isinstance(b, ChartBlock) and b.asset_id is not None
        }
        live_pages = repo.existing_page_ids(targets)
        live_assets = uow.repo(CHART_ASSETS).existing_ids(assets)

        before_assets = {b.chart_asset_id for b in page.blocks if b.chart_asset_id is not None}
        existing = {b.id: b for b in page.blocks}
        rows: list[orm.TextbookBlock] = []
        for block in body.blocks:
            row = existing.get(block.id) or orm.TextbookBlock(id=block.id, page_id=page_id)
            block_fields(block, live_pages, live_assets).apply(row)
            rows.append(row)
        repo.replace_blocks(page, rows, body.base_version)
        page.blocks_saved_at = uow.clock.now()
        uow.session.flush()
        after_assets = {r.chart_asset_id for r in rows if r.chart_asset_id is not None}
        uow.record(
            "textbook.blocks_saved",
            [ref("textbook_page", page_id)],
            {"pageId": page_id, "version": page.version, "blockCount": len(rows)},
            capture_diff=False,
        )
        dropped = before_assets - after_assets
        if dropped:
            chart_store.schedule_gc(uow, uow_factory, data_dir, dict.fromkeys(dropped, saved_at))
        snapshot = [_BlockRow.of(r) for r in rows]
        out = PageSavedOut(
            id=page_id,
            version=page.version,
            updated_at=page.updated_at,
            word_count=word_count(snapshot),
            chart_count=chart_count(snapshot),
        )
    return out


def _forget_pages_in_prefs(uow: UnitOfWork, gone: set[str], next_page_id: str | None) -> None:
    """Drop deleted pages from the remembered Textbook page and collapsed pages."""
    settings = uow.repo(SETTINGS).get()
    prefs = dict(cast(Mapping[str, Any], settings.ui_prefs or {}))
    changed = False
    if prefs.get("last_textbook_page_id") in gone:
        if next_page_id is None:
            prefs.pop("last_textbook_page_id", None)
        else:
            prefs["last_textbook_page_id"] = next_page_id
        changed = True
    collapsed = prefs.get("collapsed_page_ids")
    if isinstance(collapsed, list):
        kept = [x for x in cast(builtins.list[Any], collapsed) if x not in gone]
        if len(kept) != len(cast(builtins.list[Any], collapsed)):
            prefs["collapsed_page_ids"] = kept
            changed = True
    if changed:
        settings.ui_prefs = prefs


def delete_page(uow_factory: UnitOfWorkFactory, data_dir: Path, page_id: str) -> PageDeletedOut:
    """The page and every page inside it; links to them elsewhere are stripped."""
    with uow_factory() as uow:
        repo = uow.repo(TEXTBOOK)
        page = _require_page(uow, page_id, "pageId")
        parent_id = page.parent_id
        parents = repo.parent_links()
        gone_order = [page_id, *_descendants_of(page_id, parents)]
        gone = set(gone_order)
        dropped = repo.chart_assets_saved_at(gone)
        stripped = repo.strip_links_to(gone)
        page = _require_page(uow, page_id, "pageId")  # strip_links_to expired the session
        repo.delete_page(page)
        uow.session.flush()

        # The parent, else the first remaining page in creation order (the prototype's
        # ``next[0]``: its page array only ever appends), else nothing.
        remaining = repo.page_ids_by_creation()
        if parent_id is not None and parent_id in remaining:
            next_page_id: str | None = parent_id
        else:
            next_page_id = remaining[0] if remaining else None
        _forget_pages_in_prefs(uow, gone, next_page_id)
        uow.record(
            "textbook.page_deleted",
            [ref("textbook_page", pid) for pid in gone_order],
            {"pageId": page_id, "deletedIds": gone_order, "strippedLinks": stripped},
        )
        if dropped:
            chart_store.schedule_gc(uow, uow_factory, data_dir, dropped)
    return PageDeletedOut(deleted_ids=gone_order, next_page_id=next_page_id)


def _descendants_of(page_id: str, parents: Mapping[str, str | None]) -> list[str]:
    kids: dict[str, list[str]] = {}
    for child, parent in parents.items():
        if parent is not None:
            kids.setdefault(parent, []).append(child)
    out: list[str] = []
    seen = {page_id}
    stack = list(reversed(sorted(kids.get(page_id, []))))
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        out.append(current)
        stack.extend(reversed(sorted(kids.get(current, []))))
    return out
