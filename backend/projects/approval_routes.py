"""
Cross-team hours approval (under /api/projects).

    GET  /approvals                                   manager  pending requests for my direct reports
    POST /{id}/assignments/{assignment_id}/approve    the employee's own manager
    POST /{id}/assignments/{assignment_id}/reject     the employee's own manager  {note?}

Only an employee's own reporting manager may decide on their hours - not
admins, not the project's manager. Pending hours were reserved when requested
(they already count towards the 40-hour and budget rules), so approving is
just a state change and can never break either rule.
"""

import psycopg
from psycopg import sql

from assignment_routes import fetch_assignment, load_assignment_view, name, serialize
from pm_core import audit
from pm_core.auth import deny, require_auth
from pm_core.capacity import fmt_hours
from pm_core.db import transaction
from pm_core.errors import Conflict, NotFound
from pm_core.http import Request, Response, Router, ok
from pm_core.validation import Field, parse_id, validate
from project_queries import SELECT_PROJECT

REJECT_SPEC = {"note": Field("str", required=False, max_length=1000)}


def _decision_context(cur: psycopg.Cursor, request: Request) -> tuple[dict, dict, dict]:
    """
    Lock the project, assignment and employee for an approve/reject decision.

    Raises 404 if missing, 403 (audited) unless the caller is the employee's
    own manager, and 409 if there is nothing awaiting approval.
    """
    project_id = parse_id(request.params["id"])
    cur.execute(SELECT_PROJECT + sql.SQL(" WHERE p.id = %s FOR NO KEY UPDATE OF p"), (project_id,))
    project = cur.fetchone()
    if project is None:
        raise NotFound("Project not found")
    assignment = fetch_assignment(cur, project_id, parse_id(request.params["assignment_id"], "assignment_id"))
    cur.execute("SELECT * FROM users WHERE id = %s FOR NO KEY UPDATE", (assignment["user_id"],))
    employee = cur.fetchone()
    if request.actor.id != employee["manager_id"]:
        deny(request, "only the employee's own manager can approve their hours", project_id=project_id)
    if assignment["status"] != "pending" and assignment["pending_hours"] is None:
        raise Conflict("There is nothing awaiting approval on this assignment")
    if project["is_archived"]:
        raise Conflict("This project has been archived. The request can no longer be approved.")
    return project, assignment, employee


