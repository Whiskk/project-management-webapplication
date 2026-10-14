"""Integration tests for project requests: submit, withdraw, approve (creating the project), reject."""

import pytest

from conftest import bearer, load_service, make_event, response_json
from pm_core import db

pytestmark = pytest.mark.db

service = load_service("projects")

REQUEST = {
    "name": "Gemini",
    "description": "Payments platform",
    "start_date": "2026-12-07",
    "predicted_end_date": "2027-01-29",
    "budget": 80000,
    "justification": "Needed for the Q1 launch",
}


def call(method: str, path: str, as_: str, body: object = None, query: dict | None = None) -> tuple[int, dict]:
    event = make_event(method, f"/api/projects{path}", body=body, headers=bearer(as_), query=query)
    response = service.handler(event)
    return response["statusCode"], response_json(response)


def user_id(employee_id: str) -> int:
    with db.transaction() as cur:
        cur.execute("SELECT id FROM users WHERE employee_id = %s", (employee_id,))
        return cur.fetchone()["id"]


def submit(as_: str = "MM4R8T", **overrides: object) -> dict:
    status, body = call("POST", "/requests", as_, {**REQUEST, **overrides})
    assert status == 201, body
    return body


def add_manager(employee_id: str = "PO6T2N") -> int:
    with db.transaction() as cur:
        cur.execute(
            "INSERT INTO users (employee_id, first_name, last_name, email, role, password_hash) "
            "VALUES (%s, 'Pat', 'Other', %s, 'manager', 'x') RETURNING id",
            (employee_id, f"{employee_id.lower()}@example.com"),
        )
        return cur.fetchone()["id"]


def audit_actions() -> list[str]:
    with db.transaction() as cur:
        cur.execute("SELECT action FROM audit_log ORDER BY id")
        return [r["action"] for r in cur.fetchall()]


# ------------------------------------------------------------------ submitting


def test_manager_submits_a_request(fresh_db: None) -> None:
    body = submit()
    assert (body["status"], body["requested_by_name"], body["budget"]) == ("pending", "Morgan Manager", 80000.0)
    assert body["project_id"] is None
    assert audit_actions()[-1] == "request.submit"


@pytest.mark.parametrize("as_", ["AA7K2P", "EE3H9W"])
def test_only_managers_submit(fresh_db: None, as_: str) -> None:
    assert call("POST", "/requests", as_, REQUEST)[0] == 403


def test_request_is_validated(fresh_db: None) -> None:
    status, body = call("POST", "/requests", "MM4R8T", {**REQUEST, "predicted_end_date": "2026-12-01"})
    assert (status, body["error"]["details"]) == (400, {"predicted_end_date": "Must be on or after the start date"})
    status, body = call("POST", "/requests", "MM4R8T", {"name": "x"})
    assert {"start_date", "predicted_end_date", "budget", "justification"} <= set(body["error"]["details"])


# ------------------------------------------------------------------ listing


def test_managers_see_their_own_and_admins_see_all(fresh_db: None) -> None:
    add_manager()
    submit()
    submit(as_="PO6T2N", name="Other team's idea")
    _, mine = call("GET", "/requests", "MM4R8T")
    assert [r["name"] for r in mine["items"]] == ["Gemini"]
    _, everything = call("GET", "/requests", "AA7K2P")
    assert (everything["total"], everything["pending"]) == (2, 2)
    assert call("GET", "/requests", "EE3H9W")[0] == 403


def test_list_filters_by_status_and_puts_pending_first(fresh_db: None) -> None:
    first = submit(name="First")
    submit(name="Second")
    call("POST", f"/requests/{first['id']}/reject", "AA7K2P", {"note": "Not this year"})
    _, body = call("GET", "/requests", "AA7K2P")
    assert [r["status"] for r in body["items"]] == ["pending", "rejected"]
    _, body = call("GET", "/requests", "AA7K2P", query={"status": "rejected"})
    assert [r["name"] for r in body["items"]] == ["First"]
    assert call("GET", "/requests", "AA7K2P", query={"status": "nope"})[0] == 400


# ------------------------------------------------------------------ approving


def test_approval_creates_the_project_managed_by_the_requester(fresh_db: None) -> None:
    request = submit()
    status, body = call("POST", f"/requests/{request['id']}/approve", "AA7K2P", {"note": "Go ahead"})
    assert status == 200
    assert (body["status"], body["reviewed_by_name"], body["review_note"]) == ("approved", "Alex Admin", "Go ahead")
    assert body["project_name"] == "Gemini"

    _, project = call("GET", f"/{body['project_id']}", "MM4R8T")
    assert (project["manager_employee_id"], project["budget"], project["status"]) == ("MM4R8T", 80000.0, "planned")
    assert audit_actions()[-2:] == ["project.create", "request.approve"]
    with db.transaction() as cur:
        cur.execute("SELECT summary FROM audit_log WHERE action = 'project.create'")
        assert cur.fetchone()["summary"].endswith(f"from request #{request['id']} by Morgan Manager")


