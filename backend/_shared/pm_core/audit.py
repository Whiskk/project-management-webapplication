"""
Append-only audit trail.

``record`` must be called with the *same cursor* used for the change it
describes, so the change and its audit entry commit (or roll back) together.
``record_denied`` uses its own connection because the denied request's
transaction is rolled back.
"""

import json
import logging
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import psycopg

from pm_core import db

logger = logging.getLogger(__name__)
# Fields never written to the audit log.
_HIDDEN_FIELDS = {"password_hash", "password"}
# Fields whose change is recorded, but not their values.
_REDACTED_FIELDS = {"salary"}
_REDACTED = "[redacted]"
# Bookkeeping fields that change on every update and add noise to diffs.
_IGNORED_FIELDS = {"updated_at", "created_at"}


@dataclass(frozen=True)
class Actor:
    """The authenticated user performing an action."""

    id: int
    employee_id: str
    name: str
    role: str


def _normalise(value: Any) -> Any:
    """Make values JSON-friendly and comparable."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def diff(before: dict | None, after: dict | None) -> dict[str, dict[str, Any]]:
    """
    Return ``{field: {"from": old, "to": new}}`` for fields that changed.

    Secret fields are omitted entirely and sensitive fields (salary) have
    their values replaced with ``[redacted]``.
    """
    before = before or {}
    after = after or {}
    changes: dict[str, dict[str, Any]] = {}
    for key in sorted(set(before) | set(after)):
        if key in _HIDDEN_FIELDS or key in _IGNORED_FIELDS:
            continue
        old, new = _normalise(before.get(key)), _normalise(after.get(key))
        if old == new:
            continue
        if key in _REDACTED_FIELDS:
            old = _REDACTED if key in before else None
            new = _REDACTED if key in after else None
        changes[key] = {"from": old, "to": new}
    return changes


def record(
    cur: psycopg.Cursor,
    actor: Actor | None,
    action: str,
    entity_type: str,
    entity_id: int | None,
    summary: str,
    before: dict | None = None,
    after: dict | None = None,
    project_id: int | None = None,
    outcome: str = "success",
    actor_employee_id: str | None = None,
) -> None:
    """
    Write one audit entry using the caller's cursor (same transaction).

    Args:
        cur: Cursor from the transaction that performed the change.
        actor: Who performed the action (None for anonymous, e.g. failed login).
        action: Dotted action name, e.g. ``project.archive``.
        entity_type: Kind of record affected, e.g. ``project``.
        entity_id: Id of the affected record, if any.
        summary: Human-readable sentence describing the action.
        before: Record state before the change (for diffs).
        after: Record state after the change (for diffs).
        project_id: Related project, so the project History tab can filter.
        outcome: ``success`` or ``denied``.
        actor_employee_id: Employee id to record when there is no actor
            (e.g. the id typed in a failed login).
    """
    cur.execute(
        """
        INSERT INTO audit_log (actor_id, actor_employee_id, actor_name, actor_role, action,
                               entity_type, entity_id, project_id, summary, changes, outcome)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
        """,
        (
            actor.id if actor else None,
            actor.employee_id if actor else actor_employee_id,
            actor.name if actor else None,
            actor.role if actor else None,
            action,
            entity_type,
            entity_id,
            project_id,
            summary,
            json.dumps(diff(before, after)),
            outcome,
        ),
    )


def record_denied(
    actor: Actor | None,
    action: str,
    entity_type: str,
    entity_id: int | None,
    summary: str,
    project_id: int | None = None,
    actor_employee_id: str | None = None,
) -> None:
    """
    Record a denied attempt on its own connection, so it is kept even if it
    happens inside a request transaction that is about to roll back.
    """
    try:
        with db.independent_transaction() as cur:
            record(
                cur, actor, action, entity_type, entity_id, summary,
                project_id=project_id, outcome="denied", actor_employee_id=actor_employee_id,
            )
    except psycopg.Error:
        # The request is still refused; losing this one audit entry must not
        # turn a 403 into a 500 or a hang. The log line keeps a record of it.
        logger.exception("Could not audit denied attempt: %s", summary)
