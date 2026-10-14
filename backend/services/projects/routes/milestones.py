"""
Project milestones with dependencies (under /api/projects/{id}).

    GET    /{id}/milestones                     anyone who can see the project
    POST   /{id}/milestones                     admin, project manager
    PATCH  /{id}/milestones/{milestone_id}      admin, project manager  (PUT accepted later as an alias)
    DELETE /{id}/milestones/{milestone_id}      admin, project manager

Rules:
- A milestone starts on or after the project starts. A due date after the
  project's predicted end is allowed but flagged - that is a schedule slip
  the manager needs to see, not something to hide.
- Dependencies stay within one project and can never form a cycle.
- A milestone cannot start before every milestone it depends on is due.
- A milestone cannot be in progress or completed until its dependencies are
  completed, and cannot be reopened while work that depends on it has started.
- A milestone others depend on cannot be deleted until those links are removed.
- A milestone cannot be marked completed while any of its tasks is open.
  Deleting a milestone deletes its tasks (see routes/tasks.py).
"""

from datetime import date
from typing import Any

import psycopg
from psycopg import sql

from pm_core import audit
from pm_core.audit import Actor
from pm_core.auth import require_auth
from pm_core.db import transaction
from pm_core.errors import Conflict, NotFound, ValidationError
from pm_core.http import Request, Response, Router, created, no_content, ok
from pm_core.validation import Field, parse_id, validate
from queries import fetch_project_for_write, fetch_visible_project
from routes.tasks import load_tasks
from routes.tasks import serialize as serialize_task

STATUSES = ("not_started", "in_progress", "completed", "blocked")
STARTED = ("in_progress", "completed")

SPEC = {
    "title": Field("str", max_length=200),
    "description": Field("str", required=False, max_length=5000),
    "start_date": Field("date"),
    "due_date": Field("date"),
    "status": Field("enum", required=False, choices=STATUSES),
    "depends_on": Field("list", required=False, max_length=50),
}


# --------------------------------------------------------------------------- loading


def _load_milestones(cur: psycopg.Cursor, project_id: int, lock: bool = False) -> dict[int, dict]:
    """All milestones of a project keyed by id, each with its ``depends_on`` ids."""
    query = "SELECT * FROM milestones WHERE project_id = %s ORDER BY start_date, id"
    if lock:
        query += " FOR NO KEY UPDATE"
    cur.execute(query, (project_id,))
    milestones = {row["id"]: {**row, "depends_on": []} for row in cur.fetchall()}
    if milestones:
        cur.execute(
            "SELECT milestone_id, depends_on_id FROM milestone_dependencies WHERE milestone_id = ANY(%s) "
            "ORDER BY depends_on_id",
            (list(milestones),),
        )
        for edge in cur.fetchall():
            milestones[edge["milestone_id"]]["depends_on"].append(edge["depends_on_id"])
    return milestones


def _writable_project(cur: psycopg.Cursor, request: Request) -> dict:
    """Lock a project the caller may plan; archived projects are read-only."""
    project = fetch_project_for_write(cur, request, parse_id(request.params["id"]))
    if project["is_archived"]:
        raise Conflict("Archived projects are read-only. Reactivate it first.")
    return project


# --------------------------------------------------------------------------- rules


def _parse_dependencies(raw: Any, milestones: dict[int, dict], self_id: int | None) -> list[int]:
    """Validate ``depends_on``: a list of other milestone ids in the same project."""
    if not isinstance(raw, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in raw):
        raise ValidationError({"depends_on": "Must be a list of milestone ids"})
    ids = sorted(set(raw))
    if self_id in ids:
        raise ValidationError({"depends_on": "A milestone cannot depend on itself"})
    unknown = [i for i in ids if i not in milestones]
    if unknown:
        raise ValidationError({"depends_on": "Dependencies must be milestones of this project"})
    return ids


