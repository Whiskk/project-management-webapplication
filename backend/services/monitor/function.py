"""
Monitor service: the scheduled budget check (asynchronous work).

Runs every hour from an EventBridge schedule (infra/scheduler.tf), and admins
can trigger it on demand:

    POST /api/monitor/run    admin   run the check now and return the result

The check recomputes every current project's projected labour cost and
records state *changes* in the audit log, attributed to "Budget monitor":
a project newly over budget (e.g. after a pay rise or a date change) and a
project back within budget. ``projects.over_budget_since`` remembers the
current state, so a project that stays over budget is reported once.

Why scheduled rather than inline: costs change for reasons outside any
project request (salaries change in the users service, time passes), so a
periodic sweep catches drift that no single request would notice.
"""

import logging
from datetime import UTC, datetime
from decimal import Decimal

from pm_core import audit, budget
from pm_core.auth import require_auth
from pm_core.db import transaction
from pm_core.http import Request, Response, Router, ok

logger = logging.getLogger()
router = Router("monitor")


def run_budget_check(actor: audit.Actor = audit.SYSTEM) -> dict:
    """Flag projects that went over budget and clear ones back within it. Returns a summary."""
    newly_over: list[str] = []
    recovered: list[str] = []
    still_over = 0
    with transaction() as cur:
        cur.execute(
            """
            SELECT id, name, budget, start_date, predicted_end_date, over_budget_since
            FROM projects
            WHERE NOT is_archived AND status <> 'completed'
            ORDER BY id
            FOR NO KEY UPDATE
            """
        )
        projects = cur.fetchall()
        for project in projects:
            cost = budget.projected_cost(cur, project["id"], project["start_date"], project["predicted_end_date"])
            over = cost > project["budget"]
            if over and project["over_budget_since"] is None:
                newly_over.append(project["name"])
                cur.execute("UPDATE projects SET over_budget_since = now() WHERE id = %s", (project["id"],))
                audit.record(
                    cur,
                    actor,
                    "monitor.over_budget",
                    "project",
                    project["id"],
                    f"{project['name']} is over budget: projected labour cost ${budget.money(cost):,.2f} "
                    f"vs budget ${budget.money(Decimal(project['budget'])):,.2f}",
                    project_id=project["id"],
                )
            elif over:
                still_over += 1
            elif project["over_budget_since"] is not None:
                recovered.append(project["name"])
                cur.execute("UPDATE projects SET over_budget_since = NULL WHERE id = %s", (project["id"],))
                audit.record(
                    cur,
                    actor,
                    "monitor.within_budget",
                    "project",
                    project["id"],
                    f"{project['name']} is back within budget",
                    project_id=project["id"],
                )
    summary = {
        "checked": len(projects),
        "newly_over_budget": newly_over,
        "back_within_budget": recovered,
        "still_over_budget": still_over,
        # A string, not a datetime: Lambda JSON-serialises a scheduled invocation's return value.
        "ran_at": datetime.now(UTC).isoformat(),
    }
    logger.info("Budget check: %s", summary)
    return summary


@router.post("/run")
@require_auth("admin")
def run_now(request: Request) -> Response:
    """Run the budget check immediately (admin)."""
    return ok(run_budget_check())


def _is_scheduled_event(event: dict | None) -> bool:
    """
    True for an EventBridge scheduled invocation.

    Function URL (HTTP) events carry the request in ``requestContext``/``body``,
    so an HTTP caller cannot forge these top-level fields.
    """
    return bool(event) and event.get("source") == "aws.events" and event.get("detail-type") == "Scheduled Event"


def handler(event: dict | None = None, context: object = None) -> dict:
    """Lambda entry point: the hourly schedule, or HTTP via the function URL."""
    if _is_scheduled_event(event):
        return run_budget_check()
    return router.handle(event, context)
