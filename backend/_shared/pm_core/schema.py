"""
Database schema migrations and demo seed data.

Migrations run from inside the Lambda on cold start because AWS Aurora is not
reachable from the developer machine. They are idempotent: each version is
recorded in ``schema_version`` and a Postgres advisory lock stops concurrent
cold starts from racing each other.
"""

import json
import logging
import re
from collections.abc import Callable

import psycopg

from pm_core import config, identity, passwords

logger = logging.getLogger(__name__)

# Arbitrary constant used as the advisory lock key for migrations.
_MIGRATION_LOCK_KEY = 727_001

# Old-style IDs (role prefix + number) from before the initials-based format.
OLD_STYLE_ID = re.compile(r"^(ADM|MGR|EMP)[0-9]+$")
# The three demo accounts keep fixed IDs (documented in the README, used by tests).
LEGACY_DEMO_IDS = {"ADM001": "AA7K2P", "MGR001": "MM4R8T", "EMP001": "EE3H9W"}


def _convert_employee_ids(cur: psycopg.Cursor) -> None:
    """
    Migration 5: give every old-style employee ID (e.g. MGR002) a new-format one.

    Each change is recorded in the audit log and the old -> new mapping is logged
    once, privately, so admins can tell people their new sign-in ID. Passwords
    are unchanged. Past audit entries keep the ID that was used at the time.
    """
    cur.execute("SELECT id, employee_id, first_name, last_name FROM users ORDER BY id")
    converted = []
    for row in cur.fetchall():
        old = row["employee_id"].upper()
        if not OLD_STYLE_ID.match(old):
            continue
        new = LEGACY_DEMO_IDS.get(old)
        cur.execute("SELECT 1 FROM users WHERE upper(employee_id) = %s", (new,))
        if new is None or new[:2] != identity.initials(row["first_name"], row["last_name"]) or cur.fetchone():
            new = identity.generate_employee_id(cur, row["first_name"], row["last_name"])
        cur.execute("UPDATE users SET employee_id = %s, updated_at = now() WHERE id = %s", (new, row["id"]))
        name = f"{row['first_name']} {row['last_name']}"
        # Written directly (pm_core.audit depends on db, which depends on this module).
        cur.execute(
            """
            INSERT INTO audit_log (actor_employee_id, actor_name, action, entity_type, entity_id, summary, changes)
            VALUES ('SYSTEM', 'Data migration', 'user.employee_id_changed', 'user', %s, %s, %s::jsonb)
            """,
            (
                row["id"],
                f"Changed {name}'s employee ID from {row['employee_id']} to {new} (new ID format)",
                json.dumps({"employee_id": {"from": row["employee_id"], "to": new}}),
            ),
        )
        converted.append(f"{row['employee_id']} -> {new}")
    if converted:
        logger.warning("Employee IDs converted to the new format: %s", ", ".join(converted))


