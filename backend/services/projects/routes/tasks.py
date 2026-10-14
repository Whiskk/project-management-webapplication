"""
Tasks: a checklist inside each milestone (under /api/projects/{id}).

    POST   /{id}/milestones/{milestone_id}/tasks   admin, project manager
    PATCH  /{id}/tasks/{task_id}                   admin, project manager  (title, description, assignee)
    DELETE /{id}/tasks/{task_id}                   admin, project manager
    POST   /{id}/tasks/{task_id}/complete          the assignee, the project manager or an admin
    POST   /{id}/tasks/{task_id}/reopen            the assignee, the project manager or an admin

Tasks are listed with their milestone (GET /{id}/milestones) and, for the
assignee, on their dashboard.

Rules:
- A task has at most one assignee, who must be an approved member of the
  project's team. Removing someone from the project unassigns their open tasks.
- A task cannot be ticked off while its milestone is still waiting on
  incomplete dependencies (the same rule that stops the milestone starting).
- A completed milestone has no open tasks: adding or reopening a task there
  needs the milestone reopened first, and a milestone with open tasks cannot be
  marked completed (enforced in routes/milestones.py).
- Archived projects are read-only.
"""

from collections import defaultdict

import psycopg
from psycopg import sql

from pm_core import audit
from pm_core.audit import Actor
from pm_core.auth import deny, require_auth
from pm_core.db import transaction
from pm_core.errors import Conflict, NotFound, ValidationError
from pm_core.http import Request, Response, Router, created, no_content, ok
from pm_core.validation import Field, parse_id, validate
from queries import fetch_project_for_write, fetch_visible_project

SPEC = {
    "title": Field("str", max_length=200),
    "description": Field("str", required=False, max_length=5000),
    "assignee_id": Field("int", required=False, nullable=True),
}

SELECT_TASK = """
    SELECT t.*, u.first_name AS assignee_first, u.last_name AS assignee_last, u.employee_id AS assignee_employee_id,
           c.first_name AS completer_first, c.last_name AS completer_last
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id
    LEFT JOIN users c ON c.id = t.completed_by
"""


# --------------------------------------------------------------------------- loading and output


def load_tasks(cur: psycopg.Cursor, project_id: int) -> dict[int, list[dict]]:
    """A project's tasks grouped by milestone id, in the order they were added."""
    cur.execute(SELECT_TASK + " WHERE t.project_id = %s ORDER BY t.milestone_id, t.id", (project_id,))
    grouped: dict[int, list[dict]] = defaultdict(list)
    for row in cur.fetchall():
        grouped[row["milestone_id"]].append(row)
    return grouped


def _load_task(cur: psycopg.Cursor, project_id: int, task_id: int) -> dict:
    cur.execute(SELECT_TASK + " WHERE t.id = %s AND t.project_id = %s", (task_id, project_id))
    row = cur.fetchone()
    if row is None:
        raise NotFound("Task not found")
    return row


def _assignee_name(row: dict) -> str | None:
    return f"{row['assignee_first']} {row['assignee_last']}" if row["assignee_id"] else None


def can_tick(actor: Actor, project: dict, task: dict) -> bool:
    """The assignee, the project's manager or an admin may tick a task off (or undo it)."""
    return actor.role == "admin" or actor.id in (project["manager_id"], task["assignee_id"])


def serialize(row: dict, actor: Actor, project: dict, blocked_by: list[str]) -> dict:
    """A task as shown in its milestone's checklist."""
    return {
        "id": row["id"],
        "milestone_id": row["milestone_id"],
        "title": row["title"],
        "description": row["description"],
        "assignee": (
            {"id": row["assignee_id"], "name": _assignee_name(row), "employee_id": row["assignee_employee_id"]}
            if row["assignee_id"]
            else None
        ),
        "done": row["completed_at"] is not None,
        "completed_at": row["completed_at"],
        "completed_by_name": f"{row['completer_first']} {row['completer_last']}" if row["completed_by"] else None,
        "can_tick": can_tick(actor, project, row) and not project["is_archived"],
        # Ticking off waits for the milestone's dependencies, like starting the milestone itself.
        "waiting_on": blocked_by,
    }


def _audit_view(row: dict) -> dict:
    return {
        "title": row["title"],
        "description": row["description"],
        "assignee": row["assignee_employee_id"],
        "done": row["completed_at"] is not None,
    }


# --------------------------------------------------------------------------- rules


