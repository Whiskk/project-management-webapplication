"""Integration tests for the scheduled budget monitor."""

import json

import pytest

from conftest import bearer, load_service, make_event, response_json
from pm_core import db

pytestmark = pytest.mark.db

service = load_service("monitor")
SCHEDULED_EVENT = {"source": "aws.events", "detail-type": "Scheduled Event", "detail": {}}


@pytest.fixture
def project(fresh_db: None) -> int:
    """A project whose budget exactly covers EMP001 ($50/h) for 10 h/week over 2 weeks."""
    with db.transaction() as cur:
        cur.execute("UPDATE users SET salary = 104000 WHERE employee_id = 'EMP001'")
        cur.execute(
            "INSERT INTO projects (name, start_date, predicted_end_date, manager_id, budget) "
            "SELECT 'Apollo', '2026-11-02', '2026-11-13', id, 1000 FROM users WHERE employee_id = 'MGR001' "
            "RETURNING id"
        )
        project_id = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO project_assignments (project_id, user_id, hours_per_week) "
            "SELECT %s, id, 10 FROM users WHERE employee_id = 'EMP001'",
            (project_id,),
        )
    return project_id


def set_salary(value: int) -> None:
    with db.transaction() as cur:
        cur.execute("UPDATE users SET salary = %s WHERE employee_id = 'EMP001'", (value,))


def monitor_entries() -> list[dict]:
    with db.transaction() as cur:
        cur.execute("SELECT * FROM audit_log WHERE action LIKE 'monitor.%%' ORDER BY id")
        return cur.fetchall()


def test_scheduled_run_with_nothing_over_budget_records_nothing(project: int) -> None:
    result = service.handler(SCHEDULED_EVENT)
    json.dumps(result)  # Lambda must be able to serialise the scheduled return value
    assert (result["checked"], result["newly_over_budget"]) == (1, [])
    assert monitor_entries() == []


def test_project_pushed_over_budget_is_flagged_once(project: int) -> None:
    set_salary(208000)  # pay rise doubles the cost
    first = service.handler(SCHEDULED_EVENT)
    second = service.handler(SCHEDULED_EVENT)
    assert first["newly_over_budget"] == ["Apollo"]
    assert (second["newly_over_budget"], second["still_over_budget"]) == ([], 1)

    [entry] = monitor_entries()
    assert (entry["action"], entry["actor_employee_id"], entry["actor_name"]) == (
        "monitor.over_budget",
        "SYSTEM",
        "Budget monitor",
    )
    assert entry["summary"] == "Apollo is over budget: projected labour cost $2,000.00 vs budget $1,000.00"
    assert entry["project_id"] == project


def test_recovery_is_recorded(project: int) -> None:
    set_salary(208000)
    service.handler(SCHEDULED_EVENT)
    set_salary(104000)
    result = service.handler(SCHEDULED_EVENT)
    assert result["back_within_budget"] == ["Apollo"]
    assert [e["action"] for e in monitor_entries()] == ["monitor.over_budget", "monitor.within_budget"]


def test_archived_projects_are_ignored(project: int) -> None:
    set_salary(208000)
    with db.transaction() as cur:
        cur.execute("UPDATE projects SET is_archived = TRUE WHERE id = %s", (project,))
    assert service.handler(SCHEDULED_EVENT)["checked"] == 0


def test_admin_can_run_it_on_demand(project: int) -> None:
    set_salary(208000)
    response = service.handler(make_event("POST", "/api/monitor/run", headers=bearer("ADM001")))
    assert response["statusCode"] == 200
    assert response_json(response)["newly_over_budget"] == ["Apollo"]


@pytest.mark.parametrize("as_", ["MGR001", "EMP001"])
def test_only_admins_can_trigger_it(project: int, as_: str) -> None:
    response = service.handler(make_event("POST", "/api/monitor/run", headers=bearer(as_)))
    assert response["statusCode"] == 403


def test_http_callers_cannot_fake_a_scheduled_event(project: int) -> None:
    # A function-URL request carries the payload in its body, never at the top level.
    response = service.handler(make_event("POST", "/api/monitor/run", body=SCHEDULED_EVENT))
    assert response["statusCode"] == 401
