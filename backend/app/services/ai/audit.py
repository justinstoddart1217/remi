"""The ``ai_audit`` log: one row per provider call, exactly as sent and received.

``AuditRecord`` is what the registry produces; an ``AuditSink`` stores it. The default sink,
``uow_audit_sink``, writes through the ORM model inside its own unit of work (``ai_audit`` is
a log, so it needs no ``remi_events`` row) and prunes rows older than the retention period
(Settings ``ai_audit_retention_days``, 90 by default).

Rows hold the context and system prompt that were sent, the update text, the raw reply, the
validated proposal, what ``validate()`` dropped, latency, status and token counts. They never
hold an API key.

``list_audit`` serves ``GET /ai/audit`` (newest first, cursor = the last row's id).
"""

import json
import logging
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, Final, cast, get_args

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ValidationFailed
from app.core.uow import UnitOfWorkFactory
from app.repositories.models.ai import AiAudit
from app.schemas.ai import AiAuditOut, AiAuditPageOut, AiAuditStatus
from app.schemas.settings import AiProvider
from app.services.ai.base import AuditStatus

logger = logging.getLogger(__name__)

DEFAULT_RETENTION_DAYS: Final = 90
_PROVIDERS: Final = frozenset(get_args(AiProvider))
_STATUSES: Final = frozenset(get_args(AiAuditStatus))


@dataclass(frozen=True, slots=True)
class AuditRecord:
    parse_id: str
    provider: AiProvider
    model: str | None
    sent: Mapping[str, object]
    """``{"system": ..., "context": ...}``: exactly what went with the update text."""
    text: str
    status: AuditStatus
    latency_ms: int
    response_raw: str | None = None
    proposal: Mapping[str, object] | None = None
    dropped: Sequence[Mapping[str, object]] = field(default_factory=tuple[Mapping[str, object]])
    error_code: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None


AuditSink = Callable[[AuditRecord], None]


def _jsonable(value: object) -> Any:
    """Round-trip through JSON so dates and tuples store cleanly."""
    return json.loads(json.dumps(value, default=str, ensure_ascii=False))


def to_row(record: AuditRecord) -> AiAudit:
    return AiAudit(
        parse_id=record.parse_id,
        provider=record.provider,
        model=record.model,
        context_json=_jsonable(dict(record.sent)),
        text=record.text,
        response_raw=record.response_raw,
        proposal_json=_jsonable(dict(record.proposal)) if record.proposal is not None else None,
        dropped_json=_jsonable([dict(d) for d in record.dropped]),
        latency_ms=record.latency_ms,
        status=record.status,
        error_code=record.error_code,
        input_tokens=record.input_tokens,
        output_tokens=record.output_tokens,
    )


def uow_audit_sink(
    uow_factory: UnitOfWorkFactory, *, retention_days: int = DEFAULT_RETENTION_DAYS
) -> AuditSink:
    """A sink that inserts the row and prunes rows past ``retention_days``."""

    def write(record: AuditRecord) -> None:
        with uow_factory("system") as uow:
            session = uow.session
            session.add(to_row(record))
            cutoff = uow.clock.now() - timedelta(days=max(1, retention_days))
            session.execute(delete(AiAudit).where(AiAudit.created_at < cutoff))

    return write


def safe_write(sink: AuditSink, record: AuditRecord) -> None:
    """Store ``record``; an audit failure is logged (without content) and never raised."""
    try:
        sink(record)
    except Exception as exc:
        logger.warning(
            "could not write the ai_audit row for parse %s (%s)",
            record.parse_id,
            type(exc).__name__,
        )


# ---------------------------------------------------------------- reading


def to_out(row: AiAudit) -> AiAuditOut:
    provider = cast("AiProvider", row.provider if row.provider in _PROVIDERS else "none")
    status = cast("AiAuditStatus", row.status if row.status in _STATUSES else "error")
    return AiAuditOut(
        id=row.id,
        parse_id=row.parse_id,
        created_at=row.created_at,
        provider=provider,
        model=row.model,
        status=status,
        error_code=row.error_code,
        latency_ms=row.latency_ms,
        input_tokens=row.input_tokens,
        output_tokens=row.output_tokens,
        text=row.text,
        context=row.context_json,
        response_raw=row.response_raw,
        proposal=row.proposal_json,
        dropped=[
            cast("dict[str, Any]", d) for d in (row.dropped_json or []) if isinstance(d, dict)
        ],
    )


def list_audit(session: Session, *, limit: int = 50, before: str | None = None) -> AiAuditPageOut:
    """Newest first. ``before`` is the ``nextBefore`` of the previous page (a row id)."""
    stmt = select(AiAudit).order_by(AiAudit.created_at.desc(), AiAudit.id.desc())
    if before is not None:
        anchor = session.get(AiAudit, before)
        if anchor is None:
            msg = "Unknown cursor; start again without `before`."
            raise ValidationFailed(msg, field="before")
        stmt = stmt.where(
            or_(
                AiAudit.created_at < anchor.created_at,
                and_(AiAudit.created_at == anchor.created_at, AiAudit.id < anchor.id),
            )
        )
    rows = list(session.scalars(stmt.limit(limit + 1)))
    page = rows[:limit]
    next_before = page[-1].id if len(rows) > limit and page else None
    return AiAuditPageOut(items=[to_out(r) for r in page], next_before=next_before)
