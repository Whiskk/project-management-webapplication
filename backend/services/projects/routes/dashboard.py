"""
Role dashboards (under /api/projects/dashboard).

    GET /dashboard   any role; the response shape depends on the caller's role

    admin     organisation totals, budget committed, projects needing attention
    manager   my projects needing attention, decisions waiting for me, my team's load this week
    employee  my hours this week, my projects and their timeline, upcoming milestones, my open tasks,
              and what changed for me recently (whats_new.py)

Must be registered before routes matching ``/{id}``.
"""

from decimal import Decimal

import psycopg
from psycopg import sql

from pm_core.audit import Actor
from pm_core.auth import require_auth
from pm_core.capacity import MAX_WEEKLY_HOURS
from pm_core.db import transaction
from pm_core.http import Request, Response, Router, ok
from queries import SELECT_PROJECT, attach_my_hours, serialize, visibility_condition
from whats_new import whats_new

ATTENTION_LIMIT = 8


def _current_projects(cur: psycopg.Cursor, actor: Actor) -> list[dict]:
    """Non-archived projects the actor can see, serialized with insights."""
    condition, params = visibility_condition(actor)
    where = sql.SQL(" WHERE NOT p.is_archived")
    if condition is not None:
        where += sql.SQL(" AND ") + condition
    cur.execute(SELECT_PROJECT + where + sql.SQL(" ORDER BY p.predicted_end_date, p.id"), params)
    rows = cur.fetchall()
    attach_my_hours(cur, actor, rows)
    return [serialize(row, actor) for row in rows]


def _summary(project: dict) -> dict:
    """Compact project entry for dashboard lists."""
    keys = (
        "id",
        "name",
        "status",
        "manager_name",
        "predicted_end_date",
        "budget",
        "projected_cost",
        "over_budget",
        "my_hours_per_week",
        "my_pending_hours",
        "insights",
        "milestones",
    )
    return {key: project.get(key) for key in keys}


def _needs_attention(projects: list[dict]) -> list[dict]:
    """Projects with an error or warning insight, worst first."""
    flagged = [p for p in projects if any(i["severity"] in ("error", "warning") for i in p["insights"])]
    flagged.sort(key=lambda p: (-sum(i["severity"] == "error" for i in p["insights"]), p["predicted_end_date"]))
    return [_summary(p) for p in flagged[:ATTENTION_LIMIT]]


def _count(cur: psycopg.Cursor, query: str, params: tuple = ()) -> int:
    cur.execute(query, params)
    return cur.fetchone()["n"]


def _admin(cur: psycopg.Cursor, actor: Actor) -> dict:
    projects = _current_projects(cur, actor)
    live = [p for p in projects if p["status"] != "completed"]
    cur.execute("SELECT role, COUNT(*) AS n FROM users WHERE is_active GROUP BY role")
    people = {row["role"]: row["n"] for row in cur.fetchall()}
    return {
        "role": "admin",
        "stats": {
            "active_projects": len(live),
            "over_budget": sum(1 for p in live if p["over_budget"]),
            "needing_attention": len(_needs_attention(live)),
            "pending_requests": _count(cur, "SELECT COUNT(*) AS n FROM project_requests WHERE status = 'pending'"),
            "people": {role: people.get(role, 0) for role in ("admin", "manager", "employee")},
            "total_budget": sum((Decimal(p["budget"]) for p in live), Decimal(0)),
            "total_projected_cost": sum((Decimal(p["projected_cost"]) for p in live), Decimal(0)),
        },
        "attention": _needs_attention(live),
    }


def _team_load(cur: psycopg.Cursor, manager_id: int) -> list[dict]:
    """Each direct report's reserved hours on current projects running today."""
    cur.execute(
        """
        SELECT u.id, u.first_name, u.last_name, u.job_title,
               COALESCE(SUM(COALESCE(a.pending_hours, a.hours_per_week))
                        FILTER (WHERE p.id IS NOT NULL), 0) AS hours_this_week
        FROM users u
        LEFT JOIN project_assignments a ON a.user_id = u.id
        LEFT JOIN projects p ON p.id = a.project_id AND NOT p.is_archived AND p.status <> 'completed'
                             AND CURRENT_DATE BETWEEN p.start_date AND p.predicted_end_date
        WHERE u.manager_id = %s AND u.is_active
        GROUP BY u.id
        ORDER BY u.last_name, u.first_name
        """,
        (manager_id,),
    )
    return [
        {**row, "capacity": MAX_WEEKLY_HOURS, "available": max(MAX_WEEKLY_HOURS - row["hours_this_week"], Decimal(0))}
        for row in cur.fetchall()
    ]


def _manager(cur: psycopg.Cursor, actor: Actor) -> dict:
    projects = _current_projects(cur, actor)
    live = [p for p in projects if p["status"] != "completed"]
    return {
        "role": "manager",
        "stats": {
            "my_projects": len(live),
            "needing_attention": len(_needs_attention(live)),
            "approvals_waiting": _count(
                cur,
                """
                SELECT COUNT(*) AS n FROM project_assignments a
                JOIN users u ON u.id = a.user_id JOIN projects p ON p.id = a.project_id
                WHERE u.manager_id = %s AND NOT p.is_archived AND (a.status = 'pending' OR a.pending_hours IS NOT NULL)
                """,
                (actor.id,),
            ),
            "my_pending_requests": _count(
                cur,
                "SELECT COUNT(*) AS n FROM project_requests WHERE status = 'pending' AND requested_by = %s",
                (actor.id,),
            ),
        },
        "attention": _needs_attention(live),
        "projects": [_summary(p) for p in live],
        "team": _team_load(cur, actor.id),
    }


