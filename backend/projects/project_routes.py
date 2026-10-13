"""
Project CRUD routes (under /api/projects).

    GET   /                  any role        list visible projects (q, status, manager_id, archived, paginated)
    POST  /                  admin           create a project
    GET   /{id}              any role        view a visible project
    PATCH /{id}              admin, manager  update (managers: own projects, limited fields)
    POST  /{id}/archive      admin           archive (projects are never deleted)
    POST  /{id}/reactivate   admin           reactivate, optionally assigning a new manager
"""

from typing import Any

import psycopg
from psycopg import sql

from pm_core import audit
from pm_core.audit import Actor
from pm_core.auth import require_auth
from pm_core.db import transaction
from pm_core.errors import Conflict, ValidationError
from pm_core.http import Request, Response, Router, created, ok
from pm_core.validation import Field, parse_choice, parse_id, parse_pagination, validate
import staffing
from project_queries import (
    SELECT_PROJECT,
    attach_my_hours,
    audit_view,
    fetch_project_for_write,
    fetch_visible_project,
    serialize,
    visibility_condition,
)

STATUSES = ("planned", "active", "on_hold", "completed")

MANAGER_FIELDS = {
    "description": Field("str", required=False, max_length=5000),
    "start_date": Field("date"),
    "predicted_end_date": Field("date"),
    "budget": Field("decimal", min_value=0, max_value=1_000_000_000),
    "status": Field("enum", required=False, choices=STATUSES),
}
ADMIN_FIELDS = {
    **MANAGER_FIELDS,
    "name": Field("str", max_length=200),
    "manager_id": Field("int", min_value=1),
}
REACTIVATE_FIELDS = {"manager_id": Field("int", required=False, min_value=1)}


def check_manager(cur: psycopg.Cursor, manager_id: int) -> None:
    """Projects must be managed by an active user with the manager role."""
    cur.execute("SELECT role, is_active FROM users WHERE id = %s", (manager_id,))
    manager = cur.fetchone()
    if manager is None or manager["role"] != "manager" or not manager["is_active"]:
        raise ValidationError({"manager_id": "Must be an active manager"})


def check_dates(start: Any, end: Any) -> None:
    if end < start:
        raise ValidationError({"predicted_end_date": "Must be on or after the start date"})


