"""
Project lookups and visibility rules shared by all project route modules.

Visibility:
    admin     - every project
    manager   - projects they manage
    employee  - non-archived projects they are assigned to
Projects a user cannot see are reported as 404 so their existence is not leaked.
"""

from decimal import Decimal

import psycopg
from psycopg import sql

from pm_core import budget, insights, workdays
from pm_core.audit import Actor
from pm_core.auth import deny
from pm_core.errors import NotFound
from pm_core.http import Request

SELECT_PROJECT = sql.SQL(
    """
    SELECT p.*,
           m.first_name || ' ' || m.last_name AS manager_name,
           m.employee_id AS manager_employee_id,
           (SELECT COUNT(*) FROM project_assignments a WHERE a.project_id = p.id) AS team_size,
           (SELECT COALESCE(json_agg(json_build_object(
                       'hours', COALESCE(a.pending_hours, a.hours_per_week), 'salary', u.salary)), '[]')
            FROM project_assignments a JOIN users u ON u.id = a.user_id
            WHERE a.project_id = p.id) AS labour,
           (SELECT COUNT(*) FROM milestones ms WHERE ms.project_id = p.id) AS milestones_total,
           (SELECT COUNT(*) FROM milestones ms
            WHERE ms.project_id = p.id AND ms.status = 'completed') AS milestones_completed,
           (SELECT COUNT(*) FROM milestones ms
            WHERE ms.project_id = p.id AND ms.status <> 'completed'
              AND ms.due_date < CURRENT_DATE) AS milestones_overdue,
           (SELECT COUNT(*) FROM milestones ms
            WHERE ms.project_id = p.id AND ms.due_date > p.predicted_end_date) AS milestones_past_end,
           (SELECT COUNT(*) FROM project_assignments a
            WHERE a.project_id = p.id
              AND (a.status = 'pending' OR a.pending_hours IS NOT NULL)) AS pending_hours_requests,
           CURRENT_DATE AS today
    FROM projects p
    JOIN users m ON m.id = p.manager_id
    """
)


def visibility_condition(actor: Actor) -> tuple[sql.Composable | None, list]:
    """SQL condition (and params) restricting projects to those ``actor`` may see."""
    if actor.role == "admin":
        return None, []
    if actor.role == "manager":
        return sql.SQL("p.manager_id = %s"), [actor.id]
    return (
        sql.SQL(
            "NOT p.is_archived AND EXISTS "
            "(SELECT 1 FROM project_assignments a WHERE a.project_id = p.id AND a.user_id = %s)"
        ),
        [actor.id],
    )


def fetch_visible_project(cur: psycopg.Cursor, actor: Actor, project_id: int, lock: bool = False) -> dict:
    """Load a project the actor may see, or raise 404."""
    condition, params = visibility_condition(actor)
    query = SELECT_PROJECT + sql.SQL(" WHERE p.id = %s")
    if condition is not None:
        query += sql.SQL(" AND ") + condition
    if lock:
        query += sql.SQL(" FOR NO KEY UPDATE OF p")
    cur.execute(query, [project_id, *params])
    row = cur.fetchone()
    if row is None:
        raise NotFound("Project not found")
    return row


def fetch_project_for_write(cur: psycopg.Cursor, request: Request, project_id: int, lock: bool = True) -> dict:
    """
    Load (and by default lock) a project the caller is about to change.

    Missing projects are 404. A manager acting on someone else's project is
    denied with 403 *and audited*, so admins can see attempted interference.
    """
    query = SELECT_PROJECT + sql.SQL(" WHERE p.id = %s")
    if lock:
        query += sql.SQL(" FOR NO KEY UPDATE OF p")
    cur.execute(query, (project_id,))
    row = cur.fetchone()
    if row is None:
        raise NotFound("Project not found")
    actor = request.actor
    if actor.role == "manager" and row["manager_id"] != actor.id:
        deny(request, "managers can only change projects they manage", project_id=project_id)
    if actor.role == "employee":
        deny(request, "employees cannot change projects", project_id=project_id)
    return row


