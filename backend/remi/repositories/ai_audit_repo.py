"""``AiAuditRepository``: the provider-call audit log (``ai_audit``).

Audit rows are a log, not plan state, so writing one needs no ``remi_events`` row: use it from
any unit of work (``dry_run`` excluded, which always rolls back). API keys are never stored.
"""

import builtins
import datetime as dt

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from remi.repositories.models import AiAudit


class AiAuditRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, row: AiAudit) -> AiAudit:
        self.session.add(row)
        return row

    def get(self, audit_id: str) -> AiAudit | None:
        return self.session.get(AiAudit, audit_id)

    def for_parse(self, parse_id: str) -> builtins.list[AiAudit]:
        stmt = select(AiAudit).where(AiAudit.parse_id == parse_id).order_by(AiAudit.created_at)
        return list(self.session.scalars(stmt))

    def list(self, limit: int = 50, before: str | None = None) -> builtins.list[AiAudit]:
        """Newest first. ``before`` is the id of the last row of the previous page."""
        stmt = select(AiAudit)
        if before is not None:
            anchor = self.get(before)
            if anchor is not None:
                stmt = stmt.where(
                    or_(
                        AiAudit.created_at < anchor.created_at,
                        (AiAudit.created_at == anchor.created_at) & (AiAudit.id < anchor.id),
                    )
                )
        stmt = stmt.order_by(AiAudit.created_at.desc(), AiAudit.id.desc()).limit(limit)
        return list(self.session.scalars(stmt))

    def purge_before(self, cutoff: dt.datetime) -> int:
        """Delete rows created before ``cutoff`` (retention). Returns how many."""
        result = self.session.execute(delete(AiAudit).where(AiAudit.created_at < cutoff))
        return int(getattr(result, "rowcount", 0) or 0)
