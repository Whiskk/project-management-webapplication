"""Integration tests for the users service."""

import pytest

from conftest import bearer, load_service, make_event, response_json
from pm_core import db, passwords

pytestmark = pytest.mark.db

service = load_service("users")

NEW_EMPLOYEE = {
    "first_name": "Nia",
    "last_name": "Newhire",
    "email": "nia@example.com",
    "job_title": "Analyst",
    "salary": 80000,
    "role": "employee",
}


def call(method: str, path: str, as_: str, body: object = None, query: dict | None = None) -> tuple[int, dict]:
    """Invoke the users service as a demo user."""
    event = make_event(method, f"/api/users{path}", body=body, headers=bearer(as_), query=query)
    response = service.handler(event)
    return response["statusCode"], response_json(response)


def user_id(employee_id: str) -> int:
    with db.transaction() as cur:
        cur.execute("SELECT id FROM users WHERE employee_id = %s", (employee_id,))
        return cur.fetchone()["id"]


def last_audit() -> dict:
    with db.transaction() as cur:
        cur.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1")
        return cur.fetchone()


def new_employee(**overrides: object) -> dict:
    return {**NEW_EMPLOYEE, "manager_id": user_id("MGR001"), **overrides}


# ------------------------------------------------------------------ create


def test_admin_creates_user_with_generated_id_and_password(fresh_db: None) -> None:
    status, body = call("POST", "/", "ADM001", new_employee())
    assert status == 201
    user = body["user"]
    assert user["employee_id"] == "EMP002"
    assert user["manager_name"] == "Morgan Manager"
    assert len(body["temporary_password"]) == 6

    with db.transaction() as cur:
        cur.execute("SELECT password_hash FROM users WHERE id = %s", (user["id"],))
        assert passwords.verify_password(body["temporary_password"], cur.fetchone()["password_hash"])


def test_create_is_audited_without_salary_value(fresh_db: None) -> None:
    call("POST", "/", "ADM001", new_employee())
    entry = last_audit()
    assert entry["action"] == "user.create"
    assert entry["actor_employee_id"] == "ADM001"
    assert entry["changes"]["salary"] == {"from": None, "to": "[redacted]"}
    assert "80000" not in str(entry["changes"])


def test_employee_ids_are_sequential_per_role(fresh_db: None) -> None:
    call("POST", "/", "ADM001", new_employee())
    call("POST", "/", "ADM001", new_employee(email="two@example.com"))
    status, body = call("POST", "/", "ADM001", {**NEW_EMPLOYEE, "email": "m@example.com", "role": "manager"})
    assert status == 201
    assert body["user"]["employee_id"] == "MGR002"
    _, listed = call("GET", "/", "ADM001", query={"role": "employee"})
    assert sorted(u["employee_id"] for u in listed["items"]) == ["EMP001", "EMP002", "EMP003"]


@pytest.mark.parametrize("as_", ["MGR001", "EMP001"])
def test_only_admins_create_users(fresh_db: None, as_: str) -> None:
    assert call("POST", "/", as_, new_employee())[0] == 403


def test_employee_requires_an_active_manager(fresh_db: None) -> None:
    status, body = call("POST", "/", "ADM001", {**NEW_EMPLOYEE})
    assert status == 400
    assert body["error"]["details"]["manager_id"] == "Employees must have a manager"

    status, body = call("POST", "/", "ADM001", new_employee(manager_id=user_id("EMP001")))
    assert body["error"]["details"]["manager_id"] == "Must be an active manager"


def test_non_employees_cannot_have_a_manager(fresh_db: None) -> None:
    status, body = call("POST", "/", "ADM001", new_employee(role="manager"))
    assert status == 400
    assert body["error"]["details"]["manager_id"] == "Only employees report to a manager"


def test_duplicate_email_is_rejected_case_insensitively(fresh_db: None) -> None:
    status, body = call("POST", "/", "ADM001", new_employee(email="ELI.EMPLOYEE@example.com"))
    assert status == 400
    assert body["error"]["details"]["email"] == "This email is already in use"


def test_create_validates_fields(fresh_db: None) -> None:
    status, body = call("POST", "/", "ADM001", {"role": "boss", "salary": -1, "email": "x"})
    assert status == 400
    assert {"first_name", "last_name", "email", "salary", "role"} <= set(body["error"]["details"])


