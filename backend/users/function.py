"""
Users service: account management and self-service profile updates.

Routes (under /api/users):
    GET   /                       admin, manager  list users (filters: q, role, manager_id, status; paginated)
    POST  /                       admin           create a user (returns a one-time password)
    PATCH /me                     any role        update own first/last name and email
    GET   /{id}                   any role        view a user (employees: only themselves)
    PATCH /{id}                   admin, manager  update a user (managers: direct reports' basic info)
    POST  /{id}/reset-password    admin           generate a new one-time password
    POST  /{id}/deactivate        admin           deactivate (users are never deleted)
    POST  /{id}/reactivate        admin           reactivate

Salaries are only visible to admins and to a user's own manager.
"""

from typing import Any

import psycopg
from psycopg import sql

from pm_core import audit, passwords
from pm_core.audit import Actor
from pm_core.auth import ROLES, deny, require_auth
from pm_core.db import transaction
from pm_core.errors import Conflict, NotFound, ValidationError
from pm_core.http import Request, Response, Router, created, ok
from pm_core.validation import Field, parse_choice, parse_id, parse_pagination, validate

router = Router("users")

ID_PREFIXES = {"admin": "ADM", "manager": "MGR", "employee": "EMP"}
_EMPLOYEE_ID_LOCK_KEY = 727_002

PROFILE_FIELDS = {
    "first_name": Field("str", max_length=100),
    "last_name": Field("str", max_length=100),
    "email": Field("email", max_length=254),
}
BASIC_FIELDS = {**PROFILE_FIELDS, "job_title": Field("str", required=False, max_length=120)}
ADMIN_FIELDS = {
    **BASIC_FIELDS,
    "salary": Field("decimal", min_value=0, max_value=10_000_000),
    "role": Field("enum", choices=ROLES),
    "manager_id": Field("int", required=False, nullable=True, min_value=1),
}

_SELECT_USER = sql.SQL(
    """
    SELECT u.*, m.first_name || ' ' || m.last_name AS manager_name, m.employee_id AS manager_employee_id
    FROM users u LEFT JOIN users m ON m.id = u.manager_id
    """
)


# --------------------------------------------------------------------------- helpers


def serialize(row: dict, viewer: Actor) -> dict:
    """Return the public representation of a user for ``viewer``."""
    can_see_salary = viewer.role == "admin" or row["id"] == viewer.id or row["manager_id"] == viewer.id
    return {
        "id": row["id"],
        "employee_id": row["employee_id"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "email": row["email"],
        "job_title": row["job_title"],
        "role": row["role"],
        "manager_id": row["manager_id"],
        "manager_name": row.get("manager_name"),
        "manager_employee_id": row.get("manager_employee_id"),
        "salary": row["salary"] if can_see_salary else None,
        "is_active": row["is_active"],
        "created_at": row["created_at"],
    }


def _audit_view(row: dict) -> dict:
    """The fields of a user that are diffed into the audit log."""
    keys = ("first_name", "last_name", "email", "job_title", "salary", "role", "manager_id", "is_active")
    return {key: row[key] for key in keys}


def _full_name(row: dict) -> str:
    return f"{row['first_name']} {row['last_name']}"


def _fetch_user(cur: psycopg.Cursor, user_id: int, lock: bool = False) -> dict:
    """Load a user (with manager name) or raise 404."""
    query = _SELECT_USER + sql.SQL(" WHERE u.id = %s")
    if lock:
        query += sql.SQL(" FOR UPDATE OF u")
    cur.execute(query, (user_id,))
    row = cur.fetchone()
    if row is None:
        raise NotFound("User not found")
    return row


def _next_employee_id(cur: psycopg.Cursor, role: str) -> str:
    """Generate the next sequential employee id for a role, e.g. EMP002."""
    prefix = ID_PREFIXES[role]
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (_EMPLOYEE_ID_LOCK_KEY,))
    cur.execute(
        """
        SELECT COALESCE(MAX(substring(employee_id FROM 4)::int), 0) AS last
        FROM users WHERE employee_id ~ %s
        """,
        (f"^{prefix}[0-9]+$",),
    )
    return f"{prefix}{cur.fetchone()['last'] + 1:03d}"


