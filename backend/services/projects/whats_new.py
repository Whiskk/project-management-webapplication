"""
"What's new" for an employee: recent changes that affect them, made by someone else.

Built from the audit log, so it needs no extra bookkeeping:

* changes *about them* (``subject_user_id``): being staffed, hours changed,
  requests approved or declined, removed from a project, tasks given to them,
  changed, ticked off or deleted;
* changes to projects they are on: new dates, status, archive/reactivate, and
  milestones added, moved, completed or removed.

Each entry is re-worded for the employee here instead of reusing the audit
summary, so nothing an employee may not see (budgets, costs, other people's
hours) can leak through. Entries since their previous sign-in are marked new.
"""

from datetime import date, datetime
from typing import Any

import psycopg

from pm_core.audit import Actor

WINDOW_DAYS = 14
LIMIT = 10

PERSONAL_ACTIONS = [
    "assignment.create",
    "assignment.request",
    "assignment.update",
    "assignment.approve",
    "assignment.reject",
    "assignment.delete",
    "task.create",
    "task.update",
    "task.complete",
    "task.reopen",
    "task.delete",
]
PROJECT_ACTIONS = [
    "project.update",
    "project.archive",
    "project.reactivate",
    "milestone.create",
    "milestone.update",
    "milestone.delete",
]


def _date(value: Any) -> str:
    """'2026-11-30' -> 'Nov 30, 2026'."""
    day = date.fromisoformat(str(value)[:10])
    return f"{day:%b} {day.day}, {day.year}"


def _hours(value: Any) -> str:
    return f"{float(value):g} h/week"


def _label(status: str) -> str:
    return status.replace("_", " ")


class _Entry:
    """One audit row with easy access to its recorded changes."""

    def __init__(self, row: dict) -> None:
        self.row = row
        self.changes: dict = row["changes"] or {}
        self.who = row["actor_name"] or "Someone"
        self.project = row["project_name"] or "a project"

    def changed(self, field: str) -> bool:
        return field in self.changes

    def old(self, field: str) -> Any:
        return self.changes.get(field, {}).get("from")

    def new(self, field: str) -> Any:
        return self.changes.get(field, {}).get("to")

    def title(self) -> str:
        """The task's or milestone's title: current, or as recorded."""
        return self.row["current_title"] or self.new("title") or self.old("title") or "a task"


def _assignment(e: _Entry) -> str | None:
    action = e.row["action"]
    if action == "assignment.create":
        return f"{e.who} added you to {e.project} for {_hours(e.new('hours_per_week'))}"
    if action == "assignment.request":
        if e.changed("user"):
            return (
                f"{e.who} asked for {_hours(e.new('hours_per_week'))} of your time on {e.project}. "
                "It's waiting for your manager's approval."
            )
        if e.new("pending_hours") is not None:
            return (
                f"{e.who} asked to raise your hours on {e.project} to {_hours(e.new('pending_hours'))}. "
                "It's waiting for your manager's approval."
            )
        return f"{e.who} changed the hours requested for you on {e.project} to {_hours(e.new('hours_per_week'))}"
    if action == "assignment.update":
        if e.old("status") == "pending":
            return f"{e.who} added you to {e.project} for {_hours(e.new('hours_per_week'))}"
        if e.changed("hours_per_week"):
            return (
                f"{e.who} changed your hours on {e.project} from {_hours(e.old('hours_per_week'))} "
                f"to {_hours(e.new('hours_per_week'))}"
            )
        return f"The requested increase to your hours on {e.project} was cancelled"
    if action == "assignment.approve":
        return f"{e.who} approved your {_hours(e.new('hours_per_week'))} on {e.project}"
    if action == "assignment.reject":
        if e.old("status") == "pending":
            return f"The request for {_hours(e.old('hours_per_week'))} of your time on {e.project} was declined"
        return (
            f"The requested increase to your hours on {e.project} was declined; "
            f"you stay at {_hours(e.old('hours_per_week'))}"
        )
    if action == "assignment.delete":
        return f"{e.who} removed you from {e.project}"
    return None


def _task(e: _Entry, me: str) -> str | None:
    action, title = e.row["action"], f"'{e.title()}'"
    if action == "task.create":
        return f"{e.who} gave you a new task on {e.project}: {title}"
    if action == "task.update":
        if e.changed("assignee"):
            if e.new("assignee") == me:
                return f"{e.who} gave you the task {title} on {e.project}"
            return f"{e.who} took you off the task {title} on {e.project}"
        return f"{e.who} updated your task {title} on {e.project}"
    if action == "task.complete":
        return f"{e.who} ticked off your task {title} on {e.project}"
    if action == "task.reopen":
        return f"{e.who} reopened your task {title} on {e.project}"
    if action == "task.delete":
        return f"{e.who} deleted your task {title} from {e.project}"
    return None