def test_admin_can_adjust_details_when_approving(fresh_db: None) -> None:
    other = add_manager()
    request = submit()
    status, body = call("POST", f"/requests/{request['id']}/approve", "AA7K2P", {"budget": 60000, "manager_id": other})
    assert status == 200
    _, project = call("GET", f"/{body['project_id']}", "AA7K2P")
    assert (project["budget"], project["manager_employee_id"]) == (60000.0, "PO6T2N")
    with db.transaction() as cur:
        cur.execute("SELECT summary FROM audit_log WHERE action = 'request.approve'")
        assert cur.fetchone()["summary"].endswith("with changes to budget, manager_id")


def test_approval_with_invalid_adjustment_creates_nothing(fresh_db: None) -> None:
    request = submit()
    status, _ = call("POST", f"/requests/{request['id']}/approve", "AA7K2P", {"predicted_end_date": "2026-01-01"})
    assert status == 400
    with db.transaction() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM projects")
        assert cur.fetchone()["n"] == 0
        cur.execute("SELECT status FROM project_requests")
        assert cur.fetchone()["status"] == "pending"


def test_requester_no_longer_a_manager_needs_a_new_manager(fresh_db: None) -> None:
    other = add_manager()
    request = submit(as_="PO6T2N")
    with db.transaction() as cur:
        cur.execute("UPDATE users SET is_active = FALSE WHERE id = %s", (other,))
    status, body = call("POST", f"/requests/{request['id']}/approve", "AA7K2P", {})
    assert status == 409
    assert "Choose who will manage this project" in body["error"]["message"]
    status, _ = call("POST", f"/requests/{request['id']}/approve", "AA7K2P", {"manager_id": user_id("MM4R8T")})
    assert status == 200


@pytest.mark.parametrize("as_", ["MM4R8T", "EE3H9W"])
def test_only_admins_approve_or_reject(fresh_db: None, as_: str) -> None:
    request = submit()
    assert call("POST", f"/requests/{request['id']}/approve", as_, {})[0] == 403
    assert call("POST", f"/requests/{request['id']}/reject", as_, {"note": "x"})[0] == 403


# ------------------------------------------------------------------ rejecting / withdrawing


def test_rejection_requires_a_reason(fresh_db: None) -> None:
    request = submit()
    status, body = call("POST", f"/requests/{request['id']}/reject", "AA7K2P", {})
    assert (status, body["error"]["details"]["note"]) == (400, "This field is required")
    status, body = call("POST", f"/requests/{request['id']}/reject", "AA7K2P", {"note": "Budget frozen"})
    assert (status, body["status"], body["review_note"]) == (200, "rejected", "Budget frozen")
    assert audit_actions()[-1] == "request.reject"


def test_manager_withdraws_own_pending_request(fresh_db: None) -> None:
    add_manager()
    request = submit()
    assert call("POST", f"/requests/{request['id']}/withdraw", "PO6T2N")[0] == 403
    status, body = call("POST", f"/requests/{request['id']}/withdraw", "MM4R8T")
    assert (status, body["status"]) == (200, "withdrawn")
    assert audit_actions()[-1] == "request.withdraw"


@pytest.mark.parametrize("action", ["approve", "reject", "withdraw"])
def test_decided_requests_cannot_change_again(fresh_db: None, action: str) -> None:
    request = submit()
    call("POST", f"/requests/{request['id']}/reject", "AA7K2P", {"note": "No"})
    as_ = "MM4R8T" if action == "withdraw" else "AA7K2P"
    status, body = call("POST", f"/requests/{request['id']}/{action}", as_, {"note": "x"} if action == "reject" else {})
    assert status == 409
    assert body["error"]["message"] == "This request has already been rejected"


def test_missing_request_is_404(fresh_db: None) -> None:
    assert call("POST", "/requests/999/approve", "AA7K2P", {})[0] == 404


def test_requests_are_never_deleted(fresh_db: None) -> None:
    request = submit()
    call("POST", f"/requests/{request['id']}/withdraw", "MM4R8T")
    assert call("DELETE", f"/requests/{request['id']}", "AA7K2P")[0] in (404, 405)
    with db.transaction() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM project_requests")
        assert cur.fetchone()["n"] == 1
