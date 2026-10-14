"""Integration tests for staffing: the 40-hour rule, budget enforcement and visibility."""

import threading

import pytest

from conftest import bearer, load_service, make_event, response_json
from pm_core import db

pytestmark = pytest.mark.db

service = load_service("projects")
users_service = load_service("users")

# Two working weeks (Mon 2 Nov - Fri 13 Nov 2026).
TWO_WEEKS = {"start_date": "2026-11-02", "predicted_end_date": "2026-11-13"}


def call(method: str, path: str, as_: str, body: object = None, svc=service) -> tuple[int, dict]:
    prefix = "/api/projects" if svc is service else "/api/users"
    response = svc.handler(make_event(method, f"{prefix}{path}", body=body, headers=bearer(as_)))
    return response["statusCode"], response_json(response)


def user_id(employee_id: str) -> int:
    with db.transaction() as cur:
        cur.execute("SELECT id FROM users WHERE employee_id = %s", (employee_id,))
        return cur.fetchone()["id"]


@pytest.fixture
def emp(fresh_db: None) -> int:
    """EE3H9W earning $104,000 = $50/hour, so 10 h/week for 2 weeks costs exactly $1,000."""
    with db.transaction() as cur:
        cur.execute("UPDATE users SET salary = 104000 WHERE employee_id = 'EE3H9W'")
    return user_id("EE3H9W")


def add_employee(employee_id: str, salary: int = 104000) -> int:
    with db.transaction() as cur:
        cur.execute(
            "INSERT INTO users (employee_id, first_name, last_name, email, role, salary, manager_id, password_hash) "
            "VALUES (%s, 'Second', 'Person', %s, 'employee', %s, %s, 'x') RETURNING id",
            (employee_id, f"{employee_id.lower()}@example.com", salary, user_id("MM4R8T")),
        )
        return cur.fetchone()["id"]


def create_project(name: str = "Apollo", budget: float = 10000, **dates: str) -> dict:
    body = {"name": name, "budget": budget, "manager_id": user_id("MM4R8T"), **TWO_WEEKS, **dates}
    status, project = call("POST", "/", "AA7K2P", body)
    assert status == 201, project
    return project


def assign(project_id: int, uid: int, hours: float, as_: str = "MM4R8T") -> tuple[int, dict]:
    return call("POST", f"/{project_id}/assignments", as_, {"user_id": uid, "hours_per_week": hours})


def last_audit() -> dict:
    with db.transaction() as cur:
        cur.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1")
        return cur.fetchone()


# ------------------------------------------------------------------ assigning


def test_manager_assigns_employee_and_cost_is_tracked(emp: int) -> None:
    project = create_project()
    status, body = assign(project["id"], emp, 10)
    assert status == 201
    assert (body["hours_per_week"], body["total_hours"], body["cost"]) == (10.0, 20.0, 1000.0)

    _, project = call("GET", f"/{project['id']}", "AA7K2P")
    assert (project["team_size"], project["allocated_hours"], project["projected_cost"]) == (1, 10.0, 1000.0)
    assert (project["remaining_budget"], project["over_budget"]) == (9000.0, False)

    entry = last_audit()
    assert (entry["action"], entry["actor_employee_id"], entry["project_id"]) == (
        "assignment.create",
        "MM4R8T",
        project["id"],
    )
    assert entry["summary"] == "Assigned Eli Employee to Apollo for 10 h/week"


def test_only_active_employees_can_be_assigned(emp: int) -> None:
    project = create_project()
    status, body = assign(project["id"], user_id("MM4R8T"), 10)
    assert (status, body["error"]["details"]["user_id"]) == (400, "Must be an active employee")


def test_duplicate_assignment_is_rejected(emp: int) -> None:
    project = create_project()
    assign(project["id"], emp, 10)
    status, body = assign(project["id"], emp, 5)
    assert status == 409
    assert "already on this project" in body["error"]["message"]


@pytest.mark.parametrize("hours", [0, 0.4, 40.5, "ten"])
def test_hours_are_validated(emp: int, hours: object) -> None:
    project = create_project()
    assert assign(project["id"], emp, hours)[0] == 400


def test_other_managers_and_employees_cannot_staff(emp: int) -> None:
    project = create_project()
    assert assign(project["id"], emp, 10, as_="EE3H9W")[0] == 403
    with db.transaction() as cur:
        cur.execute(
            "INSERT INTO users (employee_id, first_name, last_name, email, role, password_hash) "
            "VALUES ('OM2K4R', 'Other', 'Manager', 'mgr2@example.com', 'manager', 'x')"
        )
    assert assign(project["id"], emp, 10, as_="OM2K4R")[0] == 403
    entry = last_audit()
    assert (entry["outcome"], entry["actor_employee_id"]) == ("denied", "OM2K4R")