def labour_summary(row: dict) -> tuple[Decimal, Decimal]:
    """Return ``(allocated hours per week, projected labour cost)`` for a project row."""
    hours = Decimal(0)
    cost = Decimal(0)
    for item in row["labour"]:
        item_hours = Decimal(str(item["hours"]))
        hours += item_hours
        cost += budget.assignment_cost(
            item_hours, Decimal(str(item["salary"])), row["start_date"], row["predicted_end_date"]
        )
    return hours, cost


def attach_my_hours(cur: psycopg.Cursor, actor: Actor, rows: list[dict]) -> None:
    """Add the viewer's own ``hours_per_week`` on each project (shown on employees' lists)."""
    if not rows:
        return
    cur.execute(
        "SELECT project_id, hours_per_week, status, pending_hours FROM project_assignments "
        "WHERE user_id = %s AND project_id = ANY(%s)",
        (actor.id, [row["id"] for row in rows]),
    )
    mine = {r["project_id"]: r for r in cur.fetchall()}
    for row in rows:
        assignment = mine.get(row["id"])
        row["my_assignment"] = assignment


def _my_assignment_fields(assignment: dict | None) -> dict:
    """The viewer's own confirmed hours and any hours awaiting approval."""
    if assignment is None:
        return {"my_hours_per_week": None, "my_pending_hours": None}
    if assignment["status"] == "pending":
        return {"my_hours_per_week": None, "my_pending_hours": assignment["hours_per_week"]}
    return {"my_hours_per_week": assignment["hours_per_week"], "my_pending_hours": assignment["pending_hours"]}


def project_insights(row: dict, cost: Decimal, include_money: bool) -> list[dict]:
    """Rule-based insights for a project row (see pm_core.insights)."""
    facts = insights.ProjectFacts(
        status=row["status"],
        is_archived=row["is_archived"],
        start_date=row["start_date"],
        predicted_end_date=row["predicted_end_date"],
        budget=row["budget"],
        projected_cost=cost,
        team_size=row["team_size"],
        pending_hours_requests=row["pending_hours_requests"],
        milestones_total=row["milestones_total"],
        milestones_completed=row["milestones_completed"],
        milestones_overdue=row["milestones_overdue"],
        milestones_past_end=row["milestones_past_end"],
    )
    return insights.project_insights(facts, row["today"], include_money)


def serialize(row: dict, viewer: Actor) -> dict:
    """Public representation of a project. Budget and cost figures are hidden from employees."""
    allocated_hours, cost = labour_summary(row)
    show_money = viewer.role != "employee"
    return {
        "insights": project_insights(row, cost, show_money),
        "milestones": {
            "total": row["milestones_total"],
            "completed": row["milestones_completed"],
            "overdue": row["milestones_overdue"],
        },
        **(
            {
                "projected_cost": cost,
                "remaining_budget": row["budget"] - cost,
                "over_budget": cost > row["budget"],
            }
            if show_money
            else {}
        ),
        "allocated_hours": allocated_hours,
        **_my_assignment_fields(row.get("my_assignment")),
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "start_date": row["start_date"],
        "predicted_end_date": row["predicted_end_date"],
        "working_days": workdays.working_days(row["start_date"], row["predicted_end_date"]),
        "capacity_hours": workdays.capacity_hours(row["start_date"], row["predicted_end_date"]),
        "manager_id": row["manager_id"],
        "manager_name": row["manager_name"],
        "manager_employee_id": row["manager_employee_id"],
        "budget": row["budget"] if show_money else None,
        "status": row["status"],
        "is_archived": row["is_archived"],
        "archived_at": row["archived_at"],
        "team_size": row["team_size"],
        "created_at": row["created_at"],
    }


def audit_view(row: dict) -> dict:
    """Fields of a project diffed into the audit log."""
    keys = ("name", "description", "start_date", "predicted_end_date", "manager_id", "budget", "status", "is_archived")
    return {key: row[key] for key in keys}