def _project(e: _Entry) -> str | None:
    action = e.row["action"]
    if action == "project.archive":
        return f"{e.project} was archived"
    if action == "project.reactivate":
        return f"{e.project} was reactivated"
    # Only what employees can see anyway: never the budget or other fields.
    parts = []
    if e.changed("name"):
        parts.append(f"was renamed from {e.old('name')}")
    if e.changed("start_date"):
        parts.append(f"now starts {_date(e.new('start_date'))}")
    if e.changed("predicted_end_date"):
        parts.append(f"now ends {_date(e.new('predicted_end_date'))} (was {_date(e.old('predicted_end_date'))})")
    if e.changed("status"):
        parts.append(f"is now {_label(e.new('status'))}")
    return f"{e.project} {', '.join(parts)}" if parts else None


def _milestone(e: _Entry) -> str | None:
    action, title = e.row["action"], f"'{e.title()}'"
    if action == "milestone.create":
        return f"New milestone on {e.project}: {title}, due {_date(e.new('due_date'))}"
    if action == "milestone.delete":
        return f"The milestone {title} was removed from {e.project}"
    if e.new("status") == "completed":
        return f"The milestone {title} on {e.project} was completed"
    parts = []
    if e.changed("due_date"):
        parts.append(f"is now due {_date(e.new('due_date'))} (was {_date(e.old('due_date'))})")
    if e.changed("status"):
        parts.append(f"is now {_label(e.new('status'))}")
    return f"The milestone {title} on {e.project} {' and '.join(parts)}" if parts else None


def describe(row: dict, my_employee_id: str) -> str | None:
    """The entry in the employee's words, or None if there is nothing they need to know."""
    entry = _Entry(row)
    kind = row["action"].split(".")[0]
    if kind == "assignment":
        return _assignment(entry)
    if kind == "task":
        return _task(entry, my_employee_id)
    if kind == "project":
        return _project(entry)
    return _milestone(entry)


def previous_sign_in(cur: psycopg.Cursor, user_id: int) -> datetime | None:
    """When the user signed in before the current session (None on their first)."""
    cur.execute(
        """
        SELECT occurred_at FROM audit_log
        WHERE action = 'auth.login' AND outcome = 'success' AND actor_id = %s
        ORDER BY occurred_at DESC LIMIT 1 OFFSET 1
        """,
        (user_id,),
    )
    row = cur.fetchone()
    return row["occurred_at"] if row else None


def whats_new(cur: psycopg.Cursor, actor: Actor) -> dict:
    """Up to ten recent changes for the employee, newest first."""
    since = previous_sign_in(cur, actor.id)
    cur.execute(
        """
        SELECT l.id, l.occurred_at, l.action, l.actor_name, l.changes, l.project_id,
               p.name AS project_name,
               COALESCE(t.title, ms.title) AS current_title
        FROM audit_log l
        LEFT JOIN projects p ON p.id = l.project_id
        LEFT JOIN tasks t ON l.entity_type = 'task' AND t.id = l.entity_id
        LEFT JOIN milestones ms ON l.entity_type = 'milestone' AND ms.id = l.entity_id
        WHERE l.outcome = 'success'
          AND l.occurred_at > now() - make_interval(days => %(days)s)
          AND l.actor_id IS DISTINCT FROM %(me)s
          AND (
            (l.subject_user_id = %(me)s AND l.action = ANY(%(personal)s))
            OR (l.action = ANY(%(project_actions)s) AND l.project_id IN (
                SELECT project_id FROM project_assignments WHERE user_id = %(me)s AND status = 'approved'))
          )
        ORDER BY l.occurred_at DESC, l.id DESC
        LIMIT %(scan)s
        """,
        {
            "me": actor.id,
            "days": WINDOW_DAYS,
            "personal": PERSONAL_ACTIONS,
            "project_actions": PROJECT_ACTIONS,
            # Some entries describe nothing an employee needs (e.g. a budget-only edit), so look further.
            "scan": LIMIT * 4,
        },
    )
    items = []
    for row in cur.fetchall():
        text = describe(row, actor.employee_id)
        if text is None:
            continue
        items.append(
            {
                "id": row["id"],
                "occurred_at": row["occurred_at"],
                "kind": row["action"].split(".")[0],
                "text": text,
                "project_id": row["project_id"],
                "project_name": row["project_name"],
                "is_new": since is None or row["occurred_at"] > since,
            }
        )
        if len(items) == LIMIT:
            break
    return {
        "since": since,
        "window_days": WINDOW_DAYS,
        "new_count": sum(1 for item in items if item["is_new"]),
        "items": items,
    }