def _email_taken(cur: psycopg.Cursor, email: str, exclude_id: int | None = None) -> bool:
    cur.execute(
        "SELECT 1 FROM users WHERE lower(email) = %s AND id IS DISTINCT FROM %s",
        (email.lower(), exclude_id),
    )
    return cur.fetchone() is not None


def _check_manager(cur: psycopg.Cursor, manager_id: int | None, role: str, user_id: int | None = None) -> None:
    """Enforce: employees have exactly one active manager; other roles have none."""
    if role != "employee":
        if manager_id is not None:
            raise ValidationError({"manager_id": "Only employees report to a manager"})
        return
    if manager_id is None:
        raise ValidationError({"manager_id": "Employees must have a manager"})
    if manager_id == user_id:
        raise ValidationError({"manager_id": "A user cannot manage themselves"})
    cur.execute("SELECT role, is_active FROM users WHERE id = %s", (manager_id,))
    manager = cur.fetchone()
    if manager is None or manager["role"] != "manager" or not manager["is_active"]:
        raise ValidationError({"manager_id": "Must be an active manager"})


def _blockers_for_leaving_manager_role(cur: psycopg.Cursor, user_id: int) -> list[str]:
    """Reasons a manager cannot stop being a manager (role change or deactivation)."""
    reasons = []
    cur.execute("SELECT COUNT(*) AS n FROM users WHERE manager_id = %s AND is_active", (user_id,))
    reports = cur.fetchone()["n"]
    if reports:
        reasons.append(f"they still have {reports} direct report(s) - reassign them first")
    cur.execute(
        "SELECT COUNT(*) AS n FROM projects WHERE manager_id = %s AND NOT is_archived", (user_id,)
    )
    projects = cur.fetchone()["n"]
    if projects:
        reasons.append(f"they still manage {projects} active project(s) - reassign them first")
    return reasons


def _check_not_last_admin(cur: psycopg.Cursor, user_id: int) -> None:
    cur.execute("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active AND id <> %s", (user_id,))
    if cur.fetchone()["n"] == 0:
        raise Conflict("At least one active admin is required")


def _load_target(request: Request, cur: psycopg.Cursor, lock: bool = False) -> dict:
    return _fetch_user(cur, parse_id(request.params["id"]), lock=lock)


# --------------------------------------------------------------------------- routes


@router.get("/")
@require_auth("admin", "manager")
def list_users(request: Request) -> Response:
    """List users with search, filters and pagination."""
    query = request.query
    limit, offset = parse_pagination(query)
    role = parse_choice(query, "role", ROLES)
    status = parse_choice(query, "status", ("active", "inactive", "all"), default="active")

    conditions: list[sql.Composable] = []
    params: list[Any] = []
    if status != "all":
        conditions.append(sql.SQL("u.is_active = %s"))
        params.append(status == "active")
    if role:
        conditions.append(sql.SQL("u.role = %s"))
        params.append(role)
    if query.get("manager_id"):
        conditions.append(sql.SQL("u.manager_id = %s"))
        params.append(parse_id(query["manager_id"], "manager_id"))
    if query.get("q", "").strip():
        conditions.append(sql.SQL(
            "(u.first_name || ' ' || u.last_name ILIKE %s OR u.email ILIKE %s "
            "OR u.employee_id ILIKE %s OR u.job_title ILIKE %s)"
        ))
        params.extend([f"%{query['q'].strip()}%"] * 4)

    where = sql.SQL(" WHERE ") + sql.SQL(" AND ").join(conditions) if conditions else sql.SQL("")
    with transaction() as cur:
        cur.execute(sql.SQL("SELECT COUNT(*) AS n FROM users u") + where, params)
        total = cur.fetchone()["n"]
        cur.execute(
            _SELECT_USER + where + sql.SQL(" ORDER BY u.last_name, u.first_name, u.id LIMIT %s OFFSET %s"),
            [*params, limit, offset],
        )
        rows = cur.fetchall()
    return ok({"items": [serialize(r, request.actor) for r in rows], "total": total})


