"""Tell Remi provider status and the audit log (data only)."""

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from remi.api.deps import UowFactoryDep
from remi.api.endpoints._params import BeforeQuery, LimitQuery
from remi.api.errors import error_responses
from remi.repositories.models.settings import SETTINGS_ID, Settings
from remi.schemas.ai import AiAuditPageOut, AiStatusOut
from remi.services.ai.audit import list_audit
from remi.services.ai.registry import AiSettings
from remi.services.ai.status import ai_status

router = APIRouter(tags=["ai"])


def _ai_settings(uow_factory: UowFactoryDep) -> AiSettings:
    with uow_factory.read() as uow:
        row = uow.session.get(Settings, SETTINGS_ID)
        return AiSettings.from_row(row) if row is not None else AiSettings()


@router.get("/ai/status", summary="Is the configured provider available?")
async def get_ai_status(uow_factory: UowFactoryDep) -> AiStatusOut:
    # Never calls off the machine: Anthropic is "available" when the SDK is installed and a
    # key is set; Ollama is probed on its loopback address. The settings read is a blocking
    # SQLite call, so it runs in the thread pool.
    settings = await run_in_threadpool(_ai_settings, uow_factory)
    return await ai_status(settings)


@router.get(
    "/ai/audit",
    summary="Provider calls, newest first (data only)",
    responses=error_responses(422),
)
def list_ai_audit(
    uow_factory: UowFactoryDep, limit: LimitQuery = 50, before: BeforeQuery = None
) -> AiAuditPageOut:
    with uow_factory.read() as uow:
        return list_audit(uow.session, limit=limit, before=before)
