"""Integration tests for cross-team hours approval."""

import pytest

from conftest import bearer, load_service, make_event, response_json
from pm_core import db

pytestmark = pytest.mark.db

service = load_service("projects")

TWO_WEEKS = {"start_date": "2026-11-02", "predicted_end_date": "2026-11-13"}


def call(method: str, path: str, as_: str, body: object = None) -> tuple[int, dict]:
    response = service.handler(make_event(method, f"/api/projects{path}", body=body, headers=bearer(as_)))
    return response["statusCode"], response_json(response)


def user_id(employee_id: str) -> int:
    with db.transaction() as cur:
        cur.execute("SELECT id FROM users WHERE employee_id = %s", (employee_id,))
        return cur.fetchone()["id"]


@pytest.fixture
def setup(fresh_db: None) -> dict:
    """MGR002 runs a project; EMP001 reports to MGR001 and earns $50/hour."""
    with db.transaction() as cur:
        cur.execute("UPDATE users SET salary = 104000 WHERE employee_id = 'EMP001'")
        cur.execute(
            "INSERT INTO users (employee_id, first_name, last_name, email, role, password_hash) "
            "VALUES ('MGR002', 'Pat', 'Projectlead', 'pat@example.com', 'manager', 'x') RETURNING id"
        )
        mgr2 = cur.fetchone()["id"]
    return {"emp": user_id("EMP001"), "mgr2": mgr2, "project": create_project(mgr2)}


def create_project(manager_id: int, name: str = "Cross-team", budget: float = 10000) -> int:
    status, body = call("POST", "/", "ADM001", {"name": name, "budget": budget, "manager_id": manager_id, **TWO_WEEKS})
    assert status == 201, body
    return body["id"]


def request_hours(project: int, emp: int, hours: float, as_: str = "MGR002") -> tuple[int, dict]:
    return call("POST", f"/{project}/assignments", as_, {"user_id": emp, "hours_per_week": hours})


def entries(action: str) -> list[dict]:
    with db.transaction() as cur:
        cur.execute("SELECT * FROM audit_log WHERE action = %s ORDER BY id", (action,))
        return cur.fetchall()


# ------------------------------------------------------------------ requesting


def test_staffing_someone_elses_report_creates_a_pending_request(setup: dict) -> None:
    status, body = request_hours(setup["project"], setup["emp"], 10)
    assert status == 201
    assert (body["status"], body["hours_per_week"], body["pending_hours"]) == ("pending", None, 10.0)
    assert (body["awaiting_approval"], body["approver_name"]) == (True, "Morgan Manager")
    assert body["requested_by_name"] == "Pat Projectlead"
    [entry] = entries("assignment.request")
    assert entry["actor_employee_id"] == "MGR002"
    assert "awaiting approval from Morgan Manager" in entry["summary"]


def test_own_manager_staffing_is_immediate(setup: dict) -> None:
    own_project = create_project(user_id("MGR001"), "Own team")
    status, body = request_hours(own_project, setup["emp"], 10, as_="MGR001")
    assert (status, body["status"], body["hours_per_week"], body["awaiting_approval"]) == (201, "approved", 10.0, False)


def test_admin_staffing_also_needs_the_employees_manager(setup: dict) -> None:
    status, body = request_hours(setup["project"], setup["emp"], 10, as_="ADM001")
    assert (status, body["status"]) == (201, "pending")


def test_options_flag_who_needs_approval(setup: dict) -> None:
    _, body = call("GET", f"/{setup['project']}/staffing-options", "MGR002")
    [option] = body["items"]
    assert (option["needs_approval"], option["manager_name"]) == (True, "Morgan Manager")


# ------------------------------------------------------------------ reserved hours


def test_pending_hours_are_reserved_against_40_hours_and_budget(setup: dict) -> None:
    request_hours(setup["project"], setup["emp"], 30)
    _, project = call("GET", f"/{setup['project']}", "MGR002")
    assert project["projected_cost"] == 3000.0  # 30h x 2 weeks x $50

    other = create_project(user_id("MGR001"), "Other")
    status, body = request_hours(other, setup["emp"], 15, as_="MGR001")
    assert status == 409
    assert "45 hours per week" in body["error"]["message"]


