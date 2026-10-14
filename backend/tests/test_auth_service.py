"""Integration tests for the auth service (login, refresh, me, logout)."""

from datetime import UTC, datetime, timedelta

import jwt
import pytest

from conftest import bearer, demo_user, load_service, make_event, response_json
from pm_core import auth, db

pytestmark = pytest.mark.db

service = load_service("auth")


def call(method: str, path: str, body: object = None, headers: dict | None = None) -> dict:
    """Invoke the auth service and return (status, json body)."""
    response = service.handler(make_event(method, f"/api/auth{path}", body=body, headers=headers))
    return response["statusCode"], response_json(response)


def login(employee_id: str, password: str | None = None) -> tuple[int, dict]:
    """Attempt a login with a demo user's password (or the given one)."""
    password = password if password is not None else demo_user(employee_id)["local_password"]
    return call("POST", "/login", {"employee_id": employee_id, "password": password})


def audit_rows() -> list[dict]:
    """Return all audit entries, oldest first."""
    with db.transaction() as cur:
        cur.execute("SELECT * FROM audit_log ORDER BY id")
        return cur.fetchall()


def test_login_returns_tokens_and_user(fresh_db: None) -> None:
    status, body = login("AA7K2P")
    assert status == 200
    assert body["user"]["employee_id"] == "AA7K2P"
    assert body["user"]["role"] == "admin"
    assert "password_hash" not in body["user"]
    assert body["expires_in"] == 900
    assert auth.decode_token(body["access_token"], "access") == body["user"]["id"]
    assert auth.decode_token(body["refresh_token"], "refresh") == body["user"]["id"]


def test_login_is_case_insensitive_on_employee_id(fresh_db: None) -> None:
    assert login("aa7k2p", demo_user("AA7K2P")["local_password"])[0] == 200


def test_successful_login_is_audited(fresh_db: None) -> None:
    login("MM4R8T")
    row = audit_rows()[-1]
    assert (row["action"], row["outcome"], row["actor_employee_id"]) == ("auth.login", "success", "MM4R8T")
    assert row["actor_name"] == "Morgan Manager"


@pytest.mark.parametrize(("employee_id", "password"), [("AA7K2P", "wrong1"), ("NOPE01", "Admin1")])
def test_bad_credentials_get_same_generic_error(fresh_db: None, employee_id: str, password: str) -> None:
    status, body = login(employee_id, password)
    assert status == 401
    assert body["error"]["message"] == "Invalid employee ID or password"


def test_failed_login_is_audited_without_actor(fresh_db: None) -> None:
    login("AA7K2P", "wrong1")
    row = audit_rows()[-1]
    assert row["outcome"] == "denied"
    assert row["actor_id"] is None
    assert row["actor_employee_id"] == "AA7K2P"
    assert row["entity_id"] is not None


def test_inactive_user_cannot_log_in(fresh_db: None) -> None:
    with db.transaction() as cur:
        cur.execute("UPDATE users SET is_active = FALSE WHERE employee_id = 'EE3H9W'")
    status, _ = login("EE3H9W")
    assert status == 401
    assert "inactive account" in audit_rows()[-1]["summary"]


def test_account_locks_after_repeated_failures(fresh_db: None) -> None:
    for _ in range(service.MAX_FAILED_LOGINS):
        assert login("EE3H9W", "wrong1")[0] == 401
    status, body = login("EE3H9W")  # correct password, but locked
    assert status == 429
    assert body["error"]["code"] == "too_many_attempts"
    assert login("AA7K2P")[0] == 200  # other accounts unaffected


def test_login_validates_payload(fresh_db: None) -> None:
    status, body = call("POST", "/login", {"employee_id": ""})
    assert status == 400
    assert set(body["error"]["details"]) == {"employee_id", "password"}


def test_refresh_issues_new_tokens(fresh_db: None) -> None:
    _, tokens = login("EE3H9W")
    status, body = call("POST", "/refresh", {"refresh_token": tokens["refresh_token"]})
    assert status == 200
    assert body["user"]["employee_id"] == "EE3H9W"
    assert auth.decode_token(body["access_token"], "access") == body["user"]["id"]


def test_access_token_cannot_be_used_to_refresh(fresh_db: None) -> None:
    _, tokens = login("EE3H9W")
    status, _ = call("POST", "/refresh", {"refresh_token": tokens["access_token"]})
    assert status == 401


def test_refresh_fails_for_deactivated_user(fresh_db: None) -> None:
    _, tokens = login("EE3H9W")
    with db.transaction() as cur:
        cur.execute("UPDATE users SET is_active = FALSE WHERE employee_id = 'EE3H9W'")
    status, _ = call("POST", "/refresh", {"refresh_token": tokens["refresh_token"]})
    assert status == 401


def test_me_returns_current_user(fresh_db: None) -> None:
    status, body = call("GET", "/me", headers=bearer("MM4R8T"))
    assert status == 200
    assert body["employee_id"] == "MM4R8T"


def test_me_requires_token(fresh_db: None) -> None:
    status, body = call("GET", "/me")
    assert status == 401
    assert body["error"]["code"] == "unauthorized"


@pytest.mark.parametrize("header", ["Bearer not-a-jwt", "Basic abc", "Bearer", ""])
def test_me_rejects_malformed_headers(fresh_db: None, header: str) -> None:
    assert call("GET", "/me", headers={"Authorization": header})[0] == 401


def test_expired_token_returns_token_expired_code(fresh_db: None) -> None:
    past = datetime.now(UTC) - timedelta(hours=1)
    token = jwt.encode(
        {"sub": "1", "type": "access", "iat": past, "exp": past + timedelta(minutes=1)},
        auth._get_secret(),
        algorithm="HS256",
    )
    status, body = call("GET", "/me", headers={"Authorization": f"Bearer {token}"})
    assert status == 401
    assert body["error"]["code"] == "token_expired"


def test_token_signed_with_other_secret_is_rejected(fresh_db: None) -> None:
    token = jwt.encode(
        {"sub": "1", "type": "access", "exp": datetime.now(UTC) + timedelta(minutes=5)},
        "attacker-secret",
        algorithm="HS256",
    )
    assert call("GET", "/me", headers={"Authorization": f"Bearer {token}"})[0] == 401


def test_logout_is_audited(fresh_db: None) -> None:
    status, body = call("POST", "/logout", headers=bearer("EE3H9W"))
    assert status == 204
    assert body is None
    assert audit_rows()[-1]["action"] == "auth.logout"
