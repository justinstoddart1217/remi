"""Textbook: sections, nested pages, blocks and uploaded chart assets.

* A section cannot be deleted while it has pages (``RESTRICT``); the service also keeps the
  last section.
* Deleting a page deletes its sub-pages and blocks (``CASCADE``); link blocks pointing at it
  lose their target (``SET NULL``, and the service strips them).
* A chart asset cannot be deleted while a block uses it (``RESTRICT``); unreferenced assets
  are garbage-collected after commit.
* ``textbook_pages.version`` is the optimistic lock for block autosave.
"""

import datetime as dt
from typing import Final, Literal, get_args

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.repositories.models.base import (
    Base,
    Timestamps,
    UTCDateTime,
    UUIDPk,
    check_in,
    check_range,
)

BlockType = Literal[
    "p", "h1", "h2", "h3", "bullet", "callout", "formula", "page", "chart", "divider"
]
BLOCK_TYPES: Final = get_args(BlockType)
DEFAULT_CHART_HEIGHT: Final = 380


class TextbookSection(UUIDPk, Base):
    """``label`` may be empty (shown as "Untitled section")."""

    __tablename__ = "textbook_sections"

    label: Mapped[str] = mapped_column(String(200), default="")
    accent: Mapped[str] = mapped_column(String(64), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    collapsed: Mapped[bool] = mapped_column(Boolean, default=False)

    # RESTRICT in the database: the ORM must not try to null out section_id.
    pages: Mapped[list["TextbookPage"]] = relationship(
        back_populates="section", passive_deletes="all", order_by="TextbookPage.sort_order"
    )


class TextbookPage(UUIDPk, Timestamps, Base):
    """A page, optionally nested under ``parent_id`` (same section, any depth)."""

    __tablename__ = "textbook_pages"
    __table_args__ = (check_range("version", 1, None),)

    section_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("textbook_sections.id", ondelete="RESTRICT"), index=True
    )
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("textbook_pages.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(300), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, default=1)
    blocks_saved_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime())
    """When the blocks were last written (created, autosaved, or a sub-page link added);
    ``None`` means never since creation. A rename moves ``updated_at`` but not this, so the
    chart GC dates a dropped chart reference by it."""

    section: Mapped[TextbookSection] = relationship(back_populates="pages")
    parent: Mapped["TextbookPage | None"] = relationship(
        back_populates="children", remote_side="TextbookPage.id"
    )
    children: Mapped[list["TextbookPage"]] = relationship(
        back_populates="parent",
        cascade="all",
        passive_deletes=True,
        order_by="TextbookPage.sort_order",
    )
    blocks: Mapped[list["TextbookBlock"]] = relationship(
        back_populates="page",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="TextbookBlock.sort_order",
        foreign_keys="TextbookBlock.page_id",
    )


class TextbookBlock(UUIDPk, Base):
    """One block. ``text`` is LaTeX for formulas; ``height``/``caption`` are for charts."""

    __tablename__ = "textbook_blocks"
    __table_args__ = (
        check_in("type", BLOCK_TYPES),
        check_range("height", 200, 900),
    )

    page_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("textbook_pages.id", ondelete="CASCADE"), index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    type: Mapped[BlockType] = mapped_column(String(8), default="p")
    text: Mapped[str] = mapped_column(Text, default="")
    target_page_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("textbook_pages.id", ondelete="SET NULL"), index=True
    )
    chart_asset_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("chart_assets.id", ondelete="RESTRICT"), index=True
    )
    height: Mapped[int] = mapped_column(Integer, default=DEFAULT_CHART_HEIGHT)
    caption: Mapped[str] = mapped_column(Text, default="")

    page: Mapped[TextbookPage] = relationship(back_populates="blocks", foreign_keys=[page_id])


class ChartAsset(UUIDPk, Base):
    """An uploaded chart, content-addressed on disk at ``<data>/<storage_relpath>``."""

    __tablename__ = "chart_assets"
    __table_args__ = (check_range("size_bytes", 0, None),)

    content_hash: Mapped[str] = mapped_column(String(64), unique=True)
    filename: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(Integer)
    storage_relpath: Mapped[str] = mapped_column(String(255))
    uploaded_at: Mapped[dt.datetime] = mapped_column(UTCDateTime())
