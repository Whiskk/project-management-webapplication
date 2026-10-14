"""Integration tests for role dashboards, project insights and salary-change flags."""

from datetime import date, timedelta

import pytest

from conftest import bearer, load_service, make_event, response_json
from pm_core import db

pytestmark = pytest.mark.db

projects = load_service("projects")
users = load_service("users")


def call(svc, method: str, path: str, as_: str, body: object = None) -> tuple[int, dict]:
    prefix = "/api/projects" if svc is projects else "/api/users"
    response = svc.handler(make_event(method, f"{prefix}{path}", body=body, headers=bearer(as_)))
    return response["statusCode"], response_json(response)


def user_id(employee_id: str) -> int:
    with db.transaction() as cur:
        cur.execute("SELECT id FROM users WHERE employee_id = %s", (employee_id,))
        return cur.fetchone()["id"]


@pytest.fixture
def running(fresh_db: None) -> int:
    """An active project running today, EMP001 ($50/h) staffed 10 h/week; budget barely covers it."""
    today = date.today()
    start, end = today - timedelta(days=today.weekday()), today - timedelta(days=today.weekday()) + timedelta(days=11)
    with db.transaction() as cur:
        cur.execute("UPDATE users SET salary = 104000 WHERE employee_id = 'EMP001'")
    _, project = call(
        projects,
        "POST",
        "/",
        "ADM001",
        {
            "name": "Apollo",
            "budget": 1000,
            "manager_id": user_id("MGR001"),
            "status": "active",
            "start_date": start.isoformat(),
            "predicted_end_date": end.isoformat(),
        },
    )
    status, _ = call(
        projects,
        "POST",
        f"/{project['id']}/assignments",
        "MGR001",
        {"user_id": user_id("EMP001"), "hours_per_week": 10},
    )
    assert status == 201
    return project["id"]


def test_project_payload_includes_insights(running: int) -> None:
    _, project = call(projects, "GET", f"/{running}", "MGR001")
    assert [i["code"] for i in project["insights"]] == ["budget_at_risk", "no_milestones"]
    assert project["milestones"] == {"total": 0, "completed": 0, "overdue": 0}

    _, as_employee = call(projects, "GET", f"/{running}", "EMP001")
    assert [i["code"] for i in as_employee["insights"]] == ["no_milestones"]  # no money insights


def test_admin_dashboard(running: int) -> None:
    status, body = call(projects, "GET", "/dashboard", "ADM001")
    assert (status, body["role"]) == (200, "admin")
    stats = body["stats"]
    assert (stats["active_projects"], stats["over_budget"], stats["needing_attention"]) == (1, 0, 1)
    assert stats["people"] == {"admin": 1, "manager": 1, "employee": 1}
    assert stats["total_budget"] == 1000.0
    assert [p["name"] for p in body["attention"]] == ["Apollo"]


def test_manager_dashboard_shows_team_load(running: int) -> None:
    status, body = call(projects, "GET", "/dashboard", "MGR001")
    assert (status, body["role"], body["stats"]["my_projects"]) == (200, "manager", 1)
    [member] = body["team"]
    assert (member["first_name"], member["hours_this_week"], member["available"]) == ("Eli", 10.0, 30.0)


def test_employee_dashboard_shows_week_and_milestones(running: int) -> None:
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    call(
        projects,
        "POST",
        f"/{running}/milestones",
        "MGR001",
        {"title": "Kick-off", "start_date": monday.isoformat(), "due_date": (monday + timedelta(days=9)).isoformat()},
    )
    status, body = call(projects, "GET", "/dashboard", "EMP001")
    assert (status, body["role"]) == (200, "employee")
    assert (body["stats"]["hours_this_week"], body["stats"]["capacity"]) == (10.0, 40.0)
    assert [p["name"] for p in body["projects"]] == ["Apollo"]
    assert "budget" not in body["projects"][0] or body["projects"][0]["budget"] is None
    assert [m["title"] for m in body["upcoming_milestones"]] == ["Kick-off"]


def test_salary_rise_is_allowed_and_names_projects_pushed_over_budget(running: int) -> None:
    status, _ = call(users, "PATCH", f"/{user_id('EMP001')}", "ADM001", {"salary": 208000})
    assert status == 200
    with db.transaction() as cur:
        cur.execute("SELECT summary FROM audit_log WHERE action = 'user.update' ORDER BY id DESC LIMIT 1")
        assert cur.fetchone()["summary"].endswith("now over budget: Apollo")
    _, project = call(projects, "GET", f"/{running}", "MGR001")
    assert project["over_budget"] is True
    assert project["insights"][0]["code"] == "over_budget"


def test_salary_cut_is_not_flagged(running: int) -> None:
    call(users, "PATCH", f"/{user_id('EMP001')}", "ADM001", {"salary": 52000})
    with db.transaction() as cur:
        cur.execute("SELECT summary FROM audit_log WHERE action = 'user.update' ORDER BY id DESC LIMIT 1")
        assert "over budget" not in cur.fetchone()["summary"]
