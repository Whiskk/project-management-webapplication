"""Forced password change for admin-issued passwords, and self-service password change."""

import pytest

from conftest import bearer, demo_user, load_service, make_event, response_json
from pm_core import db, passwords

pytestmark = pytest.mark.db

auth_service = load_service("auth")
users_service = load_service("users")
projects_service = load_service("projects")

NEW_HIRE = {
    "first_name": "Nia",
    "last_name": "Newhire",
    "email": "nia@example.com",
    "job_title": "Analyst",
    "salary": 80000,
    "role": "employee",
}


def auth_call(path: str, body: object = None, token: str | None = None, method: str = "POST") -> tuple[int, dict]:
    headers = {"authorization": f"Bearer {token}"} if token else {}
    response = auth_service.handler(make_event(method, f"/api/auth{path}", body=body, headers=headers))
    return response["statusCode"], response_json(response)


def create_new_hire() -> tuple[str, str]:
    """Admin creates an employee; returns (employee_id, temporary password)."""
    with db.transaction() as cur:
        cur.execute("SELECT id FROM users WHERE employee_id = 'MM4R8T'")
        manager_id = cur.fetchone()["id"]
    response = users_service.handler(
        make_event("POST", "/api/users", body={**NEW_HIRE, "manager_id": manager_id}, headers=bearer("AA7K2P"))
    )
    created = response_json(response)
    return created["user"]["employee_id"], created["temporary_password"]


def sign_in(employee_id: str, password: str) -> dict:
    status, body = auth_call("/login", {"employee_id": employee_id, "password": password})
    assert status == 200, body
    return body


def test_new_accounts_must_change_their_password(fresh_db: None) -> None:
    employee_id, temporary = create_new_hire()
    session = sign_in(employee_id, temporary)
    assert session["user"]["must_change_password"] is True


def test_existing_accounts_are_not_forced(fresh_db: None) -> None:
    assert sign_in("EE3H9W", demo_user("EE3H9W")["local_password"])["user"]["must_change_password"] is False


def test_everything_else_is_blocked_until_the_password_is_changed(fresh_db: None) -> None:
    employee_id, temporary = create_new_hire()
    token = sign_in(employee_id, temporary)["access_token"]
    headers = {"authorization": f"Bearer {token}"}

    response = projects_service.handler(make_event("GET", "/api/projects", headers=headers))
    assert response["statusCode"] == 403
    assert response_json(response)["error"]["code"] == "password_change_required"
    # The endpoints needed to get through the change still work.
    assert auth_call("/me", token=token, method="GET")[0] == 200


def test_changing_the_password_unlocks_the_account(fresh_db: None) -> None:
    employee_id, temporary = create_new_hire()
    token = sign_in(employee_id, temporary)["access_token"]

    status, user = auth_call("/change-password", {"current_password": temporary, "new_password": "Sunny2026"}, token)
    assert (status, user["must_change_password"]) == (200, False)

    headers = {"authorization": f"Bearer {token}"}
    assert projects_service.handler(make_event("GET", "/api/projects", headers=headers))["statusCode"] == 200
    assert auth_call("/login", {"employee_id": employee_id, "password": temporary})[0] == 401
    assert sign_in(employee_id, "Sunny2026")["user"]["must_change_password"] is False

    with db.transaction() as cur:
        cur.execute("SELECT summary, changes FROM audit_log WHERE action = 'auth.password_change'")
        entry = cur.fetchone()
    assert entry["summary"].endswith("changed their password (replacing a temporary password)")
    assert "Sunny2026" not in str(entry) and temporary not in str(entry)


@pytest.mark.parametrize(
    ("new_password", "message"),
    [
        ("short1", "Must be at least 8 characters"),
        ("lettersonly", "Must contain at least one letter and one number"),
        ("12345678", "Must contain at least one letter and one number"),
        ("x1" * 70, "Must be at most 128 characters"),
    ],
)
def test_new_password_rules(fresh_db: None, new_password: str, message: str) -> None:
    employee_id, temporary = create_new_hire()
    token = sign_in(employee_id, temporary)["access_token"]
    status, body = auth_call("/change-password", {"current_password": temporary, "new_password": new_password}, token)
    assert (status, body["error"]["details"]["new_password"]) == (400, message)


