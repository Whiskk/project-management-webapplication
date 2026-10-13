"""
Project lookups and visibility rules shared by all project route modules.

Visibility:
    admin     - every project
    manager   - projects they manage
    employee  - non-archived projects they are assigned to
Projects a user cannot see are reported as 404 so their existence is not leaked.
"""

import psycopg
from psycopg import sql

from pm_core import workdays
from pm_core.audit import Actor
from pm_core.auth import deny
from pm_core.errors import NotFound
from pm_core.http import Request

SELECT_PROJECT = sql.SQL(
    """
    SELECT p.*,
           m.first_name || ' ' || m.last_name AS manager_name,
           m.employee_id AS manager_employee_id,
           (SELECT COUNT(*) FROM project_assignments a WHERE a.project_id = p.id) AS team_size
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
        query += sql.SQL(" FOR UPDATE OF p")
    cur.execute(query, [project_id, *params])
    row = cur.fetchone()
    if row is None:
        raise NotFound("Project not found")
    return row


def fetch_project_for_write(cur: psycopg.Cursor, request: Request, project_id: int) -> dict:
    """
    Load and lock a project the caller is about to change.

    Missing projects are 404. A manager acting on someone else's project is
    denied with 403 *and audited*, so admins can see attempted interference.
    """
    cur.execute(SELECT_PROJECT + sql.SQL(" WHERE p.id = %s FOR UPDATE OF p"), (project_id,))
    row = cur.fetchone()
    if row is None:
        raise NotFound("Project not found")
    actor = request.actor
    if actor.role == "manager" and row["manager_id"] != actor.id:
        deny(request, "managers can only change projects they manage", project_id=project_id)
    if actor.role == "employee":
        deny(request, "employees cannot change projects", project_id=project_id)
    return row


def serialize(row: dict, viewer: Actor) -> dict:
    """Public representation of a project. Budgets are hidden from employees."""
    return {
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
        "budget": row["budget"] if viewer.role != "employee" else None,
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