def test_pending_increase_is_reserved(setup: dict) -> None:
    own = create_project(user_id("MGR001"), "Own team")
    request_hours(setup["project"], setup["emp"], 10, as_="MGR001")  # MGR001 can't staff MGR002's project...
    status, _ = request_hours(own, setup["emp"], 10, as_="MGR001")
    assert status == 201
    assignment = _assignment(own, setup["emp"])
    # MGR001 is the employee's manager: an increase on their own project is immediate.
    assert (
        call("PATCH", f"/{own}/assignments/{assignment}", "MGR001", {"hours_per_week": 20})[1]["status"] == "approved"
    )


def _assignment(project: int, emp: int) -> int:
    with db.transaction() as cur:
        cur.execute("SELECT id FROM project_assignments WHERE project_id = %s AND user_id = %s", (project, emp))
        return cur.fetchone()["id"]


# ------------------------------------------------------------------ inbox


def test_inbox_lists_requests_for_my_reports_only(setup: dict) -> None:
    request_hours(setup["project"], setup["emp"], 10)
    status, body = call("GET", "/approvals", "MGR001")
    assert status == 200
    [item] = body["items"]
    assert (item["kind"], item["requested_hours"], item["current_hours"]) == ("new", 10.0, None)
    assert (item["project_name"], item["requested_by_name"]) == ("Cross-team", "Pat Projectlead")

    assert call("GET", "/approvals", "MGR002")[1]["items"] == []
    assert call("GET", "/approvals", "ADM001")[0] == 403
    assert call("GET", "/approvals", "EMP001")[0] == 403


# ------------------------------------------------------------------ deciding


@pytest.mark.parametrize("as_", ["MGR002", "ADM001", "EMP001"])
def test_only_the_employees_manager_can_decide(setup: dict, as_: str) -> None:
    request_hours(setup["project"], setup["emp"], 10)
    assignment = _assignment(setup["project"], setup["emp"])
    assert call("POST", f"/{setup['project']}/assignments/{assignment}/approve", as_)[0] == 403
    assert call("POST", f"/{setup['project']}/assignments/{assignment}/reject", as_, {})[0] == 403
    denied = [e for e in entries("access.denied") if e["actor_employee_id"] == as_]
    assert len(denied) == 2


def test_approving_a_new_assignment(setup: dict) -> None:
    request_hours(setup["project"], setup["emp"], 10)
    assignment = _assignment(setup["project"], setup["emp"])
    status, body = call("POST", f"/{setup['project']}/assignments/{assignment}/approve", "MGR001")
    assert status == 200
    assert (body["status"], body["hours_per_week"], body["pending_hours"]) == ("approved", 10.0, None)
    [entry] = entries("assignment.approve")
    assert entry["actor_employee_id"] == "MGR001"
    assert entry["summary"] == "Approved 10 h/week for Eli Employee on Cross-team"
    assert call("GET", "/approvals", "MGR001")[1]["items"] == []
    assert call("POST", f"/{setup['project']}/assignments/{assignment}/approve", "MGR001")[0] == 409


def test_increase_needs_approval_and_keeps_current_hours_until_then(setup: dict) -> None:
    request_hours(setup["project"], setup["emp"], 10)
    assignment = _assignment(setup["project"], setup["emp"])
    call("POST", f"/{setup['project']}/assignments/{assignment}/approve", "MGR001")

    status, body = call("PATCH", f"/{setup['project']}/assignments/{assignment}", "MGR002", {"hours_per_week": 15})
    assert (status, body["hours_per_week"], body["pending_hours"], body["reserved_hours"]) == (200, 10.0, 15.0, 15.0)
    assert call("GET", "/approvals", "MGR001")[1]["items"][0]["kind"] == "increase"

    _, body = call("POST", f"/{setup['project']}/assignments/{assignment}/approve", "MGR001")
    assert (body["hours_per_week"], body["pending_hours"]) == (15.0, None)