def _creates_cycle(milestones: dict[int, dict], milestone_id: int, depends_on: list[int]) -> list[str] | None:
    """
    Return the titles along a cycle if ``milestone_id`` depending on ``depends_on``
    would create one (i.e. one of them already depends on it, directly or not).
    """
    for start in depends_on:
        stack = [(start, [start])]
        seen = set()
        while stack:
            current, path = stack.pop()
            if current == milestone_id:
                return [milestones[i]["title"] for i in [milestone_id, *path]]
            if current in seen:
                continue
            seen.add(current)
            for upstream in milestones[current]["depends_on"]:
                stack.append((upstream, [*path, upstream]))
    return None


def _check_schedule(
    milestones: dict[int, dict],
    milestone_id: int | None,
    title: str,
    start: date,
    due: date,
    depends_on: list[int],
    project: dict,
) -> None:
    """Dates: inside the project start, after dependencies are due, and before dependents start."""
    errors: dict[str, str] = {}
    if due < start:
        errors["due_date"] = "Must be on or after the start date"
    if start < project["start_date"]:
        errors["start_date"] = f"Must be on or after the project start ({project['start_date'].isoformat()})"
    late = [milestones[i] for i in depends_on if milestones[i]["due_date"] > start]
    if late:
        latest = max(late, key=lambda m: m["due_date"])
        errors["start_date"] = f"Must be on or after {latest['due_date'].isoformat()}, when '{latest['title']}' is due"
    if errors:
        raise ValidationError(errors)

    if milestone_id is not None:
        early = [m for m in milestones.values() if milestone_id in m["depends_on"] and m["start_date"] < due]
        if early:
            first = min(early, key=lambda m: m["start_date"])
            raise Conflict(
                f"'{first['title']}' depends on '{title}' and starts on {first['start_date'].isoformat()}, "
                f"before this due date. Move '{first['title']}' first.",
                details={"due_date": f"Must be on or before {first['start_date'].isoformat()}"},
            )


def _check_status(
    milestones: dict[int, dict], milestone_id: int | None, status: str, depends_on: list[int], old_status: str | None
) -> None:
    """Work cannot start before its dependencies are done, or be reopened under started work."""
    if status in STARTED:
        blockers = [milestones[i]["title"] for i in depends_on if milestones[i]["status"] != "completed"]
        if blockers:
            raise Conflict(
                f"Cannot mark as {status.replace('_', ' ')} until these are completed: {', '.join(blockers)}",
                details={"status": "Blocked by incomplete dependencies"},
            )
    if old_status == "completed" and status != "completed" and milestone_id is not None:
        started = [
            m["title"] for m in milestones.values() if milestone_id in m["depends_on"] and m["status"] in STARTED
        ]
        if started:
            raise Conflict(
                f"Cannot reopen: work that depends on it has already started ({', '.join(started)})",
                details={"status": "Dependent milestones have started"},
            )


# --------------------------------------------------------------------------- output


def serialize(
    row: dict, milestones: dict[int, dict], project: dict, today: date, tasks: list[dict], actor: Actor
) -> dict:
    """A milestone with dependency titles, tracking flags and its task checklist."""
    blocked_by = [milestones[i]["title"] for i in row["depends_on"] if milestones[i]["status"] != "completed"]
    return {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "start_date": row["start_date"],
        "due_date": row["due_date"],
        "status": row["status"],
        "completed_at": row["completed_at"],
        "depends_on": [{"id": i, "title": milestones[i]["title"]} for i in row["depends_on"]],
        "dependents": [
            {"id": m["id"], "title": m["title"]} for m in milestones.values() if row["id"] in m["depends_on"]
        ],
        "blocked_by": blocked_by,
        "can_start": not blocked_by,
        "overdue": row["status"] != "completed" and row["due_date"] < today,
        "past_project_end": row["due_date"] > project["predicted_end_date"],
        "tasks": [serialize_task(t, actor, project, blocked_by) for t in tasks],
        "tasks_total": len(tasks),
        "tasks_done": sum(1 for t in tasks if t["completed_at"] is not None),
    }