@router.post("/")
@require_auth("admin")
def create_user(request: Request) -> Response:
    """Create a user with a generated employee id and one-time password."""
    data = validate(request.body, ADMIN_FIELDS)
    data.setdefault("job_title", "")
    data.setdefault("manager_id", None)
    password = passwords.generate_password()

    with transaction() as cur:
        _check_manager(cur, data["manager_id"], data["role"])
        if _email_taken(cur, data["email"]):
            raise ValidationError({"email": "This email is already in use"})
        employee_id = _next_employee_id(cur, data["role"])
        cur.execute(
            """
            INSERT INTO users (employee_id, first_name, last_name, email, job_title, salary,
                               role, manager_id, password_hash)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                employee_id, data["first_name"], data["last_name"], data["email"], data["job_title"],
                data["salary"], data["role"], data["manager_id"], passwords.hash_password(password),
            ),
        )
        row = _fetch_user(cur, cur.fetchone()["id"])
        audit.record(
            cur, request.actor, "user.create", "user", row["id"],
            f"Created {row['role']} {_full_name(row)} ({employee_id})",
            after=_audit_view(row),
        )
    return created({"user": serialize(row, request.actor), "temporary_password": password})


@router.patch("/me")
@require_auth()
def update_me(request: Request) -> Response:
    """Let any user update their own first name, last name and email."""
    data = validate(request.body, PROFILE_FIELDS, partial=True)
    actor = request.actor
    with transaction() as cur:
        before = _fetch_user(cur, actor.id, lock=True)
        if "email" in data and _email_taken(cur, data["email"], exclude_id=actor.id):
            raise ValidationError({"email": "This email is already in use"})
        after = _apply_update(cur, before, data)
        changes = audit.diff(_audit_view(before), _audit_view(after))
        if changes:
            audit.record(
                cur, actor, "user.update_self", "user", actor.id,
                f"{actor.name} updated their profile ({', '.join(changes)})",
                before=_audit_view(before), after=_audit_view(after),
            )
    return ok(serialize(after, actor))


@router.get("/{id}")
@require_auth()
def get_user(request: Request) -> Response:
    """View one user. Employees may only view themselves."""
    user_id = parse_id(request.params["id"])
    if request.actor.role == "employee" and user_id != request.actor.id:
        deny(request, "employees can only view their own profile")
    with transaction() as cur:
        row = _fetch_user(cur, user_id)
    return ok(serialize(row, request.actor))


@router.patch("/{id}")
@require_auth("admin", "manager")
def update_user(request: Request) -> Response:
    """
    Update a user.

    Admins may change any field (with integrity checks); managers may change
    the basic details of their own direct reports only.
    """
    actor = request.actor
    with transaction() as cur:
        before = _load_target(request, cur, lock=True)
        if actor.role == "manager":
            if before["manager_id"] != actor.id:
                deny(request, "managers can only edit their direct reports")
            data = validate(request.body, BASIC_FIELDS, partial=True)
        else:
            data = validate(request.body, ADMIN_FIELDS, partial=True)
            _check_admin_update(cur, actor, before, data)

        if "email" in data and _email_taken(cur, data["email"], exclude_id=before["id"]):
            raise ValidationError({"email": "This email is already in use"})
        after = _apply_update(cur, before, data)
        changes = audit.diff(_audit_view(before), _audit_view(after))
        if changes:
            audit.record(
                cur, actor, "user.update", "user", after["id"],
                f"Updated {_full_name(after)} ({after['employee_id']}): {', '.join(changes)}",
                before=_audit_view(before), after=_audit_view(after),
            )
    return ok(serialize(after, actor))


def _check_admin_update(cur: psycopg.Cursor, actor: Actor, before: dict, data: dict) -> None:
    """Integrity rules for admin edits (roles, reporting lines, self-protection)."""
    new_role = data.get("role", before["role"])
    if new_role != "employee":
        # Promoting an employee clears their manager unless one was explicitly (wrongly) sent.
        data.setdefault("manager_id", None)
    new_manager = data.get("manager_id", before["manager_id"])

    if before["id"] == actor.id and new_role != before["role"]:
        raise Conflict("You cannot change your own role")
    if before["role"] == "admin" and new_role != "admin":
        _check_not_last_admin(cur, before["id"])
    if before["role"] == "manager" and new_role != "manager":
        blockers = _blockers_for_leaving_manager_role(cur, before["id"])
        if blockers:
            raise Conflict(f"Cannot change role: {'; '.join(blockers)}")
    if "role" in data or "manager_id" in data:
        _check_manager(cur, new_manager, new_role, before["id"])


def _apply_update(cur: psycopg.Cursor, before: dict, data: dict) -> dict:
    """Write changed columns and return the refreshed row."""
    changed = {k: v for k, v in data.items() if before.get(k) != v}
    if changed:
        assignments = sql.SQL(", ").join(
            sql.SQL("{} = %s").format(sql.Identifier(column)) for column in changed
        )
        cur.execute(
            sql.SQL("UPDATE users SET {}, updated_at = now() WHERE id = %s").format(assignments),
            [*changed.values(), before["id"]],
        )
    return _fetch_user(cur, before["id"])


@router.post("/{id}/reset-password")
@require_auth("admin")
def reset_password(request: Request) -> Response:
    """Generate a new one-time password for a user."""
    password = passwords.generate_password()
    with transaction() as cur:
        row = _load_target(request, cur, lock=True)
        cur.execute(
            "UPDATE users SET password_hash = %s, updated_at = now() WHERE id = %s",
            (passwords.hash_password(password), row["id"]),
        )
        audit.record(
            cur, request.actor, "user.reset_password", "user", row["id"],
            f"Reset password for {_full_name(row)} ({row['employee_id']})",
        )
    return ok({"temporary_password": password})


@router.post("/{id}/deactivate")
@require_auth("admin")
def deactivate_user(request: Request) -> Response:
    """Deactivate a user. Records are kept; the user can no longer sign in."""
    with transaction() as cur:
        before = _load_target(request, cur, lock=True)
        if before["id"] == request.actor.id:
            raise Conflict("You cannot deactivate your own account")
        if not before["is_active"]:
            raise Conflict("User is already inactive")
        if before["role"] == "admin":
            _check_not_last_admin(cur, before["id"])
        if before["role"] == "manager":
            blockers = _blockers_for_leaving_manager_role(cur, before["id"])
            if blockers:
                raise Conflict(f"Cannot deactivate: {'; '.join(blockers)}")
        after = _apply_update(cur, before, {"is_active": False})
        audit.record(
            cur, request.actor, "user.deactivate", "user", after["id"],
            f"Deactivated {_full_name(after)} ({after['employee_id']})",
            before=_audit_view(before), after=_audit_view(after),
        )
    return ok(serialize(after, request.actor))


@router.post("/{id}/reactivate")
@require_auth("admin")
def reactivate_user(request: Request) -> Response:
    """Reactivate a previously deactivated user."""
    with transaction() as cur:
        before = _load_target(request, cur, lock=True)
        if before["is_active"]:
            raise Conflict("User is already active")
        if before["role"] == "employee":
            _check_manager(cur, before["manager_id"], "employee", before["id"])
        after = _apply_update(cur, before, {"is_active": True})
        audit.record(
            cur, request.actor, "user.reactivate", "user", after["id"],
            f"Reactivated {_full_name(after)} ({after['employee_id']})",
            before=_audit_view(before), after=_audit_view(after),
        )
    return ok(serialize(after, request.actor))


def handler(event: dict | None = None, context: object = None) -> dict:
    """Lambda entry point."""
    return router.handle(event, context)
