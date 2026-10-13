"""
Project staffing routes (under /api/projects/{id}).

    GET    /{id}/assignments                    any role that can see the project
    GET    /{id}/staffing-options               admin, owning manager   employees with availability and cost
    POST   /{id}/assignments                    admin, owning manager   assign an employee {user_id, hours_per_week}
    PATCH  /{id}/assignments/{assignment_id}    admin, owning manager   change hours {hours_per_week}
    DELETE /{id}/assignments/{assignment_id}    admin, owning manager   remove from project

Assigning enforces both rules: no employee above 40 hours in any week, and
projected labour cost within the project budget.
"""

from decimal import Decimal

import psycopg

import staffing
from pm_core import audit, budget, capacity
from pm_core.capacity import fmt_hours
from pm_core.auth import require_auth
from pm_core.db import transaction
from pm_core.errors import Conflict, NotFound, ValidationError
from pm_core.http import Request, Response, Router, created, no_content, ok
from pm_core.validation import Field, parse_id, validate
from project_queries import fetch_project_for_write, fetch_visible_project

HOURS_FIELD = Field("decimal", min_value=Decimal("0.5"), max_value=capacity.MAX_WEEKLY_HOURS)
CREATE_SPEC = {"user_id": Field("int", min_value=1), "hours_per_week": HOURS_FIELD}
UPDATE_SPEC = {"hours_per_week": HOURS_FIELD}


def _name(row: dict) -> str:
    return f"{row['first_name']} {row['last_name']}"


def _writable_project(cur: psycopg.Cursor, request: Request) -> dict:
    """Lock a project the caller may staff; archived projects are read-only."""
    project = fetch_project_for_write(cur, request, parse_id(request.params["id"]))
    if project["is_archived"]:
        raise Conflict("Archived projects are read-only. Reactivate it first.")
    return project


def _fetch_assignment(cur: psycopg.Cursor, project_id: int, assignment_id: int) -> dict:
    cur.execute(
        "SELECT * FROM project_assignments WHERE id = %s AND project_id = %s FOR UPDATE",
        (assignment_id, project_id),
    )
    row = cur.fetchone()
    if row is None:
        raise NotFound("Assignment not found")
    return row


def _check_rules(cur: psycopg.Cursor, project: dict, user: dict, old_hours: Decimal, new_hours: Decimal) -> None:
    """
    Apply the 40-hour and budget rules to a proposed hours change.

    Reducing hours is always allowed: it can only lower load and cost.
    """
    if new_hours <= old_hours:
        return
    if staffing.is_current(project):
        capacity.check_capacity(cur, user, project, new_hours)
    start, end = project["start_date"], project["predicted_end_date"]
    old_cost = budget.projected_cost(cur, project["id"], start, end)
    new_cost = budget.projected_cost(cur, project["id"], start, end, {user["id"]: new_hours})
    budget.check_within_budget(new_cost, project["budget"], old_cost, project["budget"])


