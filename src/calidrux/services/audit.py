"""Append-only audit log service."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from calidrux.config import config
from calidrux.db.models.audit_log import AuditLog


def log_action(
    session: Session,
    *,
    entity_type: str,
    action: str,
    entity_id: int | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    user_name: str | None = None,
    notes: str | None = None,
) -> AuditLog:
    entry = AuditLog(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        before_state=before,
        after_state=after,
        user_name=user_name or config.settings.user_name,
        notes=notes,
    )
    session.add(entry)
    return entry


def list_audit_logs(session: Session, limit: int = 500) -> list[AuditLog]:
    return (
        session.query(AuditLog)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
