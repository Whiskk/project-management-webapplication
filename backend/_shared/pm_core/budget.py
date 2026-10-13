"""
Project labour cost and the budget rule.

    hourly rate            = annual salary / 2080   (52 weeks x 40 hours)
    weeks in project       = working days / 5
    projected labour cost  = sum(hours_per_week x weeks x hourly rate)

A project's projected labour cost may not exceed its budget. Changes that
would push it over are rejected; changes that reduce cost are always allowed,
so an over-budget project (e.g. after a pay rise) can be brought back in line.
"""

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

import psycopg

from pm_core import workdays
from pm_core.errors import Conflict

ANNUAL_HOURS = Decimal(2080)
CENT = Decimal("0.01")


def money(value: Decimal) -> Decimal:
    """Round to whole cents."""
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def weeks(start: date, end: date) -> Decimal:
    """Number of working weeks in the inclusive date range."""
    return Decimal(workdays.working_days(start, end)) / workdays.DAYS_PER_WEEK


def assignment_cost(hours_per_week: Decimal, salary: Decimal, start: date, end: date) -> Decimal:
    """Labour cost of one assignment over the whole project."""
    return money(Decimal(hours_per_week) * weeks(start, end) * Decimal(salary) / ANNUAL_HOURS)


def projected_cost(
    cur: psycopg.Cursor,
    project_id: int,
    start: date,
    end: date,
    overrides: dict[int, Decimal | None] | None = None,
) -> Decimal:
    """
    Projected labour cost of a project for the given dates.

    Args:
        overrides: ``{user_id: hours}`` to evaluate a proposed change; ``None``
            hours means the assignment is removed. Users not yet assigned are added.
    """
    overrides = dict(overrides or {})
    cur.execute(
        """
        -- Reserved hours: pending requests count against the budget until rejected.
        SELECT a.user_id, COALESCE(a.pending_hours, a.hours_per_week) AS hours_per_week, u.salary
        FROM project_assignments a JOIN users u ON u.id = a.user_id
        WHERE a.project_id = %s
        """,
        (project_id,),
    )
    hours = {row["user_id"]: (row["hours_per_week"], row["salary"]) for row in cur.fetchall()}
    new_ids = [user_id for user_id in overrides if user_id not in hours]
    if new_ids:
        cur.execute("SELECT id, salary FROM users WHERE id = ANY(%s)", (new_ids,))
        for row in cur.fetchall():
            hours[row["id"]] = (Decimal(0), row["salary"])
    for user_id, new_hours in overrides.items():
        if user_id in hours:
            hours[user_id] = (new_hours or Decimal(0), hours[user_id][1])

    return sum(
        (assignment_cost(h, salary, start, end) for h, salary in hours.values() if h),
        Decimal(0),
    )


def check_within_budget(new_cost: Decimal, budget: Decimal, old_cost: Decimal | None = None,
                        old_budget: Decimal | None = None) -> None:
    """
    Raise 409 if a change leaves the project over budget *and* made things worse.

    A change that does not increase cost or reduce budget is always allowed,
    so over-budget projects can still be corrected.
    """
    if new_cost <= budget:
        return
    made_worse = (old_cost is None or new_cost > old_cost) or (old_budget is not None and budget < old_budget)
    if not made_worse:
        return
    over = money(new_cost - budget)
    raise Conflict(
        f"This change would put the project ${over:,.2f} over budget "
        f"(projected labour cost ${money(new_cost):,.2f}, budget ${money(budget):,.2f}).",
        details={"projected_cost": float(money(new_cost)), "budget": float(money(budget)), "over_by": float(over)},
    )