def _schedule(cur: psycopg.Cursor, user_id: int) -> list[dict]:
    """
    The employee's current projects for their timeline: dates, hours and milestones.

    ``hours_per_week`` is confirmed time (null while a new assignment awaits
    approval); ``pending_hours`` is time awaiting their manager's approval, as
    on the project team list.
    """
    cur.execute(
        """
        SELECT p.id AS project_id, p.name, p.status, p.start_date, p.predicted_end_date,
               CASE WHEN a.status = 'approved' THEN a.hours_per_week END AS hours_per_week,
               CASE WHEN a.status = 'pending' THEN a.hours_per_week ELSE a.pending_hours END AS pending_hours
        FROM project_assignments a JOIN projects p ON p.id = a.project_id
        WHERE a.user_id = %s AND NOT p.is_archived AND p.status <> 'completed'
        ORDER BY p.start_date, p.id
        """,
        (user_id,),
    )
    schedule = [{**row, "milestones": []} for row in cur.fetchall()]
    by_project = {entry["project_id"]: entry for entry in schedule}
    if by_project:
        cur.execute(
            "SELECT id, project_id, title, due_date, status FROM milestones WHERE project_id = ANY(%s) "
            "ORDER BY due_date, id",
            (list(by_project),),
        )
        for milestone in cur.fetchall():
            project_id = milestone.pop("project_id")
            by_project[project_id]["milestones"].append(milestone)
    return schedule


def _employee(cur: psycopg.Cursor, actor: Actor) -> dict:
    projects = _current_projects(cur, actor)
    live = [p for p in projects if p["status"] != "completed"]
    cur.execute(
        """
        SELECT COALESCE(SUM(a.hours_per_week) FILTER (WHERE a.status = 'approved'), 0) AS confirmed,
               COALESCE(SUM(COALESCE(a.pending_hours, a.hours_per_week))
                        FILTER (WHERE a.status = 'pending' OR a.pending_hours IS NOT NULL), 0) AS awaiting
        FROM project_assignments a JOIN projects p ON p.id = a.project_id
        WHERE a.user_id = %s AND NOT p.is_archived AND p.status <> 'completed'
          AND CURRENT_DATE BETWEEN p.start_date AND p.predicted_end_date
        """,
        (actor.id,),
    )
    week = cur.fetchone()
    cur.execute(
        """
        SELECT ms.id, ms.title, ms.due_date, ms.status, p.id AS project_id, p.name AS project_name,
               ms.due_date < CURRENT_DATE AS overdue
        FROM milestones ms
        JOIN projects p ON p.id = ms.project_id
        JOIN project_assignments a ON a.project_id = p.id AND a.user_id = %s
        WHERE NOT p.is_archived AND ms.status <> 'completed'
        ORDER BY ms.due_date, ms.id
        LIMIT 6
        """,
        (actor.id,),
    )
    upcoming = cur.fetchall()
    # Open tasks assigned to me, soonest milestone first. "waiting" = the milestone
    # still depends on unfinished work, so the task cannot be ticked off yet.
    cur.execute(
        """
        SELECT t.id, t.title, ms.id AS milestone_id, ms.title AS milestone_title, ms.due_date,
               p.id AS project_id, p.name AS project_name,
               EXISTS (SELECT 1 FROM milestone_dependencies d JOIN milestones up ON up.id = d.depends_on_id
                       WHERE d.milestone_id = ms.id AND up.status <> 'completed') AS waiting
        FROM tasks t
        JOIN milestones ms ON ms.id = t.milestone_id
        JOIN projects p ON p.id = t.project_id
        WHERE t.assignee_id = %s AND t.completed_at IS NULL AND NOT p.is_archived
        ORDER BY ms.due_date, t.id
        """,
        (actor.id,),
    )
    my_tasks = cur.fetchall()
    return {
        "schedule": _schedule(cur, actor.id),
        "role": "employee",
        "stats": {
            "hours_this_week": week["confirmed"],
            "hours_awaiting_approval": week["awaiting"],
            "capacity": MAX_WEEKLY_HOURS,
            "my_projects": len(live),
            "open_tasks": len(my_tasks),
        },
        "projects": [_summary(p) for p in live],
        "upcoming_milestones": upcoming,
        "my_tasks": my_tasks,
        "whats_new": whats_new(cur, actor),
    }


def register(router: Router) -> None:
    """Attach the dashboard route. Must be registered before ``/{id}`` routes."""

    @router.get("/dashboard")
    @require_auth()
    def dashboard(request: Request) -> Response:
        """The signed-in user's dashboard; contents depend on their role."""
        builders = {"admin": _admin, "manager": _manager, "employee": _employee}
        with transaction() as cur:
            data = builders[request.actor.role](cur, request.actor)
        return ok(data)