def summary(milestones: dict[int, dict], today: date, tasks: dict[int, list[dict]]) -> dict:
    """Progress counts for a project's milestones and their tasks."""
    all_tasks = [t for group in tasks.values() for t in group]
    total = len(milestones)
    completed = sum(1 for m in milestones.values() if m["status"] == "completed")
    overdue = sum(1 for m in milestones.values() if m["status"] != "completed" and m["due_date"] < today)
    return {
        "total": total,
        "completed": completed,
        "overdue": overdue,
        "percent_complete": round(completed * 100 / total) if total else 0,
        "tasks_total": len(all_tasks),
        "tasks_done": sum(1 for t in all_tasks if t["completed_at"] is not None),
    }


def _audit_view(row: dict) -> dict:
    keys = ("title", "description", "start_date", "due_date", "status", "depends_on")
    return {key: row[key] for key in keys}


def _today(cur: psycopg.Cursor) -> date:
    cur.execute("SELECT CURRENT_DATE AS today")
    return cur.fetchone()["today"]


def _set_dependencies(cur: psycopg.Cursor, milestone_id: int, depends_on: list[int]) -> None:
    cur.execute("DELETE FROM milestone_dependencies WHERE milestone_id = %s", (milestone_id,))
    for upstream in depends_on:
        cur.execute(
            "INSERT INTO milestone_dependencies (milestone_id, depends_on_id) VALUES (%s, %s)",
            (milestone_id, upstream),
        )


# --------------------------------------------------------------------------- routes


