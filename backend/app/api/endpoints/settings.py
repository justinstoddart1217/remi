"""User settings and the write-only AI key."""

from fastapi import APIRouter

from app.api.deps import ClockDep, UowFactoryDep
from app.api.errors import error_responses
from app.schemas.ai import AiKeyPut, AiStatusOut
from app.schemas.mutation import SettingsMutationOut
from app.schemas.settings import SettingsOut, SettingsPatch
from app.services import settings as settings_service

router = APIRouter(tags=["settings"])

_KEY_CHANGES_SETTINGS = (
    "Returns the new AI status, not the plan. The key does not shape the plan, but "
    "`aiKeyConfigured` in `GET /settings` and `PlanOut.settings` changes to the returned "
    "`keySet`: the client sets it from `keySet` in its cached plan and settings, or refetches."
)


@router.get("/settings", summary="Read settings (never includes an API key)")
def get_settings(uow_factory: UowFactoryDep) -> SettingsOut:
    return settings_service.get_settings(uow_factory)


@router.patch(
    "/settings",
    summary="Change settings; plan-shaping changes re-derive the plan",
    responses=error_responses(409, 422),
)
def update_settings(
    body: SettingsPatch, uow_factory: UowFactoryDep, clock: ClockDep
) -> SettingsMutationOut:
    return settings_service.update_settings(uow_factory, clock, body)


@router.put(
    "/settings/ai-key",
    summary="Store the Anthropic API key in the keychain (write-only)",
    description=_KEY_CHANGES_SETTINGS,
    responses=error_responses(409, 422),
)
def put_ai_key(body: AiKeyPut, uow_factory: UowFactoryDep) -> AiStatusOut:
    return settings_service.put_ai_key(uow_factory, body.api_key)


@router.delete(
    "/settings/ai-key",
    summary="Forget the stored Anthropic API key",
    description=_KEY_CHANGES_SETTINGS,
)
def delete_ai_key(uow_factory: UowFactoryDep) -> AiStatusOut:
    return settings_service.delete_ai_key(uow_factory)