MIGRATIONS: list[tuple[int, str | Callable[[psycopg.Cursor], None]]] = [
    (
        1,
        """
        CREATE TABLE app_settings (
            key   VARCHAR(100) PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE users (
            id            BIGSERIAL PRIMARY KEY,
            employee_id   VARCHAR(20)  NOT NULL UNIQUE,
            first_name    VARCHAR(100) NOT NULL,
            last_name     VARCHAR(100) NOT NULL,
            email         VARCHAR(254) NOT NULL,
            job_title     VARCHAR(120) NOT NULL DEFAULT '',
            salary        NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (salary >= 0),
            role          VARCHAR(10)  NOT NULL CHECK (role IN ('admin', 'manager', 'employee')),
            manager_id    BIGINT REFERENCES users (id),
            password_hash TEXT NOT NULL,
            is_active     BOOLEAN NOT NULL DEFAULT TRUE,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            CHECK (manager_id IS NULL OR manager_id <> id)
        );
        CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

        CREATE TABLE projects (
            id                 BIGSERIAL PRIMARY KEY,
            name               VARCHAR(200) NOT NULL,
            description        TEXT NOT NULL DEFAULT '',
            start_date         DATE NOT NULL,
            predicted_end_date DATE NOT NULL,
            manager_id         BIGINT NOT NULL REFERENCES users (id),
            budget             NUMERIC(14, 2) NOT NULL CHECK (budget >= 0),
            status             VARCHAR(20) NOT NULL DEFAULT 'planned'
                               CHECK (status IN ('planned', 'active', 'on_hold', 'completed')),
            is_archived        BOOLEAN NOT NULL DEFAULT FALSE,
            archived_at        TIMESTAMPTZ,
            created_by         BIGINT REFERENCES users (id),
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            CHECK (predicted_end_date >= start_date)
        );
        CREATE INDEX projects_manager_idx ON projects (manager_id);

        CREATE TABLE project_assignments (
            id             BIGSERIAL PRIMARY KEY,
            project_id     BIGINT NOT NULL REFERENCES projects (id),
            user_id        BIGINT NOT NULL REFERENCES users (id),
            hours_per_week NUMERIC(4, 1) NOT NULL CHECK (hours_per_week > 0 AND hours_per_week <= 40),
            assigned_by    BIGINT REFERENCES users (id),
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (project_id, user_id)
        );
        CREATE INDEX project_assignments_user_idx ON project_assignments (user_id);

        CREATE TABLE milestones (
            id           BIGSERIAL PRIMARY KEY,
            project_id   BIGINT NOT NULL REFERENCES projects (id),
            title        VARCHAR(200) NOT NULL,
            description  TEXT NOT NULL DEFAULT '',
            start_date   DATE NOT NULL,
            due_date     DATE NOT NULL,
            status       VARCHAR(20) NOT NULL DEFAULT 'not_started'
                         CHECK (status IN ('not_started', 'in_progress', 'completed', 'blocked')),
            completed_at TIMESTAMPTZ,
            created_by   BIGINT REFERENCES users (id),
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            CHECK (due_date >= start_date)
        );
        CREATE INDEX milestones_project_idx ON milestones (project_id);

        CREATE TABLE milestone_dependencies (
            milestone_id  BIGINT NOT NULL REFERENCES milestones (id) ON DELETE CASCADE,
            depends_on_id BIGINT NOT NULL REFERENCES milestones (id) ON DELETE CASCADE,
            PRIMARY KEY (milestone_id, depends_on_id),
            CHECK (milestone_id <> depends_on_id)
        );

        CREATE TABLE project_requests (
            id                 BIGSERIAL PRIMARY KEY,
            requested_by       BIGINT NOT NULL REFERENCES users (id),
            name               VARCHAR(200) NOT NULL,
            description        TEXT NOT NULL DEFAULT '',
            start_date         DATE NOT NULL,
            predicted_end_date DATE NOT NULL,
            budget             NUMERIC(14, 2) NOT NULL CHECK (budget >= 0),
            justification      TEXT NOT NULL DEFAULT '',
            status             VARCHAR(10) NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'approved', 'rejected')),
            reviewed_by        BIGINT REFERENCES users (id),
            reviewed_at        TIMESTAMPTZ,
            review_note        TEXT NOT NULL DEFAULT '',
            project_id         BIGINT REFERENCES projects (id),
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            CHECK (predicted_end_date >= start_date)
        );

        CREATE TABLE audit_log (
            id                BIGSERIAL PRIMARY KEY,
            occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            actor_id          BIGINT REFERENCES users (id),
            actor_employee_id VARCHAR(20),
            actor_name        VARCHAR(201),
            actor_role        VARCHAR(10),
            action            VARCHAR(60) NOT NULL,
            entity_type       VARCHAR(40) NOT NULL,
            entity_id         BIGINT,
            project_id        BIGINT,
            summary           TEXT NOT NULL,
            changes           JSONB NOT NULL DEFAULT '{}'::jsonb,
            outcome           VARCHAR(10) NOT NULL DEFAULT 'success'
                              CHECK (outcome IN ('success', 'denied'))
        );
        CREATE INDEX audit_log_occurred_idx ON audit_log (occurred_at DESC);
        CREATE INDEX audit_log_actor_idx ON audit_log (actor_id);
        CREATE INDEX audit_log_project_idx ON audit_log (project_id);
        CREATE INDEX audit_log_action_idx ON audit_log (action);

        -- The audit log is append-only: block UPDATE, DELETE and TRUNCATE at the database level.
        CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'audit_log is append-only';
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER audit_log_no_modify
            BEFORE UPDATE OR DELETE ON audit_log
            FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
        CREATE TRIGGER audit_log_no_truncate
            BEFORE TRUNCATE ON audit_log
            FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
        """,
    ),
    (
        2,
        # Cross-team hours approval. A new pending assignment holds its requested
        # hours in hours_per_week; a pending *increase* on an approved assignment
        # keeps the approved hours and holds the requested figure in pending_hours.
        # Reserved hours (counted for the 40-hour and budget rules) are
        # COALESCE(pending_hours, hours_per_week).
        """
        ALTER TABLE project_assignments
            ADD COLUMN status        VARCHAR(10) NOT NULL DEFAULT 'approved'
                                     CHECK (status IN ('approved', 'pending')),
            ADD COLUMN pending_hours NUMERIC(4, 1)
                                     CHECK (pending_hours IS NULL OR (pending_hours > 0 AND pending_hours <= 40)),
            ADD COLUMN requested_by  BIGINT REFERENCES users (id),
            ADD COLUMN requested_at  TIMESTAMPTZ,
            ADD CONSTRAINT pending_assignment_has_no_pending_increase
                CHECK (status = 'approved' OR pending_hours IS NULL);

        CREATE INDEX project_assignments_awaiting_idx ON project_assignments (user_id)
            WHERE status = 'pending' OR pending_hours IS NOT NULL;
        """,
    ),
    (
        3,
        # Project requests: managers can withdraw their own pending requests.
        """
        ALTER TABLE project_requests DROP CONSTRAINT project_requests_status_check;
        ALTER TABLE project_requests
            ADD CONSTRAINT project_requests_status_check
                CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn'));
        CREATE INDEX project_requests_status_idx ON project_requests (status, created_at);
        """,
    ),
    (
        4,
        # Set by the scheduled budget monitor when a project is first seen over
        # budget, cleared when it is back within budget, so each change is
        # reported once rather than on every run.
        """
        ALTER TABLE projects ADD COLUMN over_budget_since TIMESTAMPTZ;
        """,
    ),
    # Employee IDs become initials + 4 random characters (see pm_core.identity).
    (5, _convert_employee_ids),
    (
        6,
        # Accounts created (or passwords reset) by an admin must choose their own
        # password at first sign-in. Existing accounts are left as they are.
        """
        ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
        """,
    ),
]