def register(router: Router) -> None:
    """Attach the milestone routes to the service router."""

    @router.get("/{id}/milestones")
    @require_auth()
    def list_milestones(request: Request) -> Response:
        """Milestones in start-date order with dependency and tracking information."""
        with transaction() as cur:
            project = fetch_visible_project(cur, request.actor, parse_id(request.params["id"]))
            milestones = _load_milestones(cur, project["id"])
            tasks = load_tasks(cur, project["id"])
            today = _today(cur)
        actor = request.actor
        return ok(
            {
                "items": [
                    serialize(m, milestones, project, today, tasks.get(m["id"], []), actor) for m in milestones.values()
                ],
                "summary": summary(milestones, today, tasks),
            }
        )

    @router.post("/{id}/milestones")
    @require_auth("admin", "manager")
    def create_milestone(request: Request) -> Response:
        """Add a milestone to the project."""
        data = validate(request.body, SPEC)
        actor = request.actor
        with transaction() as cur:
            project = _writable_project(cur, request)
            milestones = _load_milestones(cur, project["id"], lock=True)
            depends_on = _parse_dependencies(data.get("depends_on", []), milestones, None)
            status = data.get("status", "not_started")
            _check_schedule(milestones, None, data["title"], data["start_date"], data["due_date"], depends_on, project)
            _check_status(milestones, None, status, depends_on, None)
            cur.execute(
                """
                INSERT INTO milestones (project_id, title, description, start_date, due_date, status,
                                        completed_at, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, CASE WHEN %s THEN now() END, %s) RETURNING id
                """,
                (
                    project["id"],
                    data["title"],
                    data.get("description", ""),
                    data["start_date"],
                    data["due_date"],
                    status,
                    status == "completed",
                    actor.id,
                ),
            )
            milestone_id = cur.fetchone()["id"]
            _set_dependencies(cur, milestone_id, depends_on)
            milestones = _load_milestones(cur, project["id"])
            row = milestones[milestone_id]
            audit.record(
                cur,
                actor,
                "milestone.create",
                "milestone",
                milestone_id,
                f"Added milestone '{row['title']}' to {project['name']}",
                after=_audit_view(row),
                project_id=project["id"],
            )
            result = serialize(row, milestones, project, _today(cur), [], actor)
        return created(result)

    @router.patch("/{id}/milestones/{milestone_id}")
    @require_auth("admin", "manager")
    def update_milestone(request: Request) -> Response:
        """Change a milestone's details, dates, status or dependencies."""
        data = validate(request.body, SPEC, partial=True)
        actor = request.actor
        with transaction() as cur:
            project = _writable_project(cur, request)
            milestones = _load_milestones(cur, project["id"], lock=True)
            milestone_id = parse_id(request.params["milestone_id"], "milestone_id")
            before = milestones.get(milestone_id)
            if before is None:
                raise NotFound("Milestone not found")
            depends_on = (
                _parse_dependencies(data["depends_on"], milestones, milestone_id)
                if "depends_on" in data
                else before["depends_on"]
            )
            cycle = _creates_cycle(milestones, milestone_id, depends_on)
            if cycle:
                raise Conflict(
                    f"That would create a circular dependency: {' → '.join(cycle)}",
                    details={"depends_on": "Circular dependency"},
                )
            after = {**before, **{k: v for k, v in data.items() if k != "depends_on"}, "depends_on": depends_on}
            _check_schedule(
                milestones, milestone_id, after["title"], after["start_date"], after["due_date"], depends_on, project
            )
            _check_status(milestones, milestone_id, after["status"], depends_on, before["status"])
            if after["status"] == "completed" and before["status"] != "completed":
                cur.execute(
                    "SELECT COUNT(*) AS n FROM tasks WHERE milestone_id = %s AND completed_at IS NULL", (milestone_id,)
                )
                open_tasks = cur.fetchone()["n"]
                if open_tasks:
                    raise Conflict(
                        f"Cannot mark as completed: {open_tasks} task(s) still open. "
                        "Tick them off or remove them first.",
                        details={"status": "Open tasks remain"},
                    )

            columns = {
                k: data[k]
                for k in ("title", "description", "start_date", "due_date", "status")
                if k in data and data[k] != before[k]
            }
            if columns:
                assignments = [sql.SQL("{} = %s").format(sql.Identifier(c)) for c in columns]
                if "status" in columns:
                    # Completing stamps the time; any other status (e.g. reopening) clears it.
                    assignments.append(
                        sql.SQL("completed_at = now()" if columns["status"] == "completed" else "completed_at = NULL")
                    )
                cur.execute(
                    sql.SQL("UPDATE milestones SET {}, updated_at = now() WHERE id = %s").format(
                        sql.SQL(", ").join(assignments)
                    ),
                    [*columns.values(), milestone_id],
                )
            if depends_on != before["depends_on"]:
                _set_dependencies(cur, milestone_id, depends_on)

            milestones = _load_milestones(cur, project["id"])
            row = milestones[milestone_id]
            changes = audit.diff(_audit_view(before), _audit_view(row))
            if changes:
                audit.record(
                    cur,
                    actor,
                    "milestone.update",
                    "milestone",
                    milestone_id,
                    f"Updated milestone '{row['title']}' on {project['name']}: {', '.join(changes)}",
                    before=_audit_view(before),
                    after=_audit_view(row),
                    project_id=project["id"],
                )
            tasks = load_tasks(cur, project["id"])[milestone_id]
            result = serialize(row, milestones, project, _today(cur), tasks, actor)
        return ok(result)

    @router.delete("/{id}/milestones/{milestone_id}")
    @require_auth("admin", "manager")
    def delete_milestone(request: Request) -> Response:
        """Delete a milestone nobody depends on (the audit log keeps the record)."""
        actor = request.actor
        with transaction() as cur:
            project = _writable_project(cur, request)
            milestones = _load_milestones(cur, project["id"], lock=True)
            milestone_id = parse_id(request.params["milestone_id"], "milestone_id")
            row = milestones.get(milestone_id)
            if row is None:
                raise NotFound("Milestone not found")
            dependents = [m["title"] for m in milestones.values() if milestone_id in m["depends_on"]]
            if dependents:
                raise Conflict(f"Cannot delete: {', '.join(dependents)} depend(s) on it. Remove those links first.")
            cur.execute("SELECT COUNT(*) AS n FROM tasks WHERE milestone_id = %s", (milestone_id,))
            task_count = cur.fetchone()["n"]
            cur.execute("DELETE FROM milestones WHERE id = %s", (milestone_id,))  # its tasks go with it
            with_tasks = f" and its {task_count} task(s)" if task_count else ""
            audit.record(
                cur,
                actor,
                "milestone.delete",
                "milestone",
                milestone_id,
                f"Deleted milestone '{row['title']}'{with_tasks} from {project['name']}",
                before=_audit_view(row),
                project_id=project["id"],
            )
        return no_content()
