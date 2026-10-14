"""
Project requests (under /api/projects/requests).

    GET  /requests                      admin (all), manager (own)  ?status=pending|approved|rejected|withdrawn
    POST /requests                      manager                     submit a request
    POST /requests/{request_id}/withdraw     the requesting manager  (pending only)
    POST /requests/{request_id}/approve      admin   creates the project; may adjust name, dates, budget, manager
    POST /requests/{request_id}/reject       admin   {note} - a reason is required

Approving creates the project in the same transaction, through the same
``insert_project`` used by "New project", so requested projects follow
exactly the same rules. Requests are never deleted. Must be registered
before routes matching ``/{id}``.
"""

from typing import Any

import psycopg
from psycopg import sql

from pm_core import audit
from pm_core.auth import deny, require_auth
from pm_core.db import transaction
from pm_core.errors import Conflict, NotFound, ValidationError
from pm_core.http import Request, Response, Router, created, ok
from pm_core.validation import Field, parse_choice, parse_id, validate
from routes.projects import check_dates, insert_project

STATUSES = ("pending", "approved", "rejected", "withdrawn")

REQUEST_SPEC = {
    "name": Field("str", max_length=200),
    "description": Field("str", required=False, max_length=5000),
    "start_date": Field("date"),
    "predicted_end_date": Field("date"),
    "budget": Field("decimal", min_value=0, max_value=1_000_000_000),
    "justification": Field("str", max_length=5000),
}
# On approval the admin may adjust what was asked for.
APPROVE_SPEC = {
    "name": Field("str", required=False, max_length=200),
    "start_date": Field("date", required=False),
    "predicted_end_date": Field("date", required=False),
    "budget": Field("decimal", required=False, min_value=0, max_value=1_000_000_000),
    "manager_id": Field("int", required=False, min_value=1),
    "note": Field("str", required=False, max_length=1000),
}
REJECT_SPEC = {"note": Field("str", max_length=1000)}

_SELECT_REQUEST = sql.SQL(
    """
    SELECT r.*,
           u.first_name || ' ' || u.last_name AS requested_by_name, u.employee_id AS requested_by_employee_id,
           v.first_name || ' ' || v.last_name AS reviewed_by_name,
           p.name AS project_name
    FROM project_requests r
    JOIN users u ON u.id = r.requested_by
    LEFT JOIN users v ON v.id = r.reviewed_by
    LEFT JOIN projects p ON p.id = r.project_id
    """
)


def serialize(row: dict) -> dict:
    """Public representation of a project request."""
    keys = (
        "id",
        "name",
        "description",
        "start_date",
        "predicted_end_date",
        "budget",
        "justification",
        "status",
        "requested_by",
        "requested_by_name",
        "requested_by_employee_id",
        "created_at",
        "reviewed_by_name",
        "reviewed_at",
        "review_note",
        "project_id",
        "project_name",
    )
    return {key: row[key] for key in keys}


def _audit_view(row: dict) -> dict:
    keys = ("name", "start_date", "predicted_end_date", "budget", "status")
    return {key: row[key] for key in keys}


def _fetch(cur: psycopg.Cursor, request_id: int, lock: bool = False) -> dict:
    query = _SELECT_REQUEST + sql.SQL(" WHERE r.id = %s")
    if lock:
        query += sql.SQL(" FOR NO KEY UPDATE OF r")
    cur.execute(query, (request_id,))
    row = cur.fetchone()
    if row is None:
        raise NotFound("Project request not found")
    return row


def _pending(row: dict) -> None:
    if row["status"] != "pending":
        raise Conflict(f"This request has already been {row['status']}")


