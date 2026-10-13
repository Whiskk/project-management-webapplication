"""
The 40-hour working week rule.

An employee's weekly load at any moment is the sum of ``hours_per_week`` of
every current project (not archived, not completed) running at that moment.
Assigning someone to a project is allowed only if their *peak* load during
that project's dates, plus the new hours, stays within 40.

Using the peak (rather than summing every overlapping project) avoids false
rejections: 30h in January plus 30h in March never overlap, so a January-March
project can still take 10h.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

import psycopg
from psycopg import sql

from pm_core.errors import Conflict

MAX_WEEKLY_HOURS = Decimal(40)

# Projects that occupy people's time (alias ``p``). Archived and completed projects do not.
CURRENT_PROJECT = sql.SQL("NOT p.is_archived AND p.status <> 'completed'")


def fmt_hours(hours: Decimal) -> str:
    """Format hours without trailing zeros: 45.0 -> "45", 7.50 -> "7.5"."""
    return f"{Decimal(hours).normalize():f}"


@dataclass(frozen=True)
class Load:
    """Hours per week committed between two dates (inclusive)."""

    start: date
    end: date
    hours: Decimal


@dataclass(frozen=True)
class Peak:
    """The busiest period found within a window."""

    hours: Decimal
    start: date | None
    end: date | None


def peak_load(loads: list[Load], window_start: date, window_end: date) -> Peak:
    """
    Return the highest combined weekly hours within ``[window_start, window_end]``.

    A sweep over interval boundaries: each load adds its hours on its first
    day and removes them the day after its last day.
    """
    events: dict[date, Decimal] = {}
    for load in loads:
        start, end = max(load.start, window_start), min(load.end, window_end)
        if start > end:
            continue
        events[start] = events.get(start, Decimal(0)) + load.hours
        after = end + timedelta(days=1)
        events[after] = events.get(after, Decimal(0)) - load.hours

    best = Peak(Decimal(0), None, None)
    running = Decimal(0)
    days = sorted(events)
    for index, day in enumerate(days):
        running += events[day]
        if running > best.hours:
            period_end = days[index + 1] - timedelta(days=1) if index + 1 < len(days) else window_end
            best = Peak(running, day, period_end)
    return best


def other_loads(cur: psycopg.Cursor, user_id: int, exclude_project_id: int) -> list[Load]:
    """An employee's assignments on other current projects."""
    cur.execute(
        sql.SQL(
            """
            SELECT p.start_date, p.predicted_end_date, a.hours_per_week
            FROM project_assignments a JOIN projects p ON p.id = a.project_id
            WHERE a.user_id = %s AND a.project_id <> %s AND {}
            """
        ).format(CURRENT_PROJECT),
        (user_id, exclude_project_id),
    )
    return [Load(r["start_date"], r["predicted_end_date"], r["hours_per_week"]) for r in cur.fetchall()]


def committed_peak(cur: psycopg.Cursor, user_id: int, project: dict) -> Peak:
    """Peak hours an employee already has on *other* projects during ``project``."""
    loads = other_loads(cur, user_id, project["id"])
    return peak_load(loads, project["start_date"], project["predicted_end_date"])


def check_capacity(cur: psycopg.Cursor, user: dict, project: dict, hours: Decimal) -> None:
    """
    Raise 409 if giving ``user`` ``hours`` per week on ``project`` would exceed 40h in any week.

    ``project`` must contain ``id``, ``start_date`` and ``predicted_end_date``
    (pass proposed new dates when validating a schedule change).
    """
    peak = committed_peak(cur, user["id"], project)
    total = peak.hours + hours
    if total > MAX_WEEKLY_HOURS:
        name = f"{user['first_name']} {user['last_name']}"
        when = f" between {peak.start.isoformat()} and {peak.end.isoformat()}" if peak.start else ""
        available = fmt_hours(max(MAX_WEEKLY_HOURS - peak.hours, Decimal(0)))
        raise Conflict(
            f"{name} would be scheduled for {fmt_hours(total)} hours per week{when} "
            f"(maximum {fmt_hours(MAX_WEEKLY_HOURS)}). They have {available} hours available.",
            details={
                "hours_per_week": f"At most {available} hours available",
                "committed_hours": float(peak.hours),
            },
        )
