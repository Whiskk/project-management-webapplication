"""Database tests for schema migrations, seed data and the health service."""

import pytest

from conftest import load_service, make_event, response_json
from pm_core import db, passwords, schema

pytestmark = pytest.mark.db


def test_migrations_create_all_tables(fresh_db: None) -> None:
    with db.transaction() as cur:
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        tables = {row["table_name"] for row in cur.fetchall()}
    assert {
        "schema_version",
        "app_settings",
        "users",
        "projects",
        "project_assignments",
        "milestones",
        "milestone_dependencies",
        "project_requests",
        "audit_log",
    } <= tables


def test_ensure_schema_is_idempotent(fresh_db: None) -> None:
    conn = db.get_connection()
    schema.ensure_schema(conn)
    schema.ensure_schema(conn)
    with db.transaction() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM schema_version")
        assert cur.fetchone()["n"] == len(schema.MIGRATIONS)
        cur.execute("SELECT COUNT(*) AS n FROM users")
        assert cur.fetchone()["n"] == len(schema.DEMO_USERS)


def test_demo_users_are_seeded_with_hashed_passwords(fresh_db: None) -> None:
    with db.transaction() as cur:
        cur.execute(
            "SELECT u.employee_id, u.role, u.password_hash, m.employee_id AS manager "
            "FROM users u LEFT JOIN users m ON m.id = u.manager_id ORDER BY u.id"
        )
        rows = cur.fetchall()
    assert [(r["employee_id"], r["role"]) for r in rows] == [
        ("ADM001", "admin"),
        ("MGR001", "manager"),
        ("EMP001", "employee"),
    ]
    assert rows[2]["manager"] == "MGR001"
    for row, demo in zip(rows, schema.DEMO_USERS, strict=True):
        assert demo["local_password"] not in row["password_hash"]
        assert passwords.verify_password(demo["local_password"], row["password_hash"])


def test_cloud_seed_uses_random_passwords_logged_once(
    fresh_db: None, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(schema.config, "is_local", lambda: False)
    with db.transaction() as cur:
        cur.execute("DELETE FROM users")
        schema._seed_demo_users(cur)
        cur.execute("SELECT employee_id, password_hash FROM users ORDER BY id")
        rows = cur.fetchall()

    [message] = [r.getMessage() for r in caplog.records if "one-time passwords" in r.getMessage()]
    for row, demo in zip(rows, schema.DEMO_USERS, strict=True):
        # The documented local password must never work in the cloud...
        assert not passwords.verify_password(demo["local_password"], row["password_hash"])
        # ...but the logged one-time password does.
        logged = message.split(f"{row['employee_id']}=")[1][:6]
        assert passwords.verify_password(logged, row["password_hash"])


def test_email_uniqueness_is_case_insensitive(fresh_db: None) -> None:
    import psycopg

    with pytest.raises(psycopg.errors.UniqueViolation), db.transaction() as cur:
        cur.execute(
            "INSERT INTO users (employee_id, first_name, last_name, email, role, password_hash) "
            "VALUES ('X1', 'A', 'B', 'ALEX.ADMIN@EXAMPLE.COM', 'employee', 'x')"
        )


def test_health_endpoint_reports_schema_version(fresh_db: None) -> None:
    health = load_service("health")
    response = health.handler(make_event("GET", "/api/health"))
    assert response["statusCode"] == 200
    assert response_json(response) == {
        "status": "ok",
        "database": "ok",
        "schema_version": len(schema.MIGRATIONS),
    }