def register(router: Router) -> None:
    """Attach the approval routes. Must be registered before routes matching ``/{id}``."""

    @router.get("/approvals")
    @require_auth("manager")
    def list_approvals(request: Request) -> Response:
        """Pending hour requests for the caller's direct reports, oldest first."""
        with transaction() as cur:
            cur.execute(
                """
                SELECT a.id, a.project_id, a.user_id, a.status, a.hours_per_week, a.pending_hours, a.requested_at,
                       u.employee_id, u.first_name, u.last_name, u.job_title,
                       p.name AS project_name, p.start_date, p.predicted_end_date,
                       pm.first_name || ' ' || pm.last_name AS project_manager_name,
                       r.first_name || ' ' || r.last_name AS requested_by_name
                FROM project_assignments a
                JOIN users u ON u.id = a.user_id
                JOIN projects p ON p.id = a.project_id
                JOIN users pm ON pm.id = p.manager_id
                LEFT JOIN users r ON r.id = a.requested_by
                WHERE u.manager_id = %s AND NOT p.is_archived
                  AND (a.status = 'pending' OR a.pending_hours IS NOT NULL)
                ORDER BY a.requested_at, a.id
                """,
                (request.actor.id,),
            )
            rows = cur.fetchall()
        items = [
            {
                "assignment_id": row["id"],
                "project_id": row["project_id"],
                "project_name": row["project_name"],
                "project_manager_name": row["project_manager_name"],
                "start_date": row["start_date"],
                "predicted_end_date": row["predicted_end_date"],
                "user_id": row["user_id"],
                "employee_id": row["employee_id"],
                "first_name": row["first_name"],
                "last_name": row["last_name"],
                "job_title": row["job_title"],
                "kind": "new" if row["status"] == "pending" else "increase",
                "current_hours": None if row["status"] == "pending" else row["hours_per_week"],
                "requested_hours": row["hours_per_week"] if row["status"] == "pending" else row["pending_hours"],
                "requested_by_name": row["requested_by_name"],
                "requested_at": row["requested_at"],
            }
            for row in rows
        ]
        return ok({"items": items, "total": len(items)})

    @router.post("/{id}/assignments/{assignment_id}/approve")
    @require_auth()
    def approve(request: Request) -> Response:
        """Approve a pending assignment or hours increase."""
        actor = request.actor
        with transaction() as cur:
            project, assignment, employee = _decision_context(cur, request)
            if assignment["status"] == "pending":
                approved = assignment["hours_per_week"]
                cur.execute(
                    "UPDATE project_assignments SET status = 'approved', updated_at = now() WHERE id = %s",
                    (assignment["id"],),
                )
                summary = f"Approved {fmt_hours(approved)} h/week for {name(employee)} on {project['name']}"
            else:
                approved = assignment["pending_hours"]
                cur.execute(
                    """
                    UPDATE project_assignments
                    SET hours_per_week = pending_hours, pending_hours = NULL, updated_at = now()
                    WHERE id = %s
                    """,
                    (assignment["id"],),
                )
                summary = (
                    f"Approved an increase for {name(employee)} on {project['name']} "
                    f"from {fmt_hours(assignment['hours_per_week'])} to {fmt_hours(approved)} h/week"
                )
            audit.record(
                cur,
                actor,
                "assignment.approve",
                "assignment",
                assignment["id"],
                summary,
                before={
                    "status": assignment["status"],
                    "hours_per_week": assignment["hours_per_week"],
                    "pending_hours": assignment["pending_hours"],
                },
                after={"status": "approved", "hours_per_week": approved, "pending_hours": None},
                project_id=project["id"],
            )
            row = load_assignment_view(cur, assignment["id"])
        return ok(serialize(row, project, actor.role))

    @router.post("/{id}/assignments/{assignment_id}/reject")
    @require_auth()
    def reject(request: Request) -> Response:
        """Reject a request: a new assignment is withdrawn, an increase is dropped."""
        data = validate(request.body, REJECT_SPEC)
        note = data.get("note", "")
        actor = request.actor
        with transaction() as cur:
            project, assignment, employee = _decision_context(cur, request)
            reason = f" - {note}" if note else ""
            if assignment["status"] == "pending":
                cur.execute("DELETE FROM project_assignments WHERE id = %s", (assignment["id"],))
                summary = (
                    f"Rejected {fmt_hours(assignment['hours_per_week'])} h/week for {name(employee)} "
                    f"on {project['name']}{reason}"
                )
                result = None
            else:
                cur.execute(
                    "UPDATE project_assignments SET pending_hours = NULL, requested_by = NULL, "
                    "requested_at = NULL, updated_at = now() WHERE id = %s",
                    (assignment["id"],),
                )
                summary = (
                    f"Rejected an increase for {name(employee)} on {project['name']} to "
                    f"{fmt_hours(assignment['pending_hours'])} h/week (stays at "
                    f"{fmt_hours(assignment['hours_per_week'])}){reason}"
                )
                result = load_assignment_view(cur, assignment["id"])
            audit.record(
                cur,
                actor,
                "assignment.reject",
                "assignment",
                assignment["id"],
                summary,
                before={
                    "status": assignment["status"],
                    "hours_per_week": assignment["hours_per_week"],
                    "pending_hours": assignment["pending_hours"],
                },
                project_id=project["id"],
            )
        return ok({"assignment": serialize(result, project, actor.role) if result else None, "removed": result is None})