def register(router: Router) -> None:
    """Attach the project routes to the service router."""

    @router.get("/")
    @require_auth()
    def list_projects(request: Request) -> Response:
        """List projects visible to the caller, with search, filters and pagination."""
        query = request.query
        limit, offset = parse_pagination(query)
        status = parse_choice(query, "status", STATUSES)
        archived = parse_choice(query, "archived", ("false", "true", "all"), default="false")

        conditions: list[sql.Composable] = []
        params: list[Any] = []
        visibility, visibility_params = visibility_condition(request.actor)
        if visibility is not None:
            conditions.append(visibility)
            params.extend(visibility_params)
        if archived != "all":
            conditions.append(sql.SQL("p.is_archived = %s"))
            params.append(archived == "true")
        if status:
            conditions.append(sql.SQL("p.status = %s"))
            params.append(status)
        if query.get("manager_id"):
            conditions.append(sql.SQL("p.manager_id = %s"))
            params.append(parse_id(query["manager_id"], "manager_id"))
        if query.get("q", "").strip():
            conditions.append(sql.SQL("(p.name ILIKE %s OR p.description ILIKE %s)"))
            params.extend([f"%{query['q'].strip()}%"] * 2)

        where = sql.SQL(" WHERE ") + sql.SQL(" AND ").join(conditions) if conditions else sql.SQL("")
        with transaction() as cur:
            cur.execute(sql.SQL("SELECT COUNT(*) AS n FROM projects p") + where, params)
            total = cur.fetchone()["n"]
            cur.execute(
                SELECT_PROJECT + where + sql.SQL(" ORDER BY p.start_date DESC, p.id DESC LIMIT %s OFFSET %s"),
                [*params, limit, offset],
            )
            rows = cur.fetchall()
            attach_my_hours(cur, request.actor, rows)
        return ok({"items": [serialize(r, request.actor) for r in rows], "total": total})

    @router.post("/")
    @require_auth("admin")
    def create_project(request: Request) -> Response:
        """Create a project. Admin only."""
        data = validate(request.body, ADMIN_FIELDS)
        data.setdefault("description", "")
        data.setdefault("status", "planned")
        check_dates(data["start_date"], data["predicted_end_date"])
        actor = request.actor
        with transaction() as cur:
            check_manager(cur, data["manager_id"])
            cur.execute(
                """
                INSERT INTO projects (name, description, start_date, predicted_end_date,
                                      manager_id, budget, status, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    data["name"], data["description"], data["start_date"], data["predicted_end_date"],
                    data["manager_id"], data["budget"], data["status"], actor.id,
                ),
            )
            row = fetch_visible_project(cur, actor, cur.fetchone()["id"])
            audit.record(
                cur, actor, "project.create", "project", row["id"],
                f"Created project {row['name']} (manager: {row['manager_name']})",
                after=audit_view(row), project_id=row["id"],
            )
        return created(serialize(row, actor))

    @router.get("/{id}")
    @require_auth()
    def get_project(request: Request) -> Response:
        """View a project the caller may see."""
        with transaction() as cur:
            row = fetch_visible_project(cur, request.actor, parse_id(request.params["id"]))
            attach_my_hours(cur, request.actor, [row])
        return ok(serialize(row, request.actor))

    @router.patch("/{id}")
    @require_auth("admin", "manager")
    def update_project(request: Request) -> Response:
        """Update a project. Managers may only edit their own projects' schedule, budget and details."""
        actor = request.actor
        project_id = parse_id(request.params["id"])
        with transaction() as cur:
            before = fetch_project_for_write(cur, request, project_id)
            data = validate(request.body, ADMIN_FIELDS if actor.role == "admin" else MANAGER_FIELDS, partial=True)
            if before["is_archived"]:
                raise Conflict("Archived projects are read-only. Reactivate it first.")
            check_dates(
                data.get("start_date", before["start_date"]),
                data.get("predicted_end_date", before["predicted_end_date"]),
            )
            if "manager_id" in data and data["manager_id"] != before["manager_id"]:
                check_manager(cur, data["manager_id"])
            staffing.check_project_change(cur, before, {**before, **data})
            after = _apply_update(cur, actor, before, data)
            changes = audit.diff(audit_view(before), audit_view(after))
            if changes:
                audit.record(
                    cur, actor, "project.update", "project", project_id,
                    f"Updated project {after['name']}: {', '.join(changes)}",
                    before=audit_view(before), after=audit_view(after), project_id=project_id,
                )
        return ok(serialize(after, actor))

    @router.post("/{id}/archive")
    @require_auth("admin")
    def archive_project(request: Request) -> Response:
        """Archive a project. It is kept with all its history and can be reactivated."""
        actor = request.actor
        project_id = parse_id(request.params["id"])
        with transaction() as cur:
            before = fetch_visible_project(cur, actor, project_id, lock=True)
            if before["is_archived"]:
                raise Conflict("Project is already archived")
            cur.execute(
                "UPDATE projects SET is_archived = TRUE, archived_at = now(), updated_at = now() WHERE id = %s",
                (project_id,),
            )
            after = fetch_visible_project(cur, actor, project_id)
            audit.record(
                cur, actor, "project.archive", "project", project_id, f"Archived project {after['name']}",
                before=audit_view(before), after=audit_view(after), project_id=project_id,
            )
        return ok(serialize(after, actor))

    @router.post("/{id}/reactivate")
    @require_auth("admin")
    def reactivate_project(request: Request) -> Response:
        """Reactivate an archived project. A new manager can be given if the old one is no longer active."""
        actor = request.actor
        project_id = parse_id(request.params["id"])
        data = validate(request.body, REACTIVATE_FIELDS)
        with transaction() as cur:
            before = fetch_visible_project(cur, actor, project_id, lock=True)
            if not before["is_archived"]:
                raise Conflict("Project is not archived")
            manager_id = data.get("manager_id", before["manager_id"])
            try:
                check_manager(cur, manager_id)
            except ValidationError:
                raise Conflict(
                    "The project's manager is no longer active. Choose a new manager to reactivate it.",
                    details={"manager_id": "Must be an active manager"},
                ) from None
            # Its team's hours count again once it is current, so re-check the 40-hour rule.
            staffing.check_project_change(cur, before, {**before, "is_archived": False})
            cur.execute(
                """
                UPDATE projects SET is_archived = FALSE, archived_at = NULL, manager_id = %s, updated_at = now()
                WHERE id = %s
                """,
                (manager_id, project_id),
            )
            after = fetch_visible_project(cur, actor, project_id)
            audit.record(
                cur, actor, "project.reactivate", "project", project_id, f"Reactivated project {after['name']}",
                before=audit_view(before), after=audit_view(after), project_id=project_id,
            )
        return ok(serialize(after, actor))


def _apply_update(cur: psycopg.Cursor, actor: Actor, before: dict, data: dict) -> dict:
    """Write changed columns and return the refreshed project."""
    changed = {key: value for key, value in data.items() if before.get(key) != value}
    if changed:
        assignments = sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(column)) for column in changed)
        cur.execute(
            sql.SQL("UPDATE projects SET {}, updated_at = now() WHERE id = %s").format(assignments),
            [*changed.values(), before["id"]],
        )
    return fetch_visible_project(cur, actor, before["id"])
