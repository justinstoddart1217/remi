"""``AliasRepository``: stored aliases of projects and routines (always lower-case)."""

import builtins
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from remi.repositories.models import EntityAlias


def normalise_alias(text: str) -> str:
    """Lower-case with single spaces: how aliases are stored and compared."""
    return " ".join(text.lower().split())


class AliasRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list(self) -> builtins.list[EntityAlias]:
        """Every alias: project aliases first, then routine aliases, in insertion order."""
        stmt = select(EntityAlias).order_by(
            EntityAlias.project_id.is_(None), EntityAlias.alias, EntityAlias.id
        )
        return list(self.session.scalars(stmt))

    def get(self, alias_id: str) -> EntityAlias | None:
        return self.session.get(EntityAlias, alias_id)

    def find(
        self, alias: str, *, project_id: str | None = None, routine_id: str | None = None
    ) -> EntityAlias | None:
        """The alias row for exactly this entity and text, if stored."""
        stmt = select(EntityAlias).where(EntityAlias.alias == normalise_alias(alias))
        if project_id is not None:
            stmt = stmt.where(EntityAlias.project_id == project_id)
        if routine_id is not None:
            stmt = stmt.where(EntityAlias.routine_id == routine_id)
        return self.session.scalars(stmt).first()

    def by_entity(self) -> dict[str, builtins.list[str]]:
        """``{project or routine id: [alias, ...]}`` (the engine tagger's input)."""
        out: defaultdict[str, builtins.list[str]] = defaultdict(builtins.list)
        for row in self.session.scalars(select(EntityAlias).order_by(EntityAlias.id)):
            owner = row.project_id if row.project_id is not None else row.routine_id
            if owner is not None:
                out[owner].append(row.alias)
        return dict(out)

    def add(
        self,
        alias: str,
        *,
        project_id: str | None = None,
        routine_id: str | None = None,
        alias_id: str | None = None,
    ) -> EntityAlias:
        """Store an alias for exactly one of ``project_id`` / ``routine_id``."""
        if (project_id is None) == (routine_id is None):
            msg = "an alias belongs to exactly one project or routine"
            raise ValueError(msg)
        row = EntityAlias(
            project_id=project_id, routine_id=routine_id, alias=normalise_alias(alias)
        )
        if alias_id is not None:
            row.id = alias_id
        self.session.add(row)
        return row

    def delete(self, row: EntityAlias) -> None:
        self.session.delete(row)