def test_archived_projects_cannot_be_staffed(emp: int) -> None:
    project = create_project()
    call("POST", f"/{project['id']}/archive", "AA7K2P")
    assert assign(project["id"], emp, 10, as_="AA7K2P")[0] == 409


# ------------------------------------------------------------------ 40-hour rule


def test_cannot_exceed_40_hours_on_overlapping_projects(emp: int) -> None:
    first = create_project("First")
    second = create_project("Second")
    assert assign(first["id"], emp, 30)[0] == 201
    status, body = assign(second["id"], emp, 15)
    assert status == 409
    assert "45 hours per week" in body["error"]["message"]
    assert body["error"]["details"]["hours_per_week"] == "At most 10 hours available"
    assert assign(second["id"], emp, 10)[0] == 201  # exactly 40 is allowed


def test_non_overlapping_projects_do_not_count_together(emp: int) -> None:
    jan = create_project("Jan", start_date="2026-01-05", predicted_end_date="2026-01-30")
    mar = create_project("Mar", start_date="2026-03-02", predicted_end_date="2026-03-27")
    long = create_project("Q1", budget=100000, start_date="2026-01-05", predicted_end_date="2026-03-27")
    assign(jan["id"], emp, 30)
    assign(mar["id"], emp, 30)
    assert assign(long["id"], emp, 10)[0] == 201
    status, body = call(
        "PATCH", f"/{long['id']}/assignments/{_assignment_id(long['id'], emp)}", "MM4R8T", {"hours_per_week": 11}
    )
    assert status == 409


def _assignment_id(project_id: int, uid: int) -> int:
    with db.transaction() as cur:
        cur.execute("SELECT id FROM project_assignments WHERE project_id = %s AND user_id = %s", (project_id, uid))
        return cur.fetchone()["id"]


def test_completed_and_archived_projects_free_up_hours(emp: int) -> None:
    done = create_project("Done")
    archived = create_project("Archived")
    assign(done["id"], emp, 40)
    status, _ = call("PATCH", f"/{done['id']}", "MM4R8T", {"status": "completed"})
    assert status == 200
    assign(archived["id"], emp, 40)
    call("POST", f"/{archived['id']}/archive", "AA7K2P")

    current = create_project("Current")
    assert assign(current["id"], emp, 40)[0] == 201


def test_reactivating_a_project_rechecks_the_40_hour_rule(emp: int) -> None:
    old = create_project("Old")
    assign(old["id"], emp, 30)
    call("POST", f"/{old['id']}/archive", "AA7K2P")
    new = create_project("New")
    assign(new["id"], emp, 30)
    status, body = call("POST", f"/{old['id']}/reactivate", "AA7K2P", {})
    assert status == 409
    assert "60 hours per week" in body["error"]["message"]


def test_reopening_a_completed_project_rechecks_the_40_hour_rule(emp: int) -> None:
    old = create_project("Old")
    assign(old["id"], emp, 30)
    call("PATCH", f"/{old['id']}", "MM4R8T", {"status": "completed"})
    new = create_project("New")
    assign(new["id"], emp, 30)
    assert call("PATCH", f"/{old['id']}", "MM4R8T", {"status": "active"})[0] == 409


def test_extending_dates_rechecks_the_40_hour_rule(emp: int) -> None:
    first = create_project("First")
    later = create_project("Later", start_date="2026-11-16", predicted_end_date="2026-11-27")
    assign(first["id"], emp, 30)
    assign(later["id"], emp, 30)
    status, body = call("PATCH", f"/{first['id']}", "MM4R8T", {"predicted_end_date": "2026-11-20"})
    assert status == 409
    assert "60 hours per week" in body["error"]["message"]


# ------------------------------------------------------------------ budget rule


def test_exact_budget_fit_is_allowed_and_one_cent_over_is_not(emp: int) -> None:
    exact = create_project("Exact", budget=1000)
    assert assign(exact["id"], emp, 10)[0] == 201

    tight = create_project("Tight", budget=999.99)
    second = add_employee("SP5G8H")
    status, body = assign(tight["id"], second, 10)
    assert status == 409
    assert body["error"]["details"]["over_by"] == 0.01


def test_increasing_hours_over_budget_is_rejected(emp: int) -> None:
    project = create_project(budget=1000)
    assign(project["id"], emp, 10)
    assignment = _assignment_id(project["id"], emp)
    status, body = call("PATCH", f"/{project['id']}/assignments/{assignment}", "MM4R8T", {"hours_per_week": 12})
    assert status == 409
    assert "$200.00 over budget" in body["error"]["message"]


