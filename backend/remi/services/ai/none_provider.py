"""The ``none`` provider (the default): no AI at all.

``propose`` always raises ``AIDisabled``; the registry then answers with the engine's simple
reading (``source: "simple"``). Nothing is sent anywhere and nothing is audited.
"""

from typing import Final

from remi.schemas.settings import AiProvider
from remi.services.ai.base import AIDisabled, ParseRequest, RawProposal

NONE_TIMEOUT_S: Final = 1.0


class NoneProvider:
    @property
    def name(self) -> AiProvider:
        return "none"

    @property
    def model(self) -> str | None:
        return None

    @property
    def default_timeout_s(self) -> float:
        return NONE_TIMEOUT_S

    async def propose(self, req: ParseRequest) -> RawProposal:
        raise AIDisabled
