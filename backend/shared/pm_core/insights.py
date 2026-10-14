"""
Rule-based project insights.

Deterministic rules over a project's numbers - not AI - that flag what a
manager should look at. Each insight has a stable ``code`` (for the UI and
tests), a ``severity`` (``error`` | ``warning`` | ``info``) and a message.
Money-related insights are omitted for viewers who cannot see budgets.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

# Share of the budget committed at which a project counts as "at risk".
BUDGET_RISK_THRESHOLD = Decimal("0.9")
SEVERITY_ORDER = {"error": 0, "warning": 1, "info": 2}


@dataclass(frozen=True)
class ProjectFacts:
    """The numbers the rules look at."""

    status: str
    is_archived: bool
    start_date: date
    predicted_end_date: date
    budget: Decimal
    projected_cost: Decimal
    team_size: int
    pending_hours_requests: int
    milestones_total: int
    milestones_completed: int
    milestones_overdue: int
    milestones_past_end: int


def _insight(code: str, severity: str, message: str) -> dict:
    return {"code": code, "severity": severity, "message": message}


def project_insights(facts: ProjectFacts, today: date, include_money: bool = True) -> list[dict]:
    """Return insights for a project, most severe first."""
    if facts.is_archived or facts.status == "completed":
        return []
    found: list[dict] = []

    if include_money and facts.budget >= 0:
        if facts.projected_cost > facts.budget:
            over = facts.projected_cost - facts.budget
            found.append(_insight("over_budget", "error", f"Projected labour cost is ${over:,.2f} over budget."))
        elif facts.budget > 0 and facts.projected_cost >= facts.budget * BUDGET_RISK_THRESHOLD:
            used = facts.projected_cost / facts.budget * 100
            found.append(_insight("budget_at_risk", "warning", f"{used:.0f}% of the budget is already committed."))

    if facts.milestones_overdue:
        found.append(_insight("milestones_overdue", "error", f"{facts.milestones_overdue} milestone(s) are overdue."))
    if today > facts.predicted_end_date:
        open_milestones = facts.milestones_total - facts.milestones_completed
        detail = f" with {open_milestones} milestone(s) still open" if open_milestones else ""
        found.append(_insight("past_predicted_end", "error", f"The predicted end date has passed{detail}."))
    if facts.milestones_past_end:
        found.append(
            _insight(
                "milestones_past_end",
                "warning",
                f"{facts.milestones_past_end} milestone(s) are due after the predicted end date.",
            )
        )

    if facts.team_size == 0 and facts.status == "active":
        found.append(_insight("no_team", "warning", "The project is active but nobody is assigned."))
    if facts.milestones_total == 0 and facts.start_date <= today:
        found.append(_insight("no_milestones", "info", "No milestones yet, so progress can't be tracked."))
    if facts.pending_hours_requests:
        found.append(
            _insight(
                "hours_awaiting_approval",
                "info",
                f"{facts.pending_hours_requests} staffing request(s) are awaiting approval.",
            )
        )

    return sorted(found, key=lambda item: SEVERITY_ORDER[item["severity"]])
