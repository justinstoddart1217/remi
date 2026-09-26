"""The ``/api`` routers and :func:`install_api`, which wires them into the app.

``api_router`` holds every endpoint group; ``dev_router`` holds the dev/test-only routes.
``create_app`` should call ``install_api(app, config)``, which also installs the error envelope
and the security middleware (see ``docs/requests/A2-contract.md``).
"""

from fastapi import FastAPI
from fastapi.routing import APIRoute, APIRouter

from remi.api.endpoints import (
    ai,
    aliases,
    calendar,
    charter,
    charts,
    checkins,
    dev,
    events,
    feed,
    health,
    milestones,
    notes,
    plan,
    projects,
    readiness,
    rotation,
    routines,
    settings,
    setup,
    tasks,
    textbook,
)
from remi.api.errors import install_error_handlers
from remi.api.middleware import DEV_ENVS, install_security
from remi.core.config import RemiConfig

API_PREFIX = "/api"

api_router = APIRouter(prefix=API_PREFIX)
for _group in (
    health,
    setup,
    settings,
    ai,
    calendar,
    plan,
    projects,
    charter,
    milestones,
    tasks,
    readiness,
    routines,
    rotation,
    checkins,
    notes,
    textbook,
    charts,
    feed,
    aliases,
    events,
):
    api_router.include_router(_group.router)

dev_router = APIRouter(prefix=API_PREFIX)
dev_router.include_router(dev.router)


def _is_mounted(app: FastAPI, router: APIRouter, probe_path: str) -> bool:
    """Whether ``router`` is already included in ``app``.

    FastAPI >= 0.140 keeps an included router as one wrapper route that points at the
    original router; older versions copy each route. Both shapes are recognised.
    """
    for route in app.routes:
        if getattr(route, "original_router", None) is router:
            return True
        if isinstance(route, APIRoute) and route.path == probe_path:
            return True
    return False


def install_api(app: FastAPI, config: RemiConfig) -> None:
    """Mount ``/api`` (plus the dev routes when ``env`` is dev or test), the error envelope
    and the security middleware. Idempotent, and safe if ``api_router`` is already mounted."""
    if getattr(app.state, "remi_api_installed", False):
        return
    if not _is_mounted(app, api_router, f"{API_PREFIX}/health"):
        app.include_router(api_router)
    if config.env in DEV_ENVS and not _is_mounted(app, dev_router, f"{API_PREFIX}/dev/fixtures"):
        app.include_router(dev_router)
    install_error_handlers(app)
    install_security(app, config)
    app.state.remi_api_installed = True