# Demo accounts created on an empty database.
#
# ``local_password`` values are documented in the README and are ONLY used
# when IS_LOCAL is true (LocalStack). In the cloud every demo account gets a
# random password instead, logged once to the Lambda's private CloudWatch log,
# so the public source code never contains a usable cloud credential.
DEMO_USERS: list[dict] = [
    {
        "employee_id": "AA7K2P", "first_name": "Alex", "last_name": "Admin",
        "email": "alex.admin@example.com", "job_title": "Administrator",
        "salary": 120000, "role": "admin",
        "local_password": "Admin1",  # nosec B105 - local-only demo credential (see above)
    },
    {
        "employee_id": "MM4R8T", "first_name": "Morgan", "last_name": "Manager",
        "email": "morgan.manager@example.com", "job_title": "Engineering Manager",
        "salary": 110000, "role": "manager",
        "local_password": "Mngr01",  # nosec B105 - local-only demo credential (see above)
    },
    {
        "employee_id": "EE3H9W", "first_name": "Eli", "last_name": "Employee",
        "email": "eli.employee@example.com", "job_title": "Software Engineer",
        "salary": 90000, "role": "employee",
        "local_password": "Empl01",  # nosec B105 - local-only demo credential (see above)
        "manager_employee_id": "MM4R8T",
    },
]


def ensure_schema(conn: psycopg.Connection) -> None:
    """Apply any pending migrations and seed demo data on an empty database."""
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (_MIGRATION_LOCK_KEY,))
        cur.execute(
            "CREATE TABLE IF NOT EXISTS schema_version ("
            " version INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        )
        cur.execute("SELECT COALESCE(MAX(version), 0) AS version FROM schema_version")
        current = cur.fetchone()["version"]
        for version, sql in MIGRATIONS:
            if version > current:
                logger.info("Applying schema migration %s", version)
                if callable(sql):
                    sql(cur)  # a Python migration step
                else:
                    cur.execute(sql)
                cur.execute("INSERT INTO schema_version (version) VALUES (%s)", (version,))
        _seed_demo_users(cur)


def _seed_demo_users(cur: psycopg.Cursor) -> None:
    """
    Insert the demo accounts if the users table is empty.

    Locally the documented demo passwords are used. In the cloud each account
    gets a random password, logged once so the deployer can sign in as the
    admin and reset the others from the Users page.
    """
    cur.execute("SELECT EXISTS (SELECT 1 FROM users) AS has_users")
    if cur.fetchone()["has_users"]:
        return
    local = config.is_local()
    logger.info("Seeding demo users (%s passwords)", "documented local" if local else "random")
    ids: dict[str, int] = {}
    generated: dict[str, str] = {}
    for user in DEMO_USERS:
        manager_id = ids.get(user.get("manager_employee_id", ""))
        password = user["local_password"] if local else passwords.generate_password()
        if not local:
            generated[user["employee_id"]] = password
        cur.execute(
            """
            INSERT INTO users (employee_id, first_name, last_name, email, job_title,
                               salary, role, manager_id, password_hash)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                user["employee_id"], user["first_name"], user["last_name"], user["email"],
                user["job_title"], user["salary"], user["role"], manager_id,
                passwords.hash_password(password),
            ),
        )
        ids[user["employee_id"]] = cur.fetchone()["id"]
    if generated:
        # Logged exactly once (seeding only happens on an empty database) to the
        # Lambda's CloudWatch log, which is private to the AWS account.
        logger.warning(
            "Demo accounts created with one-time passwords - sign in as AA7K2P and reset the others: %s",
            ", ".join(f"{employee_id}={password}" for employee_id, password in generated.items()),
        )
