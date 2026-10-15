"""
Auth service: login, token refresh, current user and logout.

Routes (under /api/auth):
    POST /login    {employee_id, password} -> tokens + user
    POST /refresh  {refresh_token}         -> tokens + user
    GET  /me                               -> current user
    POST /change-password  {current_password, new_password} -> current user
    POST /v2/change-password                                 -> same, new password >= 15 characters
    POST /logout                           -> 204 (audited; tokens are discarded client-side)

Accounts created (or reset) by an admin get a temporary password and must
choose their own at first sign-in; until then every other endpoint returns
403 ``password_change_required``.
"""

from pm_core import audit, auth, passwords
from pm_core.db import transaction
from pm_core.errors import ApiError, Unauthorized, ValidationError
from pm_core.http import Request, Response, Router, no_content, ok
from pm_core.validation import Field, validate

router = Router("auth")

MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15

LOGIN_SPEC = {
    "employee_id": Field("str", max_length=20),
    "password": Field("str", max_length=128),
}
REFRESH_SPEC = {"refresh_token": Field("str", max_length=4096)}
CHANGE_PASSWORD_SPEC = {
    "current_password": Field("str", max_length=128),
    "new_password": Field("str", max_length=passwords.MAX_CHOSEN_LENGTH),
}

INVALID_CREDENTIALS = "Invalid employee ID or password"
WRONG_CURRENT_MESSAGE = "Current password is incorrect"

# Verified against when the employee id does not exist, so failed logins take
# the same time whether or not the account exists (no user enumeration).
_DUMMY_HASH = passwords.hash_password(passwords.generate_password())


def public_user(row: dict) -> dict:
    """User fields safe to return to the logged-in user."""
    return {
        "id": row["id"],
        "employee_id": row["employee_id"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "email": row["email"],
        "job_title": row["job_title"],
        "role": row["role"],
        "manager_id": row["manager_id"],
        "must_change_password": row["must_change_password"],
    }


def _recent_failed_logins(employee_id: str) -> int:
    """Count failed logins for an employee id within the lockout window."""
    with transaction() as cur:
        cur.execute(
            """
            SELECT COUNT(*) AS n FROM audit_log
            WHERE action = 'auth.login' AND outcome = 'denied'
              AND actor_employee_id = %s
              AND occurred_at > now() - make_interval(mins => %s)
            """,
            (employee_id, LOCKOUT_MINUTES),
        )
        return cur.fetchone()["n"]


@router.post("/login")
def login(request: Request) -> Response:
    """Exchange employee id + password for access and refresh tokens."""
    data = validate(request.body, LOGIN_SPEC)
    employee_id = data["employee_id"].upper()

    if _recent_failed_logins(employee_id) >= MAX_FAILED_LOGINS:
        raise ApiError(
            429,
            "too_many_attempts",
            f"Too many failed sign-in attempts. Try again in {LOCKOUT_MINUTES} minutes.",
        )

    with transaction() as cur:
        cur.execute("SELECT * FROM users WHERE upper(employee_id) = %s", (employee_id,))
        row = cur.fetchone()

    password_ok = passwords.verify_password(data["password"], row["password_hash"] if row else _DUMMY_HASH)
    if not row or not password_ok or not row["is_active"]:
        reason = "inactive account" if row and password_ok else "invalid credentials"
        # The person attempting may not be the account owner, so no actor is
        # recorded - only the employee id that was typed and the target account.
        audit.record_denied(
            None,
            "auth.login",
            "user",
            row["id"] if row else None,
            f"Failed sign-in for {employee_id} ({reason})",
            actor_employee_id=employee_id,
        )
        raise Unauthorized(INVALID_CREDENTIALS)

    actor = auth.actor_from_row(row)
    with transaction() as cur:
        audit.record(cur, actor, "auth.login", "user", actor.id, f"{actor.name} signed in")
    return ok({**auth.issue_tokens(actor), "user": public_user(row)})


@router.post("/refresh")
def refresh(request: Request) -> Response:
    """Issue fresh tokens from a valid refresh token (user must still be active)."""
    data = validate(request.body, REFRESH_SPEC)
    user_id = auth.decode_token(data["refresh_token"], "refresh")
    with transaction() as cur:
        row = auth.load_active_user(cur, user_id)
    actor = auth.actor_from_row(row)
    return ok({**auth.issue_tokens(actor), "user": public_user(row)})


@router.get("/me")
@auth.require_auth(allow_pending_password_change=True)
def me(request: Request) -> Response:
    """Return the current user's profile."""
    with transaction() as cur:
        row = auth.load_active_user(cur, request.actor.id)
    return ok(public_user(row))


@router.post("/change-password")
@auth.require_auth(allow_pending_password_change=True)
def change_password(request: Request) -> Response:
    """Replace your own password (required after an admin issues a temporary one)."""
    return _change_password(request, passwords.MIN_CHOSEN_LENGTH)


@router.post("/v2/change-password")
@auth.require_auth(allow_pending_password_change=True)
def change_password_v2(request: Request) -> Response:
    """Same as v1, but the new password must be at least 15 characters."""
    return _change_password(request, passwords.MIN_CHOSEN_LENGTH_V2)


def _change_password(request: Request, min_length: int) -> Response:
    data = validate(request.body, CHANGE_PASSWORD_SPEC)
    actor = request.actor
    with transaction() as cur:
        cur.execute("SELECT * FROM users WHERE id = %s FOR NO KEY UPDATE", (actor.id,))
        row = cur.fetchone()
        if not passwords.verify_password(data["current_password"], row["password_hash"]):
            raise ValidationError({"current_password": WRONG_CURRENT_MESSAGE})
        problem = passwords.check_new_password(data["new_password"], data["current_password"], min_length)
        if problem:
            raise ValidationError({"new_password": problem})
        cur.execute(
            "UPDATE users SET password_hash = %s, must_change_password = FALSE, updated_at = now() WHERE id = %s",
            (passwords.hash_password(data["new_password"]), actor.id),
        )
        forced = " (replacing a temporary password)" if row["must_change_password"] else ""
        audit.record(
            cur, actor, "auth.password_change", "user", actor.id, f"{actor.name} changed their password{forced}"
        )
        cur.execute("SELECT * FROM users WHERE id = %s", (actor.id,))
        updated = cur.fetchone()
    return ok(public_user(updated))


@router.post("/logout")
@auth.require_auth(allow_pending_password_change=True)
def logout(request: Request) -> Response:
    """Record a sign-out in the audit log."""
    actor = request.actor
    with transaction() as cur:
        audit.record(cur, actor, "auth.logout", "user", actor.id, f"{actor.name} signed out")
    return no_content()


def handler(event: dict | None = None, context: object = None) -> dict:
    """Lambda entry point."""
    return router.handle(event, context)
