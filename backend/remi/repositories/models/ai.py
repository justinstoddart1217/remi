"""``ai_audit``: exactly what each check-in parse sent and received (kept 90 days by default).

Audit rows are a log, not plan state: writing one does not need a ``remi_events`` row.
API keys are never stored here.
"""

from sqlalchemy import Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from remi.repositories.models.base import Base, CreatedAt, JSONDict, JSONList, UUIDPk


class AiAudit(UUIDPk, CreatedAt, Base):
    __tablename__ = "ai_audit"
    __table_args__ = (Index("ix_ai_audit_created_at", "created_at"),)

    parse_id: Mapped[str] = mapped_column(String(64), index=True)
    provider: Mapped[str] = mapped_column(String(16))
    model: Mapped[str | None] = mapped_column(String(120))
    context_json: Mapped[JSONDict | None]
    text: Mapped[str] = mapped_column(Text, default="")
    response_raw: Mapped[str | None] = mapped_column(Text)
    proposal_json: Mapped[JSONDict | None]
    dropped_json: Mapped[JSONList | None]
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16))
    error_code: Mapped[str | None] = mapped_column(String(32))
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
