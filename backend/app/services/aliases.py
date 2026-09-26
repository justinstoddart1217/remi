"""Entity aliases (data only): extra words that name a project or routine.

The Notes tagger, the simple reading and the palette match a project or routine on its name,
short name and these aliases (``engine.aliases``). Aliases are stored lower-case with single
spaces and must be at least three characters (the tagger ignores shorter keys). Adding or
removing one is one event; aliases never move a forecast, so the mutations track no movements.
``GET /aliases`` works before setup; the writes return the plan, so they need it.
"""

from typing import Final

from app.core.clock import Clock
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.uow import UnitOfWorkFactory, ref
from app.repositories import models as orm
from app.repositories.alias_repo import normalise_alias
from app.repositories.registry import ALIASES, PROJECTS, ROUTINES
from app.schemas.aliases import AliasCreate, AliasOut
from app.schemas.mutation import AliasMutationOut, MutationOut
from app.services.engine.aliases import MIN_ALIAS_LEN
from app.services.mutations import MutationScope, run_mutation

MAX_ALIAS_LEN: Final = 60


def alias_out(row: orm.EntityAlias) -> AliasOut:
    if row.project_id is not None:
        return AliasOut(id=row.id, entity_type="project", entity_id=row.project_id, alias=row.alias)
    return AliasOut(
        id=row.id, entity_type="routine", entity_id=row.routine_id or "", alias=row.alias
    )


def list_aliases(uow_factory: UnitOfWorkFactory) -> list[AliasOut]:
    """``GET /aliases``: every stored alias (project aliases first)."""
    with uow_factory.read() as uow:
        return [alias_out(a) for a in uow.repo(ALIASES).list()]


def create_alias(
    uow_factory: UnitOfWorkFactory, clock: Clock, body: AliasCreate
) -> AliasMutationOut:
    """``POST /aliases``: 404 for an unknown project or routine, 409 when the entity already
    has the alias, 422 when it is shorter than three characters once normalised."""
    alias = normalise_alias(body.alias)
    if len(alias) < MIN_ALIAS_LEN or len(alias) > MAX_ALIAS_LEN:
        raise ValidationFailed(
            f"An alias needs {MIN_ALIAS_LEN} to {MAX_ALIAS_LEN} characters.", "alias"
        )
    is_project = body.entity_type == "project"

    def change(m: MutationScope) -> AliasOut:
        m.require_before()
        uow = m.uow
        exists = (
            uow.repo(PROJECTS).exists(body.entity_id)
            if is_project
            else uow.repo(ROUTINES).exists(body.entity_id)
        )
        if not exists:
            raise NotFound(f"No {body.entity_type} with that id.", "entityId")
        repo = uow.repo(ALIASES)
        project_id = body.entity_id if is_project else None
        routine_id = None if is_project else body.entity_id
        if repo.find(alias, project_id=project_id, routine_id=routine_id) is not None:
            raise Conflict(f"That {body.entity_type} already has this alias.", "alias")
        row = repo.add(alias, project_id=project_id, routine_id=routine_id)
        uow.session.flush()
        uow.record(
            "alias.created",
            [ref("alias", row.id), ref(body.entity_type, body.entity_id)],
            {"entityType": body.entity_type, "entityId": body.entity_id, "alias": alias},
        )
        return alias_out(row)

    result = run_mutation(uow_factory, clock, change, track_movements=False)
    return result.with_entity(AliasMutationOut, result.value)


def delete_alias(uow_factory: UnitOfWorkFactory, clock: Clock, alias_id: str) -> MutationOut:
    """``DELETE /aliases/{id}``."""

    def change(m: MutationScope) -> None:
        m.require_before()
        repo = m.uow.repo(ALIASES)
        row = repo.get(alias_id)
        if row is None:
            raise NotFound("No alias with that id.", "aliasId")
        out = alias_out(row)
        repo.delete(row)
        m.uow.record(
            "alias.deleted",
            [ref("alias", alias_id), ref(out.entity_type, out.entity_id)],
            {"alias": out.alias},
        )

    return run_mutation(uow_factory, clock, change, track_movements=False).out()