def register(router: Router) -> None:
    """Attach the project request routes. Must be registered before ``/{id}`` routes."""

    @router.get("/requests")
    @require_auth("admin", "manager")
    def list_requests(request: Request) -> Response:
        """Admins see every request; managers see their own. Pending first, newest first."""
        status = parse_choice(request.query, "status", STATUSES)
        conditions: list[sql.Composable] = []
        params: list[Any] = []
        if request.actor.role == "manager":
            conditions.append(sql.SQL("r.requested_by = %s"))
            params.append(request.actor.id)
        if status:
            conditions.append(sql.SQL("r.status = %s"))
            params.append(status)
        where = sql.SQL(" WHERE ") + sql.SQL(" AND ").join(conditions) if conditions else sql.SQL("")
        with transaction() as cur:
            cur.execute(
                _SELECT_REQUEST
                + where
                + sql.SQL(" ORDER BY (r.status = 'pending') DESC, r.created_at DESC, r.id DESC"),
                params,
            )
            rows = cur.fetchall()
            if request.actor.role == "manager":
                cur.execute(
                    "SELECT COUNT(*) AS n FROM project_requests WHERE status = 'pending' AND requested_by = %s",
                    (request.actor.id,),
                )
            else:
                cur.execute("SELECT COUNT(*) AS n FROM project_requests WHERE status = 'pending'")
            pending = cur.fetchone()["n"]
        return ok({"items": [serialize(r) for r in rows], "total": len(rows), "pending": pending})

    @router.post("/requests")
    @require_auth("manager")
    def submit_request(request: Request) -> Response:
        """A manager asks for a new project; they will manage it if approved."""
        data = validate(request.body, REQUEST_SPEC)
        check_dates(data["start_date"], data["predicted_end_date"])
        actor = request.actor
        with transaction() as cur:
            cur.execute(
                """
                INSERT INTO project_requests (requested_by, name, description, start_date, predicted_end_date,
                                              budget, justification)
                VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id
                """,
                (
                    actor.id,
                    data["name"],
                    data.get("description", ""),
                    data["start_date"],
                    data["predicted_end_date"],
                    data["budget"],
                    data["justification"],
                ),
            )
            row = _fetch(cur, cur.fetchone()["id"])
            audit.record(
                cur,
                actor,
                "request.submit",
                "project_request",
                row["id"],
                f"{actor.name} requested a new project '{row['name']}' (budget ${row['budget']:,.2f})",
                after=_audit_view(row),
            )
        return created(serialize(row))

    @router.post("/requests/{request_id}/withdraw")
    @require_auth("manager")
    def withdraw_request(request: Request) -> Response:
        """The requester withdraws their own pending request."""
        actor = request.actor
        with transaction() as cur:
            row = _fetch(cur, parse_id(request.params["request_id"], "request_id"), lock=True)
            if row["requested_by"] != actor.id:
                deny(request, "managers can only withdraw their own requests")
            _pending(row)
            cur.execute("UPDATE project_requests SET status = 'withdrawn' WHERE id = %s", (row["id"],))
            after = _fetch(cur, row["id"])
            audit.record(
                cur,
                actor,
                "request.withdraw",
                "project_request",
                row["id"],
                f"{actor.name} withdrew the request for '{row['name']}'",
                before=_audit_view(row),
                after=_audit_view(after),
            )
        return ok(serialize(after))

    @router.post("/requests/{request_id}/approve")
    @require_auth("admin")
    def approve_request(request: Request) -> Response:
        """Approve a request, creating the project (optionally with adjusted details)."""
        changes = validate(request.body, APPROVE_SPEC)
        note = changes.pop("note", "")
        actor = request.actor
        with transaction() as cur:
            row = _fetch(cur, parse_id(request.params["request_id"], "request_id"), lock=True)
            _pending(row)
            requested = {
                "name": row["name"],
                "description": row["description"],
                "start_date": row["start_date"],
                "predicted_end_date": row["predicted_end_date"],
                "budget": row["budget"],
                "manager_id": row["requested_by"],  # the requester runs it unless the admin chooses otherwise
            }
            project_data = {**requested, **changes}
            try:
                project = insert_project(
                    cur, actor, project_data, source=f" from request #{row['id']} by {row['requested_by_name']}"
                )
            except ValidationError as error:
                if "manager_id" in error.details and "manager_id" not in changes:
                    raise Conflict(
                        f"{row['requested_by_name']} is no longer an active manager. "
                        "Choose who will manage this project.",
                        details={"manager_id": "Must be an active manager"},
                    ) from None
                raise
            adjusted = [key for key, value in changes.items() if value != requested[key]]
            cur.execute(
                """
                UPDATE project_requests
                SET status = 'approved', reviewed_by = %s, reviewed_at = now(), review_note = %s, project_id = %s
                WHERE id = %s
                """,
                (actor.id, note, project["id"], row["id"]),
            )
            after = _fetch(cur, row["id"])
            detail = f" with changes to {', '.join(adjusted)}" if adjusted else ""
            audit.record(
                cur,
                actor,
                "request.approve",
                "project_request",
                row["id"],
                f"Approved the request for '{row['name']}' from {row['requested_by_name']}{detail}",
                before=_audit_view(row),
                after=_audit_view(after),
                project_id=project["id"],
            )
        return ok(serialize(after))

    @router.post("/requests/{request_id}/reject")
    @require_auth("admin")
    def reject_request(request: Request) -> Response:
        """Reject a request. A reason is required so the manager knows why."""
        data = validate(request.body, REJECT_SPEC)
        actor = request.actor
        with transaction() as cur:
            row = _fetch(cur, parse_id(request.params["request_id"], "request_id"), lock=True)
            _pending(row)
            cur.execute(
                """
                UPDATE project_requests SET status = 'rejected', reviewed_by = %s, reviewed_at = now(), review_note = %s
                WHERE id = %s
                """,
                (actor.id, data["note"], row["id"]),
            )
            after = _fetch(cur, row["id"])
            audit.record(
                cur,
                actor,
                "request.reject",
                "project_request",
                row["id"],
                f"Rejected the request for '{row['name']}' from {row['requested_by_name']} - {data['note']}",
                before=_audit_view(row),
                after=_audit_view(after),
            )
        return ok(serialize(after))