def serialize(row: dict, project: dict, viewer_role: str) -> dict:
    """An assignment with the employee's details (cost hidden from employees)."""
    result = {
        "id": row["id"],
        "user_id": row["user_id"],
        "employee_id": row["employee_id"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "job_title": row["job_title"],
        "hours_per_week": row["hours_per_week"],
        "total_hours": row["hours_per_week"] * budget.weeks(project["start_date"], project["predicted_end_date"]),
    }
    if viewer_role != "employee":
        result["cost"] = budget.assignment_cost(
            row["hours_per_week"], row["salary"], project["start_date"], project["predicted_end_date"]
        )
    return result


_SELECT_ASSIGNMENTS = """
    SELECT a.id, a.user_id, a.hours_per_week, u.employee_id, u.first_name, u.last_name, u.job_title, u.salary
    FROM project_assignments a JOIN users u ON u.id = a.user_id
"""


def _load_assignment_view(cur: psycopg.Cursor, assignment_id: int) -> dict:
    cur.execute(_SELECT_ASSIGNMENTS + " WHERE a.id = %s", (assignment_id,))
    return cur.fetchone()


def register(router: Router) -> None:
    """Attach the staffing routes to the service router."""

    @router.get("/{id}/assignments")
    @require_auth()
    def list_assignments(request: Request) -> Response:
        """The project team. Visible to anyone who can see the project."""
        with transaction() as cur:
            project = fetch_visible_project(cur, request.actor, parse_id(request.params["id"]))
            cur.execute(_SELECT_ASSIGNMENTS + " WHERE a.project_id = %s ORDER BY u.last_name, u.first_name",
                        (project["id"],))
            rows = cur.fetchall()
        return ok({"items": [serialize(r, project, request.actor.role) for r in rows]})

    @router.get("/{id}/staffing-options")
    @require_auth("admin", "manager")
    def staffing_options(request: Request) -> Response:
        """
        Active employees with their free hours during this project and the cost of
        one hour per week for the project's duration, so the UI can preview a change.
        """
        with transaction() as cur:
            project = fetch_project_for_write(cur, request, parse_id(request.params["id"]), lock=False)
            cur.execute(
                """
                SELECT u.id, u.employee_id, u.first_name, u.last_name, u.job_title, u.salary,
                       a.id AS assignment_id, a.hours_per_week AS assigned_hours
                FROM users u
                LEFT JOIN project_assignments a ON a.user_id = u.id AND a.project_id = %s
                WHERE u.role = 'employee' AND u.is_active
                ORDER BY u.last_name, u.first_name
                """,
                (project["id"],),
            )
            employees = cur.fetchall()
            weeks = budget.weeks(project["start_date"], project["predicted_end_date"])
            options = []
            for employee in employees:
                peak = capacity.committed_peak(cur, employee["id"], project)
                options.append({
                    "user_id": employee["id"],
                    "employee_id": employee["employee_id"],
                    "first_name": employee["first_name"],
                    "last_name": employee["last_name"],
                    "job_title": employee["job_title"],
                    "assignment_id": employee["assignment_id"],
                    "assigned_hours": employee["assigned_hours"],
                    "committed_hours_elsewhere": peak.hours,
                    "available_hours": max(capacity.MAX_WEEKLY_HOURS - peak.hours, Decimal(0)),
                    # Unrounded (4 dp) so the UI's preview of hours x rate matches the server to the cent.
                    "cost_per_weekly_hour": (weeks * employee["salary"] / budget.ANNUAL_HOURS).quantize(Decimal("0.0001")),
                })
        return ok({"items": options})

    @router.post("/{id}/assignments")
    @require_auth("admin", "manager")
    def create_assignment(request: Request) -> Response:
        """Assign an employee to the project."""
        data = validate(request.body, CREATE_SPEC)
        actor = request.actor
        with transaction() as cur:
            project = _writable_project(cur, request)
            users = staffing.lock_users(cur, [data["user_id"]])
            user = users.get(data["user_id"])
            if user is None or user["role"] != "employee" or not user["is_active"]:
                raise ValidationError({"user_id": "Must be an active employee"})
            cur.execute(
                "SELECT 1 FROM project_assignments WHERE project_id = %s AND user_id = %s",
                (project["id"], user["id"]),
            )
            if cur.fetchone():
                raise Conflict(f"{_name(user)} is already on this project. Change their hours instead.")

            _check_rules(cur, project, user, Decimal(0), data["hours_per_week"])
            cur.execute(
                """
                INSERT INTO project_assignments (project_id, user_id, hours_per_week, assigned_by)
                VALUES (%s, %s, %s, %s) RETURNING id
                """,
                (project["id"], user["id"], data["hours_per_week"], actor.id),
            )
            row = _load_assignment_view(cur, cur.fetchone()["id"])
            audit.record(
                cur, actor, "assignment.create", "assignment", row["id"],
                f"Assigned {_name(user)} to {project['name']} for {fmt_hours(data['hours_per_week'])} h/week",
                after={"user": user["employee_id"], "hours_per_week": data["hours_per_week"]},
                project_id=project["id"],
            )
        return created(serialize(row, project, actor.role))

    @router.patch("/{id}/assignments/{assignment_id}")
    @require_auth("admin", "manager")
    def update_assignment(request: Request) -> Response:
        """Change an employee's hours on the project."""
        data = validate(request.body, UPDATE_SPEC)
        actor = request.actor
        with transaction() as cur:
            project = _writable_project(cur, request)
            assignment = _fetch_assignment(cur, project["id"], parse_id(request.params["assignment_id"], "assignment_id"))
            user = staffing.lock_users(cur, [assignment["user_id"]])[assignment["user_id"]]
            old_hours = Decimal(assignment["hours_per_week"])
            new_hours = data["hours_per_week"]
            if new_hours != old_hours:
                _check_rules(cur, project, user, old_hours, new_hours)
                cur.execute(
                    "UPDATE project_assignments SET hours_per_week = %s, updated_at = now() WHERE id = %s",
                    (new_hours, assignment["id"]),
                )
                audit.record(
                    cur, actor, "assignment.update", "assignment", assignment["id"],
                    f"Changed {_name(user)}'s hours on {project['name']} from {fmt_hours(old_hours)} to {fmt_hours(new_hours)} h/week",
                    before={"hours_per_week": old_hours}, after={"hours_per_week": new_hours},
                    project_id=project["id"],
                )
            row = _load_assignment_view(cur, assignment["id"])
        return ok(serialize(row, project, actor.role))

    @router.delete("/{id}/assignments/{assignment_id}")
    @require_auth("admin", "manager")
    def delete_assignment(request: Request) -> Response:
        """Remove an employee from the project (the audit log keeps the record)."""
        actor = request.actor
        with transaction() as cur:
            project = _writable_project(cur, request)
            assignment = _fetch_assignment(cur, project["id"], parse_id(request.params["assignment_id"], "assignment_id"))
            cur.execute("SELECT * FROM users WHERE id = %s", (assignment["user_id"],))
            user = cur.fetchone()
            cur.execute("DELETE FROM project_assignments WHERE id = %s", (assignment["id"],))
            audit.record(
                cur, actor, "assignment.delete", "assignment", assignment["id"],
                f"Removed {_name(user)} from {project['name']} (was {fmt_hours(assignment['hours_per_week'])} h/week)",
                before={"user": user["employee_id"], "hours_per_week": assignment["hours_per_week"]},
                project_id=project["id"],
            )
        return no_content()
