"""Tests for the centralised require_auth / deny RBAC helpers."""

import pytest

from conftest import bearer, make_event, response_json
from pm_core import auth, db
from pm_core.http import Request, Response, Router, ok

pytestmark = pytest.mark.db

router = Router("things")


@router.get("/")
@auth.require_auth()
def list_things(request: Request) -> Response:
    return ok({"actor": request.actor.employee_id, "role": request.actor.role})


@router.post("/")
@auth.require_auth("admin", "manager")
def create_thing(request: Request) -> Response:
    return ok({"created": True}, status=201)


@router.get("/admin-only")
@auth.require_auth("admin")
def admin_only(request: Request) -> Response:
    return ok({})


def call(method: str, path: str, employee_id: str | None = None) -> tuple[int, dict]:
    headers = bearer(employee_id) if employee_id else {}
    response = router.handle(make_event(method, path, headers=headers))
    return response["statusCode"], response_json(response)


def denied_entries() -> list[dict]:
    with db.transaction() as cur:
        cur.execute("SELECT * FROM audit_log WHERE outcome = 'denied'")
        return cur.fetchall()


def test_any_authenticated_role_can_read(fresh_db: None) -> None:
    for employee_id in ("ADM001", "MGR001", "EMP001"):
        status, body = call("GET", "/", employee_id)
        assert status == 200
        assert body["actor"] == employee_id


@pytest.mark.parametrize(("employee_id", "expected"), [("ADM001", 201), ("MGR001", 201), ("EMP001", 403)])
def test_role_restricted_write(fresh_db: None, employee_id: str, expected: int) -> None:
    assert call("POST", "/", employee_id)[0] == expected


def test_denied_write_returns_consistent_error_and_is_audited(fresh_db: None) -> None:
    status, body = call("POST", "/", "EMP001")
    assert status == 403
    assert body == {"error": {
        "code": "forbidden", "message": "You do not have permission to perform this action",
    }}
    [entry] = denied_entries()
    assert entry["actor_employee_id"] == "EMP001"
    assert entry["action"] == "access.denied"
    assert "POST /" in entry["summary"]


def test_denied_read_is_not_audited(fresh_db: None) -> None:
    assert call("GET", "/admin-only", "MGR001")[0] == 403
    assert denied_entries() == []


def test_role_change_takes_effect_without_new_token(fresh_db: None) -> None:
    headers = bearer("MGR001")
    with db.transaction() as cur:
        cur.execute("UPDATE users SET role = 'employee' WHERE employee_id = 'MGR001'")
    response = router.handle(make_event("POST", "/", headers=headers))
    assert response["statusCode"] == 403


def test_deactivated_user_is_rejected_immediately(fresh_db: None) -> None:
    headers = bearer("EMP001")
    with db.transaction() as cur:
        cur.execute("UPDATE users SET is_active = FALSE WHERE employee_id = 'EMP001'")
    assert router.handle(make_event("GET", "/", headers=headers))["statusCode"] == 401


def test_unknown_role_in_decorator_fails_fast() -> None:
    with pytest.raises(ValueError):
        auth.require_auth("superuser")