def _check_assignee(cur: psycopg.Cursor, project_id: int, assignee_id: int | None) -> None:
    """An assignee must be an approved member of the project's team."""
    if assignee_id is None:
        return
    cur.execute(
        "SELECT 1 FROM project_assignments WHERE project_id = %s AND user_id = %s AND status = 'approved'",
        (project_id, assignee_id),
    )
    if cur.fetchone() is None:
        raise ValidationError({"assignee_id": "Must be an approved member of this project's team"})


def _lock_milestone(cur: psycopg.Cursor, project_id: int, milestone_id: int) -> dict:
    """Lock a milestone (serialising task changes with completing the milestone) and its blockers."""
    cur.execute(
        "SELECT * FROM milestones WHERE id = %s AND project_id = %s FOR NO KEY UPDATE",
        (milestone_id, project_id),
    )
    milestone = cur.fetchone()
    if milestone is None:
        raise NotFound("Milestone not found")
    cur.execute(
        """
        SELECT up.title FROM milestone_dependencies d JOIN milestones up ON up.id = d.depends_on_id
        WHERE d.milestone_id = %s AND up.status <> 'completed' ORDER BY up.title
        """,
        (milestone_id,),
    )
    milestone["blocked_by"] = [r["title"] for r in cur.fetchall()]
    return milestone


def _writable(cur: psycopg.Cursor, request: Request) -> dict:
    project = fetch_project_for_write(cur, request, parse_id(request.params["id"]))
    if project["is_archived"]:
        raise Conflict("Archived projects are read-only. Reactivate it first.")
    return project


def _tick_target(cur: psycopg.Cursor, request: Request) -> tuple[dict, dict, dict]:
    """
    Load the project, task and (locked) milestone for completing or reopening a task.

    The permission check runs before any lock is taken: a denied attempt is
    audited on a separate connection, which must not wait on our own row locks.
    """
    actor = request.actor
    project = fetch_visible_project(cur, actor, parse_id(request.params["id"]))
    task = _load_task(cur, project["id"], parse_id(request.params["task_id"], "task_id"))
    if not can_tick(actor, project, task):
        deny(request, "only the assignee, the project manager or an admin can tick off a task", project["id"])
    if project["is_archived"]:
        raise Conflict("Archived projects are read-only. Reactivate it first.")
    milestone = _lock_milestone(cur, project["id"], task["milestone_id"])
    task = _load_task(cur, project["id"], task["id"])  # re-read under the lock
    return project, task, milestone


# --------------------------------------------------------------------------- routes


