from fastapi import APIRouter

from remi import __version__
from remi.schemas.health import HealthOut

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthOut, summary="Liveness probe (identifies Remi)")
def get_health() -> HealthOut:
    return HealthOut(version=__version__)