# ------------------------------------------------------------------ list / view


def test_list_supports_search_filters_and_pagination(fresh_db: None) -> None:
    status, body = call("GET", "/", "ADM001")
    assert status == 200
    assert body["total"] == 3

    _, body = call("GET", "/", "ADM001", query={"q": "morgan"})
    assert [u["employee_id"] for u in body["items"]] == ["MGR001"]

    _, body = call("GET", "/", "ADM001", query={"manager_id": str(user_id("MGR001"))})
    assert [u["employee_id"] for u in body["items"]] == ["EMP001"]

    _, body = call("GET", "/", "ADM001", query={"page": "2", "page_size": "2"})
    assert body["total"] == 3
    assert len(body["items"]) == 1


def test_list_rejects_bad_filters(fresh_db: None) -> None:
    assert call("GET", "/", "ADM001", query={"role": "boss"})[0] == 400
    assert call("GET", "/", "ADM001", query={"page_size": "1000"})[0] == 400


def test_employees_cannot_list_users(fresh_db: None) -> None:
    assert call("GET", "/", "EMP001")[0] == 403


def test_salary_visibility(fresh_db: None) -> None:
    _, as_admin = call("GET", "/", "ADM001")
    assert all(u["salary"] is not None for u in as_admin["items"])

    _, as_manager = call("GET", "/", "MGR001")
    salaries = {u["employee_id"]: u["salary"] for u in as_manager["items"]}
    assert salaries["EMP001"] == 90000.0  # direct report
    assert salaries["MGR001"] == 110000.0  # self
    assert salaries["ADM001"] is None


def test_employee_can_view_only_themselves(fresh_db: None) -> None:
    assert call("GET", f"/{user_id('EMP001')}", "EMP001")[0] == 200
    assert call("GET", f"/{user_id('MGR001')}", "EMP001")[0] == 403


def test_view_missing_user_returns_404(fresh_db: None) -> None:
    assert call("GET", "/9999", "ADM001")[0] == 404


# ------------------------------------------------------------------ self-service


def test_user_updates_own_profile(fresh_db: None) -> None:
    status, body = call("PATCH", "/me", "EMP001", {"first_name": "Elijah", "email": "elijah@example.com"})
    assert status == 200
    assert (body["first_name"], body["email"]) == ("Elijah", "elijah@example.com")
    entry = last_audit()
    assert entry["action"] == "user.update_self"
    assert entry["changes"]["first_name"] == {"from": "Eli", "to": "Elijah"}


@pytest.mark.parametrize("field", [{"salary": 1}, {"role": "admin"}, {"job_title": "CEO"}, {"manager_id": None}])
def test_self_service_cannot_change_other_fields(fresh_db: None, field: dict) -> None:
    status, body = call("PATCH", "/me", "EMP001", field)
    assert status == 400
    assert body["error"]["details"][next(iter(field))] == "Unknown field"


def test_unchanged_self_update_is_not_audited(fresh_db: None) -> None:
    call("PATCH", "/me", "EMP001", {"first_name": "Eli"})
    assert last_audit() is None


# ------------------------------------------------------------------ manager / admin updates


def test_manager_updates_direct_report_basic_info(fresh_db: None) -> None:
    status, body = call("PATCH", f"/{user_id('EMP001')}", "MGR001", {"job_title": "Senior Engineer"})
    assert status == 200
    assert body["job_title"] == "Senior Engineer"
    assert last_audit()["actor_employee_id"] == "MGR001"


def test_manager_cannot_change_salary_or_role(fresh_db: None) -> None:
    status, body = call("PATCH", f"/{user_id('EMP001')}", "MGR001", {"salary": 999999})
    assert status == 400
    assert body["error"]["details"]["salary"] == "Unknown field"


def test_manager_denied_for_non_reports_is_audited_despite_rollback(fresh_db: None) -> None:
    status, _ = call("PATCH", f"/{user_id('ADM001')}", "MGR001", {"first_name": "Hacked"})
    assert status == 403
    entry = last_audit()
    assert (entry["outcome"], entry["actor_employee_id"]) == ("denied", "MGR001")
    assert entry["summary"].startswith("Denied PATCH /users/")
    with db.transaction() as cur:
        cur.execute("SELECT first_name FROM users WHERE employee_id = 'ADM001'")
        assert cur.fetchone()["first_name"] == "Alex"


