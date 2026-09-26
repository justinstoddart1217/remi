"""``TextbookRepository``: sections, nested pages and their blocks.

``replace_blocks`` is the autosave path: it checks the page's ``version`` (optimistic lock) and
raises ``VersionConflict`` (409) when the client saved against a stale version.
"""

import builtins
import datetime as dt
from collections.abc import Collection, Sequence
from typing import Any

from sqlalchemy import Integer, delete, func, literal_column, or_, select, update
from sqlalchemy.orm import Session, selectinload

from app.core.errors import VersionConflict
from app.repositories.models import TextbookBlock, TextbookPage, TextbookSection


class TextbookRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    # ------------------------------------------------------------------ sections
    def sections(self) -> builtins.list[TextbookSection]:
        stmt = select(TextbookSection).order_by(TextbookSection.sort_order, TextbookSection.id)
        return list(self.session.scalars(stmt))

    def get_section(self, section_id: str) -> TextbookSection | None:
        return self.session.get(TextbookSection, section_id)

    def add_section(self, section: TextbookSection) -> TextbookSection:
        self.session.add(section)
        return section

    def count_sections(self) -> int:
        stmt = select(func.count()).select_from(TextbookSection)
        return int(self.session.scalar(stmt) or 0)

    def section_is_empty(self, section_id: str) -> bool:
        stmt = (
            select(func.count())
            .select_from(TextbookPage)
            .where(TextbookPage.section_id == section_id)
        )
        return int(self.session.scalar(stmt) or 0) == 0

    def next_section_sort_order(self) -> int:
        current = self.session.scalar(select(func.max(TextbookSection.sort_order)))
        return 0 if current is None else int(current) + 1

    def count_pages_in(self, section_id: str) -> int:
        stmt = (
            select(func.count())
            .select_from(TextbookPage)
            .where(TextbookPage.section_id == section_id)
        )
        return int(self.session.scalar(stmt) or 0)

    def delete_section(self, section: TextbookSection) -> None:
        """Delete an empty section (the database refuses one that still has pages)."""
        self.session.delete(section)

    # ------------------------------------------------------------------ pages
    def pages(self) -> builtins.list[TextbookPage]:
        """Every page (without blocks), by section order then page order."""
        stmt = (
            select(TextbookPage)
            .join(TextbookSection, TextbookPage.section_id == TextbookSection.id)
            .order_by(TextbookSection.sort_order, TextbookPage.sort_order, TextbookPage.id)
        )
        return list(self.session.scalars(stmt))

    def pages_with_blocks(self) -> builtins.list[TextbookPage]:
        """Every page with its blocks loaded (one extra query), in section then page order."""
        stmt = (
            select(TextbookPage)
            .join(TextbookSection, TextbookPage.section_id == TextbookSection.id)
            .options(selectinload(TextbookPage.blocks))
            .order_by(TextbookSection.sort_order, TextbookPage.sort_order, TextbookPage.id)
        )
        return list(self.session.scalars(stmt))

    def tree(self) -> tuple[list[TextbookSection], list[TextbookPage]]:
        """Sections and pages for the sidebar."""
        return self.sections(), self.pages()

    def parent_links(self) -> dict[str, str | None]:
        """``{page id: parent id}`` for every page (to walk sub-pages without loading them)."""
        rows = self.session.execute(select(TextbookPage.id, TextbookPage.parent_id))
        return {page_id: parent_id for page_id, parent_id in rows}

    def existing_page_ids(self, page_ids: Collection[str]) -> set[str]:
        if not page_ids:
            return set()
        stmt = select(TextbookPage.id).where(TextbookPage.id.in_(list(page_ids)))
        return set(self.session.scalars(stmt))

    def delete_page(self, page: TextbookPage) -> None:
        """Delete ``page``; the database cascades to its sub-pages and every block inside."""
        self.session.delete(page)

    def get_page(self, page_id: str, *, with_blocks: bool = True) -> TextbookPage | None:
        stmt = select(TextbookPage).where(TextbookPage.id == page_id)
        if with_blocks:
            stmt = stmt.options(selectinload(TextbookPage.blocks))
        return self.session.scalars(stmt).first()

    def add_page(self, page: TextbookPage) -> TextbookPage:
        self.session.add(page)
        return page

    def count_pages(self) -> int:
        return int(self.session.scalar(select(func.count()).select_from(TextbookPage)) or 0)

    def next_page_sort_order(self, section_id: str, parent_id: str | None) -> int:
        stmt = select(func.max(TextbookPage.sort_order)).where(
            TextbookPage.section_id == section_id
        )
        stmt = stmt.where(
            TextbookPage.parent_id.is_(None)
            if parent_id is None
            else TextbookPage.parent_id == parent_id
        )
        current = self.session.scalar(stmt)
        return 0 if current is None else int(current) + 1

    # ------------------------------------------------------------------ blocks
    def count_chart_blocks(self) -> int:
        """Chart blocks that show a chart (the Home launcher's "live charts")."""
        stmt = (
            select(func.count())
            .select_from(TextbookBlock)
            .where(TextbookBlock.type == "chart", TextbookBlock.chart_asset_id.is_not(None))
        )
        return int(self.session.scalar(stmt) or 0)

    def block_owners(self, block_ids: Collection[str]) -> dict[str, str]:
        """``{block id: page id}`` for the given ids that exist anywhere."""
        if not block_ids:
            return {}
        stmt = select(TextbookBlock.id, TextbookBlock.page_id).where(
            TextbookBlock.id.in_(list(block_ids))
        )
        return {block_id: page_id for block_id, page_id in self.session.execute(stmt)}

    def chart_assets_on(self, page_ids: Collection[str]) -> set[str]:
        """Chart asset ids used by blocks of the given pages."""
        if not page_ids:
            return set()
        stmt = select(TextbookBlock.chart_asset_id).where(
            TextbookBlock.page_id.in_(list(page_ids)), TextbookBlock.chart_asset_id.is_not(None)
        )
        return {asset_id for asset_id in self.session.scalars(stmt) if asset_id is not None}

    def chart_assets_saved_at(self, page_ids: Collection[str]) -> dict[str, dt.datetime]:
        """``{asset id: when it was last saved}`` for the chart assets used on the given pages:
        the latest ``blocks_saved_at`` (else ``created_at``) among those pages that hold a
        block with the asset. A rename moves ``updated_at``, so it is not used here."""
        if not page_ids:
            return {}
        stmt = (
            select(
                TextbookBlock.chart_asset_id,
                func.coalesce(TextbookPage.blocks_saved_at, TextbookPage.created_at),
            )
            .join(TextbookPage, TextbookBlock.page_id == TextbookPage.id)
            .where(
                TextbookBlock.page_id.in_(list(page_ids)),
                TextbookBlock.chart_asset_id.is_not(None),
            )
        )
        out: dict[str, dt.datetime] = {}
        for asset_id, saved_at in self.session.execute(stmt):
            if asset_id is not None and (asset_id not in out or saved_at > out[asset_id]):
                out[asset_id] = saved_at
        return out

    def page_ids_by_creation(self) -> builtins.list[str]:
        """Every page id in creation order (``created_at``, then insertion order): the
        prototype's page array, which only ever appends."""
        rowid = literal_column("textbook_pages.rowid", Integer)
        stmt = select(TextbookPage.id).order_by(TextbookPage.created_at, rowid)
        return list(self.session.scalars(stmt))

    def strip_links_to(self, page_ids: Collection[str]) -> dict[str, int]:
        """Delete page-link blocks that point at ``page_ids`` from every *other* page.

        Each page that lost a link gets a new ``version`` (its blocks changed, so an editor
        holding the old version must reload) but keeps its ``updated_at``: nothing the user
        wrote changed. Returns ``{page id: links removed}``.
        """
        if not page_ids:
            return {}
        self.session.flush()
        targets = list(page_ids)
        rows = self.session.execute(
            select(TextbookBlock.id, TextbookBlock.page_id).where(
                TextbookBlock.type == "page",
                TextbookBlock.target_page_id.in_(targets),
                TextbookBlock.page_id.not_in(targets),
            )
        ).all()
        if not rows:
            return {}
        removed: dict[str, int] = {}
        for _block_id, page_id in rows:
            removed[page_id] = removed.get(page_id, 0) + 1
        self.session.execute(
            delete(TextbookBlock)
            .where(TextbookBlock.id.in_([block_id for block_id, _ in rows]))
            .execution_options(synchronize_session=False)
        )
        self.session.execute(
            update(TextbookPage)
            .where(TextbookPage.id.in_(list(removed)))
            .values(version=TextbookPage.version + 1, updated_at=TextbookPage.updated_at)
            .execution_options(synchronize_session=False)
        )
        self.session.expire_all()
        return removed

    def replace_blocks(
        self, page: TextbookPage, blocks: Sequence[TextbookBlock], base_version: int
    ) -> TextbookPage:
        """Replace every block of ``page`` and bump its version (optimistic lock)."""
        if page.version != base_version:
            raise VersionConflict
        page.blocks = list(blocks)
        for order, block in enumerate(page.blocks):
            block.sort_order = order
        page.version = base_version + 1
        return page

    def search(self, query: str, limit: int = 50) -> builtins.list[TextbookPage]:
        """Pages whose title or any block text contains ``query`` (case-insensitive)."""
        needle = f"%{query.strip()}%"
        matching_blocks = select(TextbookBlock.page_id).where(TextbookBlock.text.ilike(needle))
        stmt = (
            select(TextbookPage)
            .where(or_(TextbookPage.title.ilike(needle), TextbookPage.id.in_(matching_blocks)))
            .order_by(TextbookPage.updated_at.desc(), TextbookPage.id)
            .limit(limit)
        )
        return list(self.session.scalars(stmt))

    def add(self, row: Any) -> None:
        """Add any textbook row (section, page, block)."""
        self.session.add(row)
