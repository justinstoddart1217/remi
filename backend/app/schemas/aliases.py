"""Entity aliases: extra words that name a project or routine (Notes tags, simple reading,
the palette). A project's name and short, and a routine's name and short, always count too."""

from typing import Literal

from pydantic import Field

from app.schemas.base import CamelIn, CamelModel, EntityId

AliasEntityType = Literal["project", "routine"]


class AliasOut(CamelModel):
    id: str
    entity_type: AliasEntityType
    entity_id: str
    alias: str
    """Stored lower-case. Matched case-insensitively on word boundaries."""


class AliasCreate(CamelIn):
    entity_type: AliasEntityType
    entity_id: EntityId
    alias: str = Field(min_length=3, max_length=60)
