"""
Project staffing routes (under /api/projects/{id}).

    GET    /{id}/assignments                    any role that can see the project
    GET    /{id}/staffing-options               admin, owning manager   employees with availability and cost
    POST   /{id}/assignments                    admin, owning manager   assign an employee {user_id, hours_per_week}
    PATCH  /{id}/assignments/{assignment_id}    admin, owning manager   change hours {hours_per_week}
    DELETE /{id}/assignments/{assignment_id}    admin, owning manager   remove from project

Assigning enforces both rules: no employee above 40 hours in any week, and
projected labour cost within the project budget.

Cross-team approval: when the person staffing an employee is not that
employee's own manager (admins included), new assignments and hour
*increases* are created as pending requests for the employee's manager to
approve (see routes/approvals.py). Pending hours are reserved - they already count
towards both rules - so approving can never break them. Reductions and
removals always apply immediately.
"""

from decimal import Decimal

import psycopg

import staffing
from pm_core import audit, budget, capacity
from pm_core.audit import Actor
from pm_core.auth import require_auth
from pm_core.capacity import fmt_hours
from pm_core.db import transaction
from pm_core.errors import Conflict, NotFound, ValidationError
from pm_core.http import Request, Response, Router, created, no_content, ok
from pm_core.validation import Field, parse_id, validate
from queries import fetch_project_for_write, fetch_visible_project
from routes.tasks import unassign_open_tasks

HOURS_FIELD = Field("decimal", min_value=Decimal("0.5"), max_value=capacity.MAX_WEEKLY_HOURS)
CREATE_SPEC = {"user_id": Field("int", min_value=1), "hours_per_week": HOURS_FIELD}
UPDATE_SPEC = {"hours_per_week": HOURS_FIELD}


def name(row: dict) -> str:
    """Full name of a user-like row."""
    return f"{row['first_name']} {row['last_name']}"


def needs_approval(actor: Actor, employee: dict) -> bool:
    """Hours for someone else's report must be approved by the employee's own manager."""
    return employee["manager_id"] != actor.id


def reserved_hours(assignment: dict) -> Decimal:
    """Hours an assignment holds against the rules (a pending increase counts in full)."""
    return Decimal(assignment["pending_hours"] or assignment["hours_per_week"])


def _writable_project(cur: psycopg.Cursor, request: Request) -> dict:
    """Lock a project the caller may staff; archived projects are read-only."""
    project = fetch_project_for_write(cur, request, parse_id(request.params["id"]))
    if project["is_archived"]:
        raise Conflict("Archived projects are read-only. Reactivate it first.")
    return project


def fetch_assignment(cur: psycopg.Cursor, project_id: int, assignment_id: int) -> dict:
    """Lock and return an assignment on the given project, or raise 404."""
    cur.execute(
        "SELECT * FROM project_assignments WHERE id = %s AND project_id = %s FOR NO KEY UPDATE",
        (assignment_id, project_id),
    )
    row = cur.fetchone()
    if row is None:
        raise NotFound("Assignment not found")
    return row


def _check_rules(cur: psycopg.Cursor, project: dict, user: dict, old_hours: Decimal, new_hours: Decimal) -> None:
    """
    Apply the 40-hour and budget rules to a change in reserved hours.

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


_SELECT_ASSIGNMENTS = """
    SELECT a.id, a.user_id, a.hours_per_week, a.status, a.pending_hours, a.requested_at,
           u.employee_id, u.first_name, u.last_name, u.job_title, u.salary, u.manager_id,
           m.first_name || ' ' || m.last_name AS approver_name,
           r.first_name || ' ' || r.last_name AS requested_by_name
    FROM project_assignments a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN users m ON m.id = u.manager_id
    LEFT JOIN users r ON r.id = a.requested_by