def test_lowering_budget_below_cost_is_rejected(emp: int) -> None:
    project = create_project(budget=1000)
    assign(project["id"], emp, 10)
    status, _ = call("PATCH", f"/{project['id']}", "MM4R8T", {"budget": 999})
    assert status == 409
    assert call("PATCH", f"/{project['id']}", "MM4R8T", {"budget": 1000})[0] == 200


def test_extending_dates_over_budget_is_rejected(emp: int) -> None:
    project = create_project(budget=1000)
    assign(project["id"], emp, 10)
    status, body = call("PATCH", f"/{project['id']}", "MM4R8T", {"predicted_end_date": "2026-11-20"})
    assert status == 409
    assert "$500.00 over budget" in body["error"]["message"]


def test_over_budget_project_can_still_be_reduced(emp: int) -> None:
    project = create_project(budget=1000)
    assign(project["id"], emp, 10)
    with db.transaction() as cur:  # pay rise pushes the project over budget
        cur.execute("UPDATE users SET salary = 208000 WHERE id = %s", (emp,))
    _, current = call("GET", f"/{project['id']}", "MM4R8T")
    assert (current["projected_cost"], current["over_budget"]) == (2000.0, True)

    assignment = _assignment_id(project["id"], emp)
    assert call("PATCH", f"/{project['id']}/assignments/{assignment}", "MM4R8T", {"hours_per_week": 8})[0] == 200
    assert call("PATCH", f"/{project['id']}/assignments/{assignment}", "MM4R8T", {"hours_per_week": 9})[0] == 409
    assert call("PATCH", f"/{project['id']}", "MM4R8T", {"budget": 1500})[0] == 200  # raising budget is fine


# ------------------------------------------------------------------ update / remove / views


def test_remove_assignment_frees_budget_and_is_audited(emp: int) -> None:
    project = create_project(budget=1000)
    assign(project["id"], emp, 10)
    assignment = _assignment_id(project["id"], emp)
    status, body = call("DELETE", f"/{project['id']}/assignments/{assignment}", "MM4R8T")
    assert (status, body) == (204, None)
    assert last_audit()["action"] == "assignment.delete"
    _, current = call("GET", f"/{project['id']}", "MM4R8T")
    assert (current["team_size"], current["projected_cost"]) == (0, 0.0)
    assert call("DELETE", f"/{project['id']}/assignments/{assignment}", "MM4R8T")[0] == 404


def test_employee_sees_team_without_costs_and_their_own_hours(emp: int) -> None:
    project = create_project()
    assign(project["id"], emp, 10)
    status, team = call("GET", f"/{project['id']}/assignments", "EE3H9W")
    assert status == 200
    assert team["items"][0]["employee_id"] == "EE3H9W"
    assert "cost" not in team["items"][0]

    _, listed = call("GET", "/", "EE3H9W")
    assert listed["items"][0]["my_hours_per_week"] == 10.0
    assert "projected_cost" not in listed["items"][0]


def test_staffing_options_show_availability_and_cost(emp: int) -> None:
    other = create_project("Other")
    assign(other["id"], emp, 25)
    project = create_project()
    status, body = call("GET", f"/{project['id']}/staffing-options", "MM4R8T")
    assert status == 200
    [option] = body["items"]
    assert (option["committed_hours_elsewhere"], option["available_hours"]) == (25.0, 15.0)
    assert option["cost_per_weekly_hour"] == 100.0  # $50/h x 2 weeks
    assert option["assignment_id"] is None
    assert call("GET", f"/{project['id']}/staffing-options", "EE3H9W")[0] == 403


def test_concurrent_assignments_cannot_both_break_the_40_hour_rule(emp: int) -> None:
    first = create_project("First")
    second = create_project("Second")
    results: list[int] = []

    def worker(project_id: int) -> None:
        # Each thread gets its own database connection, like two Lambda containers.
        results.append(assign(project_id, emp, 25)[0])

    threads = [threading.Thread(target=worker, args=(p["id"],)) for p in (first, second)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(results) == [201, 409]


# ------------------------------------------------------------------ users integration


def test_assigned_employee_cannot_be_deactivated_or_promoted(emp: int) -> None:
    project = create_project()
    assign(project["id"], emp, 10)
    status, body = call("POST", f"/{emp}/deactivate", "AA7K2P", svc=users_service)
    assert status == 409
    assert "assigned to 1 current project" in body["error"]["message"]
    assert call("PATCH", f"/{emp}", "AA7K2P", {"role": "manager"}, svc=users_service)[0] == 409

    assignment = _assignment_id(project["id"], emp)
    call("DELETE", f"/{project['id']}/assignments/{assignment}", "MM4R8T")
    assert call("POST", f"/{emp}/deactivate", "AA7K2P", svc=users_service)[0] == 200