def test_rejecting_an_increase_keeps_approved_hours(setup: dict) -> None:
    request_hours(setup["project"], setup["emp"], 10)
    assignment = _assignment(setup["project"], setup["emp"])
    call("POST", f"/{setup['project']}/assignments/{assignment}/approve", "MGR001")
    call("PATCH", f"/{setup['project']}/assignments/{assignment}", "MGR002", {"hours_per_week": 15})

    status, body = call(
        "POST", f"/{setup['project']}/assignments/{assignment}/reject", "MGR001", {"note": "Needed on our release"}
    )
    assert (status, body["removed"], body["assignment"]["hours_per_week"]) == (200, False, 10.0)
    assert body["assignment"]["pending_hours"] is None
    [entry] = entries("assignment.reject")
    assert entry["summary"].endswith("(stays at 10) - Needed on our release")


def test_rejecting_a_new_assignment_withdraws_it_and_frees_hours(setup: dict) -> None:
    request_hours(setup["project"], setup["emp"], 30)
    assignment = _assignment(setup["project"], setup["emp"])
    status, body = call("POST", f"/{setup['project']}/assignments/{assignment}/reject", "MGR001", {})
    assert (status, body) == (200, {"assignment": None, "removed": True})
    _, project = call("GET", f"/{setup['project']}", "MGR002")
    assert (project["team_size"], project["projected_cost"]) == (0, 0.0)


def test_reduction_is_immediate_and_cancels_pending_increase(setup: dict) -> None:
    request_hours(setup["project"], setup["emp"], 10)
    assignment = _assignment(setup["project"], setup["emp"])
    call("POST", f"/{setup['project']}/assignments/{assignment}/approve", "MGR001")
    call("PATCH", f"/{setup['project']}/assignments/{assignment}", "MGR002", {"hours_per_week": 15})

    status, body = call("PATCH", f"/{setup['project']}/assignments/{assignment}", "MGR002", {"hours_per_week": 8})
    assert (status, body["status"], body["hours_per_week"], body["pending_hours"]) == (200, "approved", 8.0, None)
    assert call("GET", "/approvals", "MGR001")[1]["items"] == []


def test_unchanged_hours_are_not_audited(setup: dict) -> None:
    request_hours(setup["project"], setup["emp"], 10)
    assignment = _assignment(setup["project"], setup["emp"])
    call("POST", f"/{setup['project']}/assignments/{assignment}/approve", "MGR001")
    call("PATCH", f"/{setup['project']}/assignments/{assignment}", "MGR002", {"hours_per_week": 10})
    assert entries("assignment.update") == []


def test_removing_a_pending_assignment_cancels_the_request(setup: dict) -> None:
    request_hours(setup["project"], setup["emp"], 10)
    assignment = _assignment(setup["project"], setup["emp"])
    assert call("DELETE", f"/{setup['project']}/assignments/{assignment}", "MGR002")[0] == 204
    assert "pending request cancelled" in entries("assignment.delete")[0]["summary"]
    assert call("GET", "/approvals", "MGR001")[1]["items"] == []


def test_archived_project_requests_cannot_be_approved(setup: dict) -> None:
    request_hours(setup["project"], setup["emp"], 10)
    assignment = _assignment(setup["project"], setup["emp"])
    call("POST", f"/{setup['project']}/archive", "ADM001")
    assert call("GET", "/approvals", "MGR001")[1]["items"] == []
    assert call("POST", f"/{setup['project']}/assignments/{assignment}/approve", "MGR001")[0] == 409


def test_employee_sees_pending_hours_separately(setup: dict) -> None:
    request_hours(setup["project"], setup["emp"], 10)
    _, listed = call("GET", "/", "EMP001")
    [project] = listed["items"]
    assert (project["my_hours_per_week"], project["my_pending_hours"]) == (None, 10.0)