"""


def load_assignment_view(cur: psycopg.Cursor, assignment_id: int) -> dict:
    """An assignment joined with the employee, their manager and the requester."""
    cur.execute(_SELECT_ASSIGNMENTS + " WHERE a.id = %s", (assignment_id,))
    return cur.fetchone()


def serialize(row: dict, project: dict, viewer_role: str) -> dict:
    """
    An assignment with the employee's details and approval state.

    ``hours_per_week`` is the confirmed figure (``None`` while a new assignment
    awaits approval); ``pending_hours`` is what is waiting for approval. Totals
    and cost use reserved hours, matching what the budget counts.
    """
    pending_new = row["status"] == "pending"
    confirmed = None if pending_new else row["hours_per_week"]
    pending = row["hours_per_week"] if pending_new else row["pending_hours"]
    reserved = reserved_hours(row)
    weeks = budget.weeks(project["start_date"], project["predicted_end_date"])
    result = {
        "id": row["id"],
        "user_id": row["user_id"],
        "employee_id": row["employee_id"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "job_title": row["job_title"],
        "status": row["status"],
        "hours_per_week": confirmed,
        "pending_hours": pending,
        "reserved_hours": reserved,
        "awaiting_approval": pending is not None,
        "approver_name": row["approver_name"],
        "requested_by_name": row["requested_by_name"] if pending is not None else None,
        "requested_at": row["requested_at"] if pending is not None else None,
        "total_hours": reserved * weeks,
    }
    if viewer_role != "employee":
        result["cost"] = budget.assignment_cost(
            reserved, row["salary"], project["start_date"], project["predicted_end_date"]
        )
    return result


def register(router: Router) -> None:
    """Attach the staffing routes to the service router."""

    @router.get("/{id}/assignments")
    @require_auth()
    def list_assignments(request: Request) -> Response:
        """The project team. Visible to anyone who can see the project."""
        with transaction() as cur:
            project = fetch_visible_project(cur, request.actor, parse_id(request.params["id"]))
            cur.execute(
                _SELECT_ASSIGNMENTS + " WHERE a.project_id = %s ORDER BY u.last_name, u.first_name", (project["id"],)
            )
            rows = cur.fetchall()
        return ok({"items": [serialize(r, project, request.actor.role) for r in rows]})

    @router.get("/{id}/staffing-options")
    @require_auth("admin", "manager")
    def staffing_options(request: Request) -> Response:
        """
        Active employees with their free hours during this project, the cost of one
        hour per week over the project, and whether their hours need approval.
        """
        actor = request.actor
        with transaction() as cur:
            project = fetch_project_for_write(cur, request, parse_id(request.params["id"]), lock=False)
            cur.execute(
                """
                SELECT u.id, u.employee_id, u.first_name, u.last_name, u.job_title, u.salary, u.manager_id,
                       m.first_name || ' ' || m.last_name AS manager_name,
                       a.id AS assignment_id, a.hours_per_week AS assigned_hours
                FROM users u
                LEFT JOIN users m ON m.id = u.manager_id
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
                options.append(
                    {
                        "user_id": employee["id"],
                        "employee_id": employee["employee_id"],
                        "first_name": employee["first_name"],
                        "last_name": employee["last_name"],
                        "job_title": employee["job_title"],
                        "manager_name": employee["manager_name"],
                        "needs_approval": needs_approval(actor, employee),
                        "assignment_id": employee["assignment_id"],
                        "assigned_hours": employee["assigned_hours"],
                        "committed_hours_elsewhere": peak.hours,
                        "available_hours": max(capacity.MAX_WEEKLY_HOURS - peak.hours, Decimal(0)),
                        # Unrounded (4 dp) so the UI's preview of hours x rate matches the server to the cent.
                        "cost_per_weekly_hour": (weeks * employee["salary"] / budget.ANNUAL_HOURS).quantize(
                            Decimal("0.0001")
                        ),
                    }
                )
        return ok({"items": options})

    @router.post("/{id}/assignments")
    @require_auth("admin", "manager")
    def create_assignment(request: Request) -> Response:
        """Assign an employee; pending until approved if they report to someone else."""
        data = validate(request.body, CREATE_SPEC)
        actor = request.actor
        hours = data["hours_per_week"]
        with transaction() as cur:
            project = _writable_project(cur, request)
            user = staffing.lock_users(cur, [data["user_id"]]).get(data["user_id"])
            if user is None or user["role"] != "employee" or not user["is_active"]:
                raise ValidationError({"user_id": "Must be an active employee"})
            cur.execute(
                "SELECT 1 FROM project_assignments WHERE project_id = %s AND user_id = %s",
                (project["id"], user["id"]),
            )
            if cur.fetchone():
                raise Conflict(f"{name(user)} is already on this project. Change their hours instead.")

            _check_rules(cur, project, user, Decimal(0), hours)
            pending = needs_approval(actor, user)
            cur.execute(
                """
                INSERT INTO project_assignments (project_id, user_id, hours_per_week, assigned_by,
                                                 status, requested_by, requested_at)
                VALUES (%s, %s, %s, %s, %s, %s, CASE WHEN %s THEN now() END) RETURNING id
                """,
                (
                    project["id"],
                    user["id"],
                    hours,
                    actor.id,
                    "pending" if pending else "approved",
                    actor.id if pending else None,
                    pending,
                ),
            )
            row = load_assignment_view(cur, cur.fetchone()["id"])
            if pending:
                summary = (
                    f"Requested {fmt_hours(hours)} h/week of {name(user)} on {project['name']} "
                    f"(awaiting approval from {row['approver_name']})"
                )
            else:
                summary = f"Assigned {name(user)} to {project['name']} for {fmt_hours(hours)} h/week"
            audit.record(
                cur,
                actor,
                "assignment.request" if pending else "assignment.create",
                "assignment",
                row["id"],
                summary,
                after={"user": user["employee_id"], "hours_per_week": hours, "status": row["status"]},
                project_id=project["id"],
                subject_user_id=user["id"],
            )
        return created(serialize(row, project, actor.role))

    @router.patch("/{id}/assignments/{assignment_id}")
    @require_auth("admin", "manager")
    def update_assignment(request: Request) -> Response:
        """
        Change an employee's hours.

        Increases by anyone other than the employee's own manager become a pending
        request; decreases apply immediately and cancel any pending increase.
        """
        data = validate(request.body, UPDATE_SPEC)
        actor = request.actor
        new_hours = data["hours_per_week"]
        with transaction() as cur:
            project = _writable_project(cur, request)
            assignment = fetch_assignment(
                cur, project["id"], parse_id(request.params["assignment_id"], "assignment_id")
            )
            user = staffing.lock_users(cur, [assignment["user_id"]])[assignment["user_id"]]
            old_reserved = reserved_hours(assignment)
            confirmed = Decimal(assignment["hours_per_week"])
            approval = needs_approval(actor, user)
            _check_rules(cur, project, user, old_reserved, new_hours)

            if assignment["status"] == "pending":
                # Still a request: the requester adjusts it (or the employee's manager settles it now).
                columns = {"hours_per_week": new_hours}
                if not approval:
                    columns |= {"status": "approved", "requested_by": None, "requested_at": None}
                action = "assignment.request" if approval else "assignment.update"
                summary = (
                    f"Changed requested hours of {name(user)} on {project['name']} to {fmt_hours(new_hours)} h/week"
                    if approval
                    else f"Assigned {name(user)} to {project['name']} for {fmt_hours(new_hours)} h/week"
                )
            elif approval and new_hours > confirmed:
                columns = {"pending_hours": new_hours, "requested_by": actor.id, "requested_at": "now"}
                action = "assignment.request"
                summary = (
                    f"Requested an increase for {name(user)} on {project['name']} from {fmt_hours(confirmed)} "
                    f"to {fmt_hours(new_hours)} h/week (awaiting approval from {user_manager_name(cur, user)})"
                )
            else:
                columns = {
                    "hours_per_week": new_hours,
                    "pending_hours": None,
                    "requested_by": None,
                    "requested_at": None,
                }
                action = "assignment.update"
                summary = (
                    f"Changed {name(user)}'s hours on {project['name']} from {fmt_hours(confirmed)} "
                    f"to {fmt_hours(new_hours)} h/week"
                )

            before_state = {
                "hours_per_week": confirmed,
                "pending_hours": assignment["pending_hours"],
                "status": assignment["status"],
            }
            after_state = {key: columns.get(key, value) for key, value in before_state.items()}
            if after_state != before_state:
                _update_assignment(cur, assignment["id"], columns)
                audit.record(
                    cur,
                    actor,
                    action,
                    "assignment",
                    assignment["id"],
                    summary,
                    before=before_state,
                    after=after_state,
                    project_id=project["id"],
                    subject_user_id=user["id"],
                )
            row = load_assignment_view(cur, assignment["id"])
        return ok(serialize(row, project, actor.role))

    @router.delete("/{id}/assignments/{assignment_id}")
    @require_auth("admin", "manager")
    def delete_assignment(request: Request) -> Response:
        """Remove an employee from the project, cancelling any pending request (audited)."""
        actor = request.actor
        with transaction() as cur:
            project = _writable_project(cur, request)
            assignment = fetch_assignment(
                cur, project["id"], parse_id(request.params["assignment_id"], "assignment_id")
            )
            cur.execute("SELECT * FROM users WHERE id = %s", (assignment["user_id"],))
            user = cur.fetchone()
            cur.execute("DELETE FROM project_assignments WHERE id = %s", (assignment["id"],))
            unassigned = unassign_open_tasks(cur, project["id"], user["id"])
            state = " (pending request cancelled)" if assignment["status"] == "pending" else ""
            if unassigned:
                state += f"; unassigned from {unassigned} open task(s)"
            audit.record(
                cur,
                actor,
                "assignment.delete",
                "assignment",
                assignment["id"],
                f"Removed {name(user)} from {project['name']} "
                f"(was {fmt_hours(assignment['hours_per_week'])} h/week){state}",
                before={
                    "user": user["employee_id"],
                    "hours_per_week": assignment["hours_per_week"],
                    "status": assignment["status"],
                },
                project_id=project["id"],
                subject_user_id=user["id"],
            )
        return no_content()


def user_manager_name(cur: psycopg.Cursor, user: dict) -> str:
    """Name of an employee's reporting manager (the approver)."""
    cur.execute("SELECT first_name, last_name FROM users WHERE id = %s", (user["manager_id"],))
    manager = cur.fetchone()
    return name(manager) if manager else "their manager"


def _update_assignment(cur: psycopg.Cursor, assignment_id: int, columns: dict) -> None:
    """Write assignment columns; the value ``"now"`` for requested_at means the current time."""
    sets, params = [], []
    for column, value in columns.items():
        if column == "requested_at" and value == "now":
            sets.append(psycopg.sql.SQL("requested_at = now()"))
        else:
            sets.append(psycopg.sql.SQL("{} = %s").format(psycopg.sql.Identifier(column)))
            params.append(value)
    sets.append(psycopg.sql.SQL("updated_at = now()"))
    cur.execute(
        psycopg.sql.SQL("UPDATE project_assignments SET {} WHERE id = %s").format(psycopg.sql.SQL(", ").join(sets)),
        [*params, assignment_id],
    )