def register(router: Router) -> None:
    """Attach the task routes to the service router."""

    @router.post("/{id}/milestones/{milestone_id}/tasks")
    @require_auth("admin", "manager")
    def create_task(request: Request) -> Response:
        """Add a task to a milestone, optionally assigned to a team member."""
        data = validate(request.body, SPEC)
        actor = request.actor
        with transaction() as cur:
            project = _writable(cur, request)
            milestone = _lock_milestone(cur, project["id"], parse_id(request.params["milestone_id"], "milestone_id"))
            if milestone["status"] == "completed":
                raise Conflict(f"'{milestone['title']}' is completed. Reopen it to add tasks.")
            _check_assignee(cur, project["id"], data.get("assignee_id"))
            cur.execute(
                """
                INSERT INTO tasks (milestone_id, project_id, title, description, assignee_id, created_by)
                VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
                """,
                (
                    milestone["id"],
                    project["id"],
                    data["title"],
                    data.get("description", ""),
                    data.get("assignee_id"),
                    actor.id,
                ),
            )
            row = _load_task(cur, project["id"], cur.fetchone()["id"])
            assigned = f" (assigned to {_assignee_name(row)})" if row["assignee_id"] else ""
            audit.record(
                cur,
                actor,
                "task.create",
                "task",
                row["id"],
                f"Added task '{row['title']}' to milestone '{milestone['title']}' on {project['name']}{assigned}",
                after=_audit_view(row),
                project_id=project["id"],
            )
        return created(serialize(row, actor, project, milestone["blocked_by"]))

    @router.patch("/{id}/tasks/{task_id}")
    @require_auth("admin", "manager")
    def update_task(request: Request) -> Response:
        """Rename a task, change its notes, or (re)assign it; ``assignee_id: null`` unassigns."""
        data = validate(request.body, SPEC, partial=True)
        actor = request.actor
        with transaction() as cur:
            project = _writable(cur, request)
            before = _load_task(cur, project["id"], parse_id(request.params["task_id"], "task_id"))
            milestone = _lock_milestone(cur, project["id"], before["milestone_id"])
            if "assignee_id" in data and data["assignee_id"] != before["assignee_id"]:
                _check_assignee(cur, project["id"], data["assignee_id"])
            columns = {k: data[k] for k in ("title", "description", "assignee_id") if k in data}
            if columns:
                sets = [sql.SQL("{} = %s").format(sql.Identifier(column)) for column in columns]
                cur.execute(
                    sql.SQL("UPDATE tasks SET {}, updated_at = now() WHERE id = %s").format(sql.SQL(", ").join(sets)),
                    [*columns.values(), before["id"]],
                )
            row = _load_task(cur, project["id"], before["id"])
            changes = audit.diff(_audit_view(before), _audit_view(row))
            if changes:
                audit.record(
                    cur,
                    actor,
                    "task.update",
                    "task",
                    row["id"],
                    f"Updated task '{row['title']}' on {project['name']}: {', '.join(changes)}",
                    before=_audit_view(before),
                    after=_audit_view(row),
                    project_id=project["id"],
                )
        return ok(serialize(row, actor, project, milestone["blocked_by"]))

    @router.delete("/{id}/tasks/{task_id}")
    @require_auth("admin", "manager")
    def delete_task(request: Request) -> Response:
        """Delete a task (the audit log keeps the record)."""
        actor = request.actor
        with transaction() as cur:
            project = _writable(cur, request)
            row = _load_task(cur, project["id"], parse_id(request.params["task_id"], "task_id"))
            _lock_milestone(cur, project["id"], row["milestone_id"])
            cur.execute("DELETE FROM tasks WHERE id = %s", (row["id"],))
            audit.record(
                cur,
                actor,
                "task.delete",
                "task",
                row["id"],
                f"Deleted task '{row['title']}' from {project['name']}",
                before=_audit_view(row),
                project_id=project["id"],
            )
        return no_content()

    @router.post("/{id}/tasks/{task_id}/complete")
    @require_auth()
    def complete_task(request: Request) -> Response:
        """Tick a task off."""
        actor = request.actor
        with transaction() as cur:
            project, task, milestone = _tick_target(cur, request)
            if milestone["blocked_by"]:
                raise Conflict(
                    f"Tasks in '{milestone['title']}' can't be ticked off until these are completed: "
                    f"{', '.join(milestone['blocked_by'])}"
                )
            if task["completed_at"] is None:
                cur.execute(
                    "UPDATE tasks SET completed_at = now(), completed_by = %s, updated_at = now() WHERE id = %s",
                    (actor.id, task["id"]),
                )
                audit.record(
                    cur,
                    actor,
                    "task.complete",
                    "task",
                    task["id"],
                    f"{actor.name} completed task '{task['title']}' on {project['name']}",
                    before=_audit_view(task),
                    after={**_audit_view(task), "done": True},
                    project_id=project["id"],
                )
            row = _load_task(cur, project["id"], task["id"])
        return ok(serialize(row, actor, project, milestone["blocked_by"]))

    @router.post("/{id}/tasks/{task_id}/reopen")
    @require_auth()
    def reopen_task(request: Request) -> Response:
        """Undo ticking a task off."""
        actor = request.actor
        with transaction() as cur:
            project, task, milestone = _tick_target(cur, request)
            if milestone["status"] == "completed":
                raise Conflict(f"'{milestone['title']}' is completed. Reopen the milestone first.")
            if task["completed_at"] is not None:
                cur.execute(
                    "UPDATE tasks SET completed_at = NULL, completed_by = NULL, updated_at = now() WHERE id = %s",
                    (task["id"],),
                )
                audit.record(
                    cur,
                    actor,
                    "task.reopen",
                    "task",
                    task["id"],
                    f"{actor.name} reopened task '{task['title']}' on {project['name']}",
                    before=_audit_view(task),
                    after={**_audit_view(task), "done": False},
                    project_id=project["id"],
                )
            row = _load_task(cur, project["id"], task["id"])
        return ok(serialize(row, actor, project, milestone["blocked_by"]))


def unassign_open_tasks(cur: psycopg.Cursor, project_id: int, user_id: int) -> int:
    """Clear someone's open tasks on a project (they are leaving it); returns how many."""
    cur.execute(
        "UPDATE tasks SET assignee_id = NULL, updated_at = now() "
        "WHERE project_id = %s AND assignee_id = %s AND completed_at IS NULL",
        (project_id, user_id),
    )
    return cur.rowcount
