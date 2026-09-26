"""Tell Remi: parse, cancel, preview and apply a check-in."""

from fastapi import APIRouter, Request, Response, status
from starlette.concurrency import run_in_threadpool

from app.api.deps import WiringDep, get_config
from app.api.endpoints._params import ParseId
from app.api.errors import error_responses
from app.schemas.checkin import ApplyRequest, ParseRequest, PreviewOut, PreviewRequest, ProposalOut
from app.schemas.mutation import CheckinMutationOut
from app.services import checkins as service

router = APIRouter(tags=["checkins"])


@router.post(
    "/checkins/parse",
    summary="Turn an update into proposed changes with the configured provider",
    responses=error_responses(404, 409, 422, 502, 503, 504),
)
async def parse_checkin(body: ParseRequest, request: Request, wiring: WiringDep) -> ProposalOut:
    """The ``none`` provider (the default) answers with the simple reading
    (``source: "simple"``). Cancelled by ``DELETE /checkins/parse/{parseId}`` or a client
    disconnect. Errors: 502 ``AI_AUTH``/``AI_BAD_REPLY``/``AI_UNAVAILABLE``, 503
    ``AI_RATE_LIMITED``, 504 ``AI_TIMEOUT``, 409 ``AI_NOT_CONFIGURED``/``PARSE_CANCELLED``;
    404 for an unknown ``focusProjectId``."""
    uow_factory, clock = wiring.uow_factory, wiring.clock
    inputs = await run_in_threadpool(
        service.parse_inputs, uow_factory, clock, body.focus_project_id
    )
    return await service.parse(
        uow_factory,
        clock,
        get_config(request).env,
        body,
        inputs,
        is_disconnected=request.is_disconnected,
    )


@router.post(
    "/checkins/parse-simple",
    summary="Turn an update into proposed changes offline (the simple reading)",
    responses=error_responses(404, 409, 422),
)
def parse_checkin_simple(body: ParseRequest, wiring: WiringDep) -> ProposalOut:
    return service.parse_simple(wiring.uow_factory, wiring.clock, body)


@router.delete(
    "/checkins/parse/{parseId}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Cancel an in-flight parse",
    responses=error_responses(422),
)
def cancel_parse(parse_id: ParseId) -> None:
    """Idempotent: an unknown or finished parse is also a 204."""
    service.cancel_parse(parse_id)


@router.post(
    "/checkins/preview",
    summary="The forecast effect of the ticked changes (same maths as apply)",
    responses=error_responses(404, 409, 422),
)
def preview_checkin(body: PreviewRequest, wiring: WiringDep) -> PreviewOut:
    """Runs the apply itself in a transaction that is always rolled back, so the preview is
    exactly what ``/checkins/apply`` would save."""
    return service.preview_checkin(wiring.uow_factory, wiring.clock, body)


@router.post(
    "/checkins/apply",
    summary="Apply the ticked changes in one transaction",
    responses=error_responses(404, 409, 422),
)
def apply_checkin(body: ApplyRequest, wiring: WiringDep) -> CheckinMutationOut:
    """One ``checkin.applied`` event; one check-in row per project, sharing ``batchId``.
    404 for an unknown project, task or routine; 422 for a task of another project or a
    routine that does not run today (``NOT_AN_OCCURRENCE``)."""
    return service.apply_checkin(wiring.uow_factory, wiring.clock, body)
