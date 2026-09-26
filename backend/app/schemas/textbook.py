"""Textbook: sections, a page tree, pages of typed blocks, and uploaded HTML charts."""

from typing import Annotated, Literal

from pydantic import AwareDatetime, Field

from app.schemas.base import CamelIn, CamelModel, CssColour, EntityId

BlockText = Annotated[str, Field(max_length=20000)]
BlockId = Annotated[str, Field(min_length=1, max_length=64)]
"""Client-generated (``crypto.randomUUID()``), so autosave never waits for the server."""

BlockType = Literal[
    "p", "h1", "h2", "h3", "bullet", "callout", "formula", "page", "chart", "divider"
]
TEXT_BLOCK_TYPES: tuple[str, ...] = ("p", "h1", "h2", "h3", "bullet", "callout")
"""Block types that count for words, numbering, merging and the slash menu."""


# ---------------------------------------------------------------- blocks (request + response)
class ParagraphBlock(CamelIn):
    id: BlockId
    type: Literal["p"]
    text: BlockText


class Heading1Block(CamelIn):
    """Numbered section, 1."""

    id: BlockId
    type: Literal["h1"]
    text: BlockText


class Heading2Block(CamelIn):
    """Subsection, 1.1."""

    id: BlockId
    type: Literal["h2"]
    text: BlockText


class Heading3Block(CamelIn):
    """Concept, 1.1.1."""

    id: BlockId
    type: Literal["h3"]
    text: BlockText


class BulletBlock(CamelIn):
    id: BlockId
    type: Literal["bullet"]
    text: BlockText


class CalloutBlock(CamelIn):
    id: BlockId
    type: Literal["callout"]
    text: BlockText


class FormulaBlock(CamelIn):
    """Display LaTeX, rendered with KaTeX (``throwOnError: false``, ``trust: false``)."""

    id: BlockId
    type: Literal["formula"]
    tex: BlockText


class PageLinkBlock(CamelIn):
    """A link to a sub-page. ``targetPageId`` is ``null`` once the page is gone ("missing")."""

    id: BlockId
    type: Literal["page"]
    target_page_id: EntityId | None


class ChartBlock(CamelIn):
    """A live HTML chart, rendered in ``<iframe sandbox="allow-scripts" src="/api/charts/{id}">``.
    ``assetId`` is ``null`` for an empty chart block (the drop zone)."""

    id: BlockId
    type: Literal["chart"]
    asset_id: EntityId | None
    name: str = Field(max_length=255)
    height: int = Field(ge=200, le=900)
    """Pixels. Presets S 280 / M 380 / L 560; drag-resize clamps to 200-900."""
    caption: str = Field(max_length=2000)


class DividerBlock(CamelIn):
    id: BlockId
    type: Literal["divider"]


Block = Annotated[
    ParagraphBlock
    | Heading1Block
    | Heading2Block
    | Heading3Block
    | BulletBlock
    | CalloutBlock
    | FormulaBlock
    | PageLinkBlock
    | ChartBlock
    | DividerBlock,
    Field(discriminator="type"),
]


# ---------------------------------------------------------------- tree
class SectionOut(CamelModel):
    id: str
    label: str
    """``""`` is allowed and shown as "Untitled section"."""
    accent: str
    """A CSS colour, e.g. ``var(--fi-accent)`` or ``oklch(0.5 0.1 200)``."""
    sort_order: int
    collapsed: bool
    page_count: int


class PageSummaryOut(CamelModel):
    """A page in the sidebar tree (no blocks)."""

    id: str
    section_id: str
    parent_id: str | None
    title: str
    sort_order: int
    version: int
    updated_at: AwareDatetime
    child_count: int
    descendant_count: int
    chart_count: int
    word_count: int


class TextbookTreeOut(CamelModel):
    """``GET /textbook``: all sections and pages, ordered."""

    sections: list[SectionOut]
    pages: list[PageSummaryOut]


class PageOut(CamelModel):
    """``GET /textbook/pages/{id}``."""

    id: str
    section_id: str
    parent_id: str | None
    title: str
    sort_order: int
    version: int
    """Optimistic lock: send it back as ``baseVersion`` when saving blocks."""
    created_at: AwareDatetime
    updated_at: AwareDatetime
    blocks: list[Block]


