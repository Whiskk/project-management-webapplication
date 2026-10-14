"""Unit tests for the rule-based project insights."""

from dataclasses import replace
from datetime import date
from decimal import Decimal

import pytest

from pm_core.insights import ProjectFacts, project_insights

TODAY = date(2026, 11, 16)
HEALTHY = ProjectFacts(
    status="active", is_archived=False, start_date=date(2026, 11, 2), predicted_end_date=date(2026, 12, 18),
    budget=Decimal(10000), projected_cost=Decimal(5000), team_size=3, pending_hours_requests=0,
    milestones_total=4, milestones_completed=1, milestones_overdue=0, milestones_past_end=0,
)


def codes(facts: ProjectFacts, include_money: bool = True) -> list[str]:
    return [i["code"] for i in project_insights(facts, TODAY, include_money)]


def test_healthy_project_has_no_insights() -> None:
    assert codes(HEALTHY) == []


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({"projected_cost": Decimal(10001)}, ["over_budget"]),
        ({"projected_cost": Decimal(9000)}, ["budget_at_risk"]),
        ({"projected_cost": Decimal(8999)}, []),
        ({"milestones_overdue": 2}, ["milestones_overdue"]),
        ({"predicted_end_date": date(2026, 11, 13)}, ["past_predicted_end"]),
        ({"milestones_past_end": 1}, ["milestones_past_end"]),
        ({"team_size": 0}, ["no_team"]),
        ({"team_size": 0, "status": "planned"}, []),
        ({"milestones_total": 0, "milestones_completed": 0}, ["no_milestones"]),
        ({"milestones_total": 0, "milestones_completed": 0, "start_date": date(2027, 1, 4)}, []),
        ({"pending_hours_requests": 1}, ["hours_awaiting_approval"]),
    ],
)
def test_each_rule(changes: dict, expected: list[str]) -> None:
    assert codes(replace(HEALTHY, **changes)) == expected


def test_insights_are_ordered_by_severity() -> None:
    facts = replace(HEALTHY, pending_hours_requests=1, milestones_past_end=1, projected_cost=Decimal(20000))
    assert codes(facts) == ["over_budget", "milestones_past_end", "hours_awaiting_approval"]


def test_money_insights_hidden_when_viewer_cannot_see_budgets() -> None:
    assert codes(replace(HEALTHY, projected_cost=Decimal(20000)), include_money=False) == []


@pytest.mark.parametrize("changes", [{"is_archived": True}, {"status": "completed"}])
def test_finished_projects_raise_nothing(changes: dict) -> None:
    assert codes(replace(HEALTHY, projected_cost=Decimal(20000), milestones_overdue=3, **changes)) == []


def test_messages_are_specific() -> None:
    [over] = project_insights(replace(HEALTHY, projected_cost=Decimal("10250.50")), TODAY)
    assert over["message"] == "Projected labour cost is $250.50 over budget."
    [late] = project_insights(replace(HEALTHY, predicted_end_date=date(2026, 11, 13)), TODAY)
    assert late["message"] == "The predicted end date has passed with 3 milestone(s) still open."
