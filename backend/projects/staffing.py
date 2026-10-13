"""
Staffing rules shared by assignment routes and project edits.

Every check runs inside the caller's transaction after the project row (and
the affected user rows) are locked with ``SELECT ... FOR NO KEY UPDATE``, so two
concurrent requests cannot both pass a check and together break the rule.
Locks are always taken project-first, then users in id order, to avoid deadlocks.
"""

from decimal import Decimal

import psycopg

from pm_core import budget, capacity


def lock_users(cur: psycopg.Cursor, user_ids: list[int]) -> dict[int, dict]:
    """Lock user rows (in id order) and return them by id."""
    if not user_ids:
        return {}
    cur.execute("SELECT * FROM users WHERE id = ANY(%s) ORDER BY id FOR NO KEY UPDATE", (sorted(set(user_ids)),))
    return {row["id"]: row for row in cur.fetchall()}


def team(cur: psycopg.Cursor, project_id: int) -> list[dict]:
    """The project's assignments with their reserved hours (pending requests included)."""
    cur.execute(
        "SELECT user_id, COALESCE(pending_hours, hours_per_week) AS hours_per_week "
        "FROM project_assignments WHERE project_id = %s",
        (project_id,),
    )
    return cur.fetchall()


def is_current(project: dict) -> bool:
    """Whether a project occupies people's time (counts towards the 40-hour rule)."""
    return not project["is_archived"] and project["status"] != "completed"


def check_project_change(cur: psycopg.Cursor, before: dict, after: dict) -> None:
    """
    Validate a change to a project's dates, budget, status or archived flag.

    - Budget: projected labour cost must stay within budget (unless the change
      does not make an over-budget project worse).
    - Capacity: if the project's dates change or it becomes current again,
      every assigned employee must still fit within 40 hours per week.
    """
    dates_changed = (before["start_date"], before["predicted_end_date"]) != (
        after["start_date"], after["predicted_end_date"]
    )
    members = team(cur, before["id"])

    if dates_changed or after["budget"] != before["budget"]:
        old_cost = budget.projected_cost(cur, before["id"], before["start_date"], before["predicted_end_date"])
        new_cost = budget.projected_cost(cur, before["id"], after["start_date"], after["predicted_end_date"])
        budget.check_within_budget(new_cost, after["budget"], old_cost, before["budget"])

    becomes_current = is_current(after) and not is_current(before)
    if members and is_current(after) and (dates_changed or becomes_current):
        users = lock_users(cur, [m["user_id"] for m in members])
        for member in members:
            capacity.check_capacity(cur, users[member["user_id"]], after, Decimal(member["hours_per_week"]))
