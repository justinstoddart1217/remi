"""Dev/test-only request bodies."""

from typing import Literal

from app.schemas.base import CamelIn

FixtureName = Literal["design", "empty"]
"""``design``: the prototype's sample plan.
``empty``: a fresh database that still needs first-run setup."""


class DevFixturesIn(CamelIn):
    fixture: FixtureName = "design"