class PageSavedOut(CamelModel):
    """``PUT /textbook/pages/{id}/blocks``: the new version (the editor keeps its own state)."""

    id: str
    version: int
    updated_at: AwareDatetime
    word_count: int
    chart_count: int


class PageCreatedOut(CamelModel):
    page: PageOut
    parent: PageOut | None
    """With ``replaceBlockId``: the parent after the server swapped that block for a link."""


class PageDeletedOut(CamelModel):
    deleted_ids: list[str]
    """The page and all its descendants. Link blocks to them elsewhere are stripped."""
    next_page_id: str | None
    """Where to go next: the parent, else the first page, else ``null`` (Textbook home)."""


# ---------------------------------------------------------------- home and search
class TextbookCountsOut(CamelModel):
    pages: int
    sections: int
    charts: int
    """Chart blocks with an uploaded asset ("live charts")."""
    words: int


class RecentPageOut(CamelModel):
    id: str
    title: str
    section_id: str
    path: list[str]
    """Section label, then ancestor titles ("Untitled" for blank)."""
    snippet: str
    """First non-empty ``p`` or ``callout`` text."""
    updated_at: AwareDatetime
    descendant_count: int
    chart_count: int


class HomeChartOut(CamelModel):
    page_id: str
    page_title: str
    block_id: str
    asset_id: str
    name: str
    caption: str


class SectionTopPageOut(CamelModel):
    id: str
    title: str
    descendant_count: int
    chart_count: int


class SectionCardOut(CamelModel):
    id: str
    label: str
    accent: str
    page_count: int
    top_pages: list[SectionTopPageOut]
    """The first five top-level pages."""
    more_count: int
    """Top-level pages beyond the first five ("+ N more")."""


class TextbookHomeOut(CamelModel):
    """``GET /textbook/home``: "Everything you have written down"."""

    counts: TextbookCountsOut
    recent: list[RecentPageOut]
    """Six most recently edited pages."""
    charts: list[HomeChartOut]
    """The first three charts in page, then block, order."""
    sections: list[SectionCardOut]


class SearchHitOut(CamelModel):
    page_id: str
    title: str
    section_id: str
    in_title: bool
    snippet: str
    """The matching block text (trimmed), or ``""`` for a title match."""


class TextbookSearchOut(CamelModel):
    """``GET /textbook/search?q=``: case-insensitive match on titles and block text."""

    q: str
    hits: list[SearchHitOut]


class ChartUploadOut(CamelModel):
    """``POST /textbook/charts``: the stored asset (deduplicated by content hash)."""

    asset_id: str
    name: str
    size_bytes: int
    content_hash: str
    deduplicated: bool
    """``true`` when identical content was already stored."""
    warnings: list[str]
    """e.g. the chart references ``http(s)`` URLs, which the sandbox CSP blocks."""


# ---------------------------------------------------------------- request bodies
class SectionCreate(CamelIn):
    """New sections cycle through the five accent hues when ``accent`` is omitted."""

    label: str = Field(default="", max_length=120)
    accent: CssColour | None = None


class SectionPatch(CamelIn):
    label: str | None = Field(default=None, max_length=120)
    accent: CssColour | None = None
    collapsed: bool | None = None


class PageCreate(CamelIn):
    """``POST /textbook/pages``. A sub-page (``parentId``) must be in the parent's section.

    ``replaceBlockId`` (a block of the parent) is swapped for a link to the new page; otherwise
    the link is inserted before a trailing empty ``p``. ``id`` may be client-generated.
    """

    id: EntityId | None = None
    section_id: EntityId
    parent_id: EntityId | None = None
    title: str = Field(default="", max_length=300)
    replace_block_id: BlockId | None = None


class PagePatch(CamelIn):
    """Newlines in the title are stripped."""

    title: str = Field(max_length=300)


class BlocksPut(CamelIn):
    """``PUT /textbook/pages/{id}/blocks``: the whole ordered block list. 409 when
    ``baseVersion`` is not the stored version."""

    blocks: list[Block] = Field(max_length=5000)
    base_version: int = Field(ge=0)
