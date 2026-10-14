"""Tests for pm_core.audit: diffing/redaction (unit) and persistence (database)."""

from datetime import date
from decimal import Decimal

import psycopg
import pytest

from pm_core import audit, db
from pm_core.audit import Actor

ACTOR = Actor(id=1, employee_id="ADM001", name="Alex Admin", role="admin")


def test_diff_reports_only_changed_fields() -> None:
    before = {"name": "Apollo", "budget": Decimal("100.00"), "start_date": date(2026, 1, 1)}
    after = {"name": "Apollo", "budget": Decimal("150.00"), "start_date": date(2026, 2, 1)}
    assert audit.diff(before, after) == {
        "budget": {"from": 100.0, "to": 150.0},
        "start_date": {"from": "2026-01-01", "to": "2026-02-01"},
    }


def test_diff_hides_secrets_and_redacts_salary() -> None:
    changes = audit.diff(
        {"password_hash": "a", "salary": Decimal("1"), "updated_at": "x"},
        {"password_hash": "b", "salary": Decimal("2"), "updated_at": "y"},
    )
    assert changes == {"salary": {"from": "[redacted]", "to": "[redacted]"}}


def test_diff_of_created_record() -> None:
    assert audit.diff(None, {"name": "New"}) == {"name": {"from": None, "to": "New"}}


@pytest.mark.db
def test_record_writes_entry_in_same_transaction(fresh_db: None) -> None:
    with db.transaction() as cur:
        audit.record(
            cur,
            ACTOR,
            "project.update",
            "project",
            5,
            "Updated project Apollo",
            before={"name": "A"},
            after={"name": "B"},
            project_id=5,
        )
    with db.transaction() as cur:
        cur.execute("SELECT * FROM audit_log")
        row = cur.fetchone()
    assert row["actor_employee_id"] == "ADM001"
    assert row["actor_name"] == "Alex Admin"
    assert row["action"] == "project.update"
    assert row["changes"] == {"name": {"from": "A", "to": "B"}}
    assert row["outcome"] == "success"
    assert row["occurred_at"] is not None


@pytest.mark.db
def test_audit_entry_rolls_back_with_failed_change(fresh_db: None) -> None:
    with pytest.raises(RuntimeError), db.transaction() as cur:
        audit.record(cur, ACTOR, "project.update", "project", 5, "Will roll back")
        raise RuntimeError("change failed")
    with db.transaction() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM audit_log")
        assert cur.fetchone()["n"] == 0


@pytest.mark.db
def test_record_denied_survives_and_supports_anonymous(fresh_db: None) -> None:
    audit.record_denied(None, "auth.login", "user", None, "Failed login", actor_employee_id="BAD01")
    with db.transaction() as cur:
        cur.execute("SELECT actor_id, actor_employee_id, outcome FROM audit_log")
        assert cur.fetchone() == {"actor_id": None, "actor_employee_id": "BAD01", "outcome": "denied"}


@pytest.mark.db
@pytest.mark.parametrize(
    "statement",
    ["UPDATE audit_log SET summary = 'tampered'", "DELETE FROM audit_log", "TRUNCATE audit_log"],
)
def test_audit_log_is_append_only(fresh_db: None, statement: str) -> None:
    with db.transaction() as cur:
        audit.record(cur, ACTOR, "user.create", "user", 1, "Created user")
    with pytest.raises(psycopg.errors.RaiseException), db.transaction() as cur:
        cur.execute(statement)
