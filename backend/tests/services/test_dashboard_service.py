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
    """An active project running today, EE3H9W ($50/h) staffed 10 h/week; budget barely covers it."""
    today = date.today()
    start, end = today - timedelta(days=today.weekday()), today - timedelta(days=today.weekday()) + timedelta(days=11)
    with db.transaction() as cur:
        cur.execute("UPDATE users SET salary = 104000 WHERE employee_id = 'EE3H9W'")
    _, project = call(
        projects,
        "POST",
        "/",
        "AA7K2P",
        {
            "name": "Apollo",
            "budget": 1000,
            "manager_id": user_id("MM4R8T"),
            "status": "active",
            "start_date": start.isoformat(),
            "predicted_end_date": end.isoformat(),
        },
    )
    status, _ = call(
        projects,
        "POST",
        f"/{project['id']}/assignments",
        "MM4R8T",
        {"user_id": user_id("EE3H9W"), "hours_per_week": 10},
    )
    assert status == 201
    return project["id"]


def test_project_payload_includes_insights(running: int) -> None:
    _, project = call(projects, "GET", f"/{running}", "MM4R8T")
    assert [i["code"] for i in project["insights"]] == ["budget_at_risk", "no_milestones"]
    assert project["milestones"] == {"total": 0, "completed": 0, "overdue": 0}

    _, as_employee = call(projects, "GET", f"/{running}", "EE3H9W")
    assert [i["code"] for i in as_employee["insights"]] == ["no_milestones"]  # no money insights


def test_admin_dashboard(running: int) -> None:
    status, body = call(projects, "GET", "/dashboard", "AA7K2P")
    assert (status, body["role"]) == (200, "admin")
    stats = body["stats"]
    assert (stats["active_projects"], stats["over_budget"], stats["needing_attention"]) == (1, 0, 1)
    assert stats["people"] == {"admin": 1, "manager": 1, "employee": 1}
    assert stats["total_budget"] == 1000.0
    assert [p["name"] for p in body["attention"]] == ["Apollo"]


def test_manager_dashboard_shows_team_load(running: int) -> None:
    status, body = call(projects, "GET", "/dashboard", "MM4R8T")
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
        "MM4R8T",
        {"title": "Kick-off", "start_date": monday.isoformat(), "due_date": (monday + timedelta(days=9)).isoformat()},
    )
    status, body = call(projects, "GET", "/dashboard", "EE3H9W")
    assert (status, body["role"]) == (200, "employee")
    assert (body["stats"]["hours_this_week"], body["stats"]["capacity"]) == (10.0, 40.0)
    assert [p["name"] for p in body["projects"]] == ["Apollo"]
    assert "budget" not in body["projects"][0] or body["projects"][0]["budget"] is None
    assert [m["title"] for m in body["upcoming_milestones"]] == ["Kick-off"]


def test_salary_rise_is_allowed_and_names_projects_pushed_over_budget(running: int) -> None:
    status, _ = call(users, "PATCH", f"/{user_id('EE3H9W')}", "AA7K2P", {"salary": 208000})
    assert status == 200
    with db.transaction() as cur:
        cur.execute("SELECT summary FROM audit_log WHERE action = 'user.update' ORDER BY id DESC LIMIT 1")
        assert cur.fetchone()["summary"].endswith("now over budget: Apollo")
    _, project = call(projects, "GET", f"/{running}", "MM4R8T")
    assert project["over_budget"] is True
    assert project["insights"][0]["code"] == "over_budget"


def test_salary_cut_is_not_flagged(running: int) -> None:
    call(users, "PATCH", f"/{user_id('EE3H9W')}", "AA7K2P", {"salary": 52000})
    with db.transaction() as cur:
        cur.execute("SELECT summary FROM audit_log WHERE action = 'user.update' ORDER BY id DESC LIMIT 1")
        assert "over budget" not in cur.fetchone()["summary"]


def test_employee_schedule_lists_projects_with_hours_and_milestones(running: int) -> None:
    """The timeline gets each current project's dates, confirmed and pending hours, and every milestone."""
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    for title, due in (("Launch", 9), ("Kick-off", 4)):
        call(
            projects,
            "POST",
            f"/{running}/milestones",
            "MM4R8T",
            {"title": title, "start_date": monday.isoformat(), "due_date": (monday + timedelta(days=due)).isoformat()},
        )
    # A second project where the admin's request for Eli's hours awaits approval, and an archived one.
    later = {"budget": 100000, "manager_id": user_id("MM4R8T"), "status": "planned"}
    _, pending = call(
        projects,
        "POST",
        "/",
        "AA7K2P",
        {
            **later,
            "name": "Borealis",
            "start_date": (monday + timedelta(days=14)).isoformat(),
            "predicted_end_date": (monday + timedelta(days=60)).isoformat(),
        },
    )
    assert (
        call(
            projects,
            "POST",
            f"/{pending['id']}/assignments",
            "AA7K2P",
            {"user_id": user_id("EE3H9W"), "hours_per_week": 6},
        )[0]
        == 201
    )
    _, archived = call(
        projects,
        "POST",
        "/",
        "AA7K2P",
        {
            **later,
            "name": "Cosmos",
            "start_date": monday.isoformat(),
            "predicted_end_date": (monday + timedelta(days=30)).isoformat(),
        },
    )
    call(
        projects,
        "POST",
        f"/{archived['id']}/assignments",
        "MM4R8T",
        {"user_id": user_id("EE3H9W"), "hours_per_week": 2},
    )
    call(projects, "POST", f"/{archived['id']}/archive", "AA7K2P")

    _, body = call(projects, "GET", "/dashboard", "EE3H9W")
    apollo, borealis = body["schedule"]  # archived projects are left out; earliest start first
    assert (apollo["name"], apollo["hours_per_week"], apollo["pending_hours"]) == ("Apollo", 10.0, None)
    assert apollo["start_date"] == monday.isoformat()
    assert [m["title"] for m in apollo["milestones"]] == ["Kick-off", "Launch"]  # by due date
    assert set(apollo["milestones"][0]) == {"id", "title", "due_date", "status"}
    assert (borealis["name"], borealis["hours_per_week"], borealis["pending_hours"]) == ("Borealis", None, 6.0)
    assert borealis["milestones"] == []


def test_schedule_is_empty_without_projects(fresh_db: None) -> None:
    _, body = call(projects, "GET", "/dashboard", "EE3H9W")
    assert body["schedule"] == []
    _, manager = call(projects, "GET", "/dashboard", "MM4R8T")
    assert "schedule" not in manager