def test_manager_editing_own_record_is_denied_without_hanging(fresh_db: None) -> None:
    # Regression: the target row was locked FOR UPDATE, which blocked the audit
    # insert's foreign-key check on the same (actor's) row - a silent deadlock.
    status, _ = call("PATCH", f"/{user_id('MGR001')}", "MGR001", {"first_name": "Self"})
    assert status == 403
    entry = last_audit()
    assert (entry["outcome"], entry["actor_employee_id"]) == ("denied", "MGR001")


def test_admin_changes_salary_and_manager(fresh_db: None) -> None:
    _, created = call("POST", "/", "ADM001", {**NEW_EMPLOYEE, "email": "m2@example.com", "role": "manager"})
    new_manager = created["user"]["id"]
    status, body = call(
        "PATCH", f"/{user_id('EMP001')}", "ADM001", {"salary": 95000, "manager_id": new_manager}
    )
    assert status == 200
    assert body["manager_id"] == new_manager
    assert last_audit()["changes"]["salary"] == {"from": "[redacted]", "to": "[redacted]"}


def test_promoting_employee_clears_manager(fresh_db: None) -> None:
    status, body = call("PATCH", f"/{user_id('EMP001')}", "ADM001", {"role": "manager"})
    assert status == 200
    assert (body["role"], body["manager_id"]) == ("manager", None)


def test_demoting_manager_with_reports_is_blocked(fresh_db: None) -> None:
    status, body = call("PATCH", f"/{user_id('MGR001')}", "ADM001", {"role": "employee"})
    assert status == 409
    assert "direct report" in body["error"]["message"]


def test_admin_cannot_change_own_role(fresh_db: None) -> None:
    status, body = call("PATCH", f"/{user_id('ADM001')}", "ADM001", {"role": "manager"})
    assert status == 409


def test_cannot_remove_last_admin(fresh_db: None) -> None:
    _, created = call("POST", "/", "ADM001", {**NEW_EMPLOYEE, "email": "a2@example.com", "role": "admin"})
    second_admin = created["user"]["id"]
    # Second admin demotes the first: allowed, because an admin remains.
    with db.transaction() as cur:
        cur.execute("SELECT employee_id FROM users WHERE id = %s", (second_admin,))
        second_eid = cur.fetchone()["employee_id"]
    assert call("PATCH", f"/{user_id('ADM001')}", second_eid, {"role": "manager"})[0] == 200
    # Now only one admin is left, and they cannot deactivate themselves.
    assert call("POST", f"/{second_admin}/deactivate", second_eid)[0] == 409


# ------------------------------------------------------------------ password / activation


def test_reset_password_returns_new_working_password(fresh_db: None) -> None:
    status, body = call("POST", f"/{user_id('EMP001')}/reset-password", "ADM001")
    assert status == 200
    with db.transaction() as cur:
        cur.execute("SELECT password_hash FROM users WHERE employee_id = 'EMP001'")
        stored = cur.fetchone()["password_hash"]
    assert passwords.verify_password(body["temporary_password"], stored)
    assert not passwords.verify_password("Empl01", stored)
    assert last_audit()["action"] == "user.reset_password"


def test_deactivate_and_reactivate(fresh_db: None) -> None:
    emp = user_id("EMP001")
    status, body = call("POST", f"/{emp}/deactivate", "ADM001")
    assert (status, body["is_active"]) == (200, False)
    assert call("POST", f"/{emp}/deactivate", "ADM001")[0] == 409

    _, listed = call("GET", "/", "ADM001")
    assert "EMP001" not in [u["employee_id"] for u in listed["items"]]
    _, listed = call("GET", "/", "ADM001", query={"status": "inactive"})
    assert [u["employee_id"] for u in listed["items"]] == ["EMP001"]

    status, body = call("POST", f"/{emp}/reactivate", "ADM001")
    assert (status, body["is_active"]) == (200, True)
    assert last_audit()["action"] == "user.reactivate"


def test_manager_with_reports_cannot_be_deactivated(fresh_db: None) -> None:
    status, body = call("POST", f"/{user_id('MGR001')}/deactivate", "ADM001")
    assert status == 409
    assert "direct report" in body["error"]["message"]


def test_admin_cannot_deactivate_self(fresh_db: None) -> None:
    assert call("POST", f"/{user_id('ADM001')}/deactivate", "ADM001")[0] == 409