def test_current_password_must_be_right(fresh_db: None) -> None:
    employee_id, temporary = create_new_hire()
    token = sign_in(employee_id, temporary)["access_token"]
    status, body = auth_call("/change-password", {"current_password": "wrong1", "new_password": "Sunny2026"}, token)
    assert (status, body["error"]["details"]["current_password"]) == (400, "Current password is incorrect")


def test_new_password_must_differ_from_current(fresh_db: None) -> None:
    with db.transaction() as cur:
        cur.execute(
            "UPDATE users SET password_hash = %s WHERE employee_id = 'EE3H9W'",
            (passwords.hash_password("Sunny2026", 1000),),
        )
    token = sign_in("EE3H9W", "Sunny2026")["access_token"]
    status, body = auth_call("/change-password", {"current_password": "Sunny2026", "new_password": "Sunny2026"}, token)
    assert (status, body["error"]["details"]["new_password"]) == (400, "Must be different from your current password")


def test_anyone_can_change_their_password_later(fresh_db: None) -> None:
    token = sign_in("EE3H9W", demo_user("EE3H9W")["local_password"])["access_token"]
    status, _ = auth_call("/change-password", {"current_password": "Empl01", "new_password": "Brighter9day"}, token)
    assert status == 200
    assert sign_in("EE3H9W", "Brighter9day")["user"]["must_change_password"] is False


@pytest.mark.parametrize(
    ("new_password", "message"),
    [
        ("Sunny2026", "Must be at least 15 characters"),  # fine for v1
        ("Sunny2026Sunny", "Must be at least 15 characters"),  # 14
        ("lettersonlylonger", "Must contain at least one letter and one number"),
        ("x1" * 70, "Must be at most 128 characters"),
    ],
)
def test_v2_new_password_rules(fresh_db: None, new_password: str, message: str) -> None:
    employee_id, temporary = create_new_hire()
    token = sign_in(employee_id, temporary)["access_token"]
    body = {"current_password": temporary, "new_password": new_password}
    status, response = auth_call("/v2/change-password", body, token)
    assert (status, response["error"]["details"]["new_password"]) == (400, message)


def test_v2_accepts_15_characters_and_unlocks_the_account(fresh_db: None) -> None:
    employee_id, temporary = create_new_hire()
    token = sign_in(employee_id, temporary)["access_token"]
    status, user = auth_call(
        "/v2/change-password", {"current_password": temporary, "new_password": "Sunny2026Sunny1"}, token
    )
    assert (status, user["must_change_password"]) == (200, False)
    assert sign_in(employee_id, "Sunny2026Sunny1")["user"]["must_change_password"] is False

    with db.transaction() as cur:
        cur.execute("SELECT summary FROM audit_log WHERE action = 'auth.password_change'")
        assert cur.fetchone()["summary"].endswith("changed their password (replacing a temporary password)")


def test_v2_checks_the_current_password_and_needs_a_token(fresh_db: None) -> None:
    employee_id, temporary = create_new_hire()
    token = sign_in(employee_id, temporary)["access_token"]
    body = {"current_password": "wrong1", "new_password": "Sunny2026Sunny1"}
    status, response = auth_call("/v2/change-password", body, token)
    assert (status, response["error"]["details"]["current_password"]) == (400, "Current password is incorrect")
    assert auth_call("/v2/change-password", body)[0] == 401


def test_admin_reset_forces_a_change_again(fresh_db: None) -> None:
    with db.transaction() as cur:
        cur.execute("SELECT id FROM users WHERE employee_id = 'EE3H9W'")
        user_id = cur.fetchone()["id"]
    response = users_service.handler(
        make_event("POST", f"/api/users/{user_id}/reset-password", headers=bearer("AA7K2P"))
    )
    temporary = response_json(response)["temporary_password"]
    assert sign_in("EE3H9W", temporary)["user"]["must_change_password"] is True
