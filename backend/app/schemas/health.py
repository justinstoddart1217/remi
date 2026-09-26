"""Liveness probe DTO."""

from typing import Literal

from pydantic import ConfigDict

from app.schemas.base import CamelModel


class HealthOut(CamelModel):
    """Liveness probe. ``app`` lets the CLI recognise an already-running Remi."""

    model_config = ConfigDict(frozen=True)

    app: Literal["remi"] = "remi"
    version: str
