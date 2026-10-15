"""
Team availability (under /api/projects/availability).

    GET /availability   admin, manager   every active employee's booked hours per week
                        ?start=YYYY-MM-DD (default today; snapped to its Monday) &weeks=1-26 (default 12)

Answers "who is free in March?" before staffing. Each week (Monday to
Friday) shows the employee's *peak* reserved hours across current projects -
the same figure the 40-hour rule checks - split into confirmed hours and
hours awaiting approval. Only totals are returned, never project names, so a
manager learns nothing about projects they cannot otherwise see.

Must be registered before routes matching ``/{id}``.
"""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from psycopg import sql

from pm_core.auth import require_auth
from pm_core.capacity import CURRENT_PROJECT, MAX_WEEKLY_HOURS, Load, peak_load
from pm_core.db import transaction
from pm_core.errors import ValidationError
from pm_core.http import Request, Response, Router, ok

DEFAULT_WEEKS = 12
MAX_WEEKS = 26


def _parse_window(query: dict[str, str]) -> tuple[date, int]:
    """The Monday to start from and the number of weeks."""
    errors: dict[str, str] = {}
    start = datetime.now(UTC).date()
    if query.get("start"):
        try:
            start = date.fromisoformat(query["start"])
        except ValueError:
            errors["start"] = "Must be a date (YYYY-MM-DD)"
    raw_weeks = query.get("weeks", str(DEFAULT_WEEKS))
    if not raw_weeks.isdigit() or not 1 <= int(raw_weeks) <= MAX_WEEKS:
        errors["weeks"] = f"Must be between 1 and {MAX_WEEKS}"
    if errors:
        raise ValidationError(errors)
    return start - timedelta(days=start.weekday()), int(raw_weeks)


def _week(loads: list[Load], confirmed: list[Load], monday: date) -> dict:
    friday = monday + timedelta(days=4)
    booked = peak_load(loads, monday, friday).hours
    approved = min(peak_load(confirmed, monday, friday).hours, booked)
    return {
        "booked": booked,
        "confirmed": approved,
        "pending": booked - approved,
        "free": max(MAX_WEEKLY_HOURS - booked, Decimal(0)),
    }


def register(router: Router) -> None:
    """Attach the availability route. Must be registered before ``/{id}`` routes."""

    @router.get("/availability")
    @require_auth("admin", "manager")
    def availability(request: Request) -> Response:
        """Booked hours per employee per week, for planning who to staff."""
        first_monday, count = _parse_window(request.query)
        mondays = [first_monday + timedelta(weeks=i) for i in range(count)]
        last_friday = mondays[-1] + timedelta(days=4)
        with transaction() as cur:
            cur.execute(
                """
                SELECT u.id, u.employee_id, u.first_name, u.last_name, u.job_title, u.manager_id,
                       m.first_name || ' ' || m.last_name AS manager_name
                FROM users u LEFT JOIN users m ON m.id = u.manager_id
                WHERE u.role = 'employee' AND u.is_active
                ORDER BY u.last_name, u.first_name
                """
            )
            people = cur.fetchall()
            cur.execute(
                sql.SQL(
                    """
                    SELECT a.user_id, a.status, a.hours_per_week, a.pending_hours,
                           p.start_date, p.predicted_end_date
                    FROM project_assignments a JOIN projects p ON p.id = a.project_id
                    WHERE {} AND p.start_date <= %s AND p.predicted_end_date >= %s
                    """
                ).format(CURRENT_PROJECT),
                (last_friday, first_monday),
            )
            assignments = cur.fetchall()

        reserved: dict[int, list[Load]] = {}
        confirmed: dict[int, list[Load]] = {}
        for a in assignments:
            span = (a["start_date"], a["predicted_end_date"])
            # Reserved: a pending increase counts at its requested figure; a pending new one in full.
            reserved.setdefault(a["user_id"], []).append(Load(*span, a["pending_hours"] or a["hours_per_week"]))
            if a["status"] == "approved":
                confirmed.setdefault(a["user_id"], []).append(Load(*span, a["hours_per_week"]))

        actor = request.actor
        return ok(
            {
                "weeks": [{"start": m, "end": m + timedelta(days=4)} for m in mondays],
                "capacity": MAX_WEEKLY_HOURS,
                "people": [
                    {
                        "user_id": person["id"],
                        "employee_id": person["employee_id"],
                        "first_name": person["first_name"],
                        "last_name": person["last_name"],
                        "job_title": person["job_title"],
                        "manager_name": person["manager_name"],
                        "is_my_report": person["manager_id"] == actor.id,
                        "weeks": [
                            _week(reserved.get(person["id"], []), confirmed.get(person["id"], []), m) for m in mondays
                        ],
                    }
                    for person in people
                ],
            }
        )
