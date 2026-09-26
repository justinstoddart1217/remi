"""``ChartAssetRepository``: uploaded HTML charts (content-addressed, deduplicated by hash)."""

import builtins
from collections.abc import Collection

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.repositories.models import ChartAsset, TextbookBlock


class ChartAssetRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get(self, asset_id: str) -> ChartAsset | None:
        return self.session.get(ChartAsset, asset_id)

    def get_by_hash(self, content_hash: str) -> ChartAsset | None:
        stmt = select(ChartAsset).where(ChartAsset.content_hash == content_hash)
        return self.session.scalars(stmt).first()

    def add(self, asset: ChartAsset) -> ChartAsset:
        self.session.add(asset)
        return asset

    def delete(self, asset: ChartAsset) -> None:
        self.session.delete(asset)

    def count(self) -> int:
        return int(self.session.scalar(select(func.count()).select_from(ChartAsset)) or 0)

    def is_referenced(self, asset_id: str) -> bool:
        stmt = (
            select(func.count())
            .select_from(TextbookBlock)
            .where(TextbookBlock.chart_asset_id == asset_id)
        )
        return int(self.session.scalar(stmt) or 0) > 0

    def unreferenced(self) -> builtins.list[ChartAsset]:
        """Assets no block uses (garbage-collected after commit)."""
        used = select(TextbookBlock.chart_asset_id).where(TextbookBlock.chart_asset_id.is_not(None))
        stmt = select(ChartAsset).where(ChartAsset.id.not_in(used)).order_by(ChartAsset.id)
        return list(self.session.scalars(stmt))

    def existing_ids(self, asset_ids: Collection[str]) -> set[str]:
        if not asset_ids:
            return set()
        stmt = select(ChartAsset.id).where(ChartAsset.id.in_(list(asset_ids)))
        return set(self.session.scalars(stmt))

    def storage_relpaths(self) -> set[str]:
        """Where every stored asset's file lives (relative to the data dir)."""
        return set(self.session.scalars(select(ChartAsset.storage_relpath)))
