"""Entity aliases (data only; used by Notes tags, the simple reading and the palette)."""

from fastapi import APIRouter, status

from remi.api.deps import ClockDep, UowFactoryDep
from remi.api.endpoints._params import AliasId
from remi.api.errors import error_responses
from remi.schemas.aliases import AliasCreate, AliasOut
from remi.schemas.mutation import AliasMutationOut, MutationOut
from remi.services import aliases as service

router = APIRouter(tags=["aliases"])


@router.get("/aliases", summary="Every stored alias")
def list_aliases(uow_factory: UowFactoryDep) -> list[AliasOut]:
    return service.list_aliases(uow_factory)


@router.post(
    "/aliases",
    status_code=status.HTTP_201_CREATED,
    summary="Add an alias to a project or routine",
    responses=error_responses(404, 409, 422),
)
def create_alias(
    body: AliasCreate, uow_factory: UowFactoryDep, clock: ClockDep
) -> AliasMutationOut:
    """Stored lower-case with single spaces. 404 for an unknown entity, 409 when it already
    has the alias."""
    return service.create_alias(uow_factory, clock, body)


@router.delete(
    "/aliases/{aliasId}",
    summary="Remove an alias",
    responses=error_responses(404, 409, 422),
)
def delete_alias(alias_id: AliasId, uow_factory: UowFactoryDep, clock: ClockDep) -> MutationOut:
    return service.delete_alias(uow_factory, clock, alias_id)
