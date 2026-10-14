"""
Authentication (JWT) and centralised role-based access control.

Tokens are signed with a secret generated on first use and stored in the
``app_settings`` table, so no extra environment variables are needed. Every
authenticated request reloads the user from the database, which means role
changes and deactivations take effect immediately rather than when the
token expires.
"""

import functools
import secrets
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import jwt
import psycopg

from pm_core import audit, db
from pm_core.audit import Actor
from pm_core.errors import ApiError, Forbidden, Unauthorized
from pm_core.http import Request, Response

ACCESS_TOKEN_TTL = timedelta(minutes=15)
REFRESH_TOKEN_TTL = timedelta(hours=8)
_ALGORITHM = "HS256"
_SIGNING_KEY_SETTING = "jwt_secret"

ROLES = ("admin", "manager", "employee")

_secret: str | None = None


def _get_secret() -> str:
    """Return the JWT signing secret, creating it on first use."""
    global _secret
    if _secret is None:
        with db.transaction() as cur:
            cur.execute(
                "INSERT INTO app_settings (key, value) VALUES (%s, %s) ON CONFLICT (key) DO NOTHING",
                (_SIGNING_KEY_SETTING, secrets.token_urlsafe(48)),
            )
            cur.execute("SELECT value FROM app_settings WHERE key = %s", (_SIGNING_KEY_SETTING,))
            _secret = cur.fetchone()["value"]
    return _secret


def reset_secret_cache() -> None:
    """Forget the cached secret (used in tests when the database is recreated)."""
    global _secret
    _secret = None


def actor_from_row(row: dict) -> Actor:
    """Build an Actor from a users table row."""
    return Actor(
        id=row["id"],
        employee_id=row["employee_id"],
        name=f"{row['first_name']} {row['last_name']}",
        role=row["role"],
    )


def issue_token(actor: Actor, kind: str) -> str:
    """Create a signed access or refresh token for ``actor``."""
    now = datetime.now(UTC)
    ttl = ACCESS_TOKEN_TTL if kind == "access" else REFRESH_TOKEN_TTL
    payload = {
        "sub": str(actor.id),
        "eid": actor.employee_id,
        "role": actor.role,
        "type": kind,
        "iat": now,
        "exp": now + ttl,
    }
    return jwt.encode(payload, _get_secret(), algorithm=_ALGORITHM)


def issue_tokens(actor: Actor) -> dict:
    """Return the token bundle sent to the client after login/refresh."""
    return {
        "access_token": issue_token(actor, "access"),
        "refresh_token": issue_token(actor, "refresh"),
        "expires_in": int(ACCESS_TOKEN_TTL.total_seconds()),
    }


def decode_token(token: str, expected_type: str) -> int:
    """
    Verify a token and return the user id it was issued for.

    Raises:
        ApiError: 401 ``token_expired`` when the token has expired (the
            frontend uses this code to trigger a refresh), otherwise 401
            ``unauthorized`` for any invalid token.
    """
    try:
        payload = jwt.decode(token, _get_secret(), algorithms=[_ALGORITHM], options={"require": ["exp", "sub", "type"]})
    except jwt.ExpiredSignatureError:
        raise ApiError(401, "token_expired", "Your session has expired. Please sign in again.") from None
    except jwt.InvalidTokenError:
        raise Unauthorized("Invalid authentication token") from None
    if payload.get("type") != expected_type or not str(payload["sub"]).isdigit():
        raise Unauthorized("Invalid authentication token")
    return int(payload["sub"])


def load_active_user(cur: psycopg.Cursor, user_id: int) -> dict:
    """Fetch an active user row or raise 401."""
    cur.execute("SELECT * FROM users WHERE id = %s AND is_active", (user_id,))
    row = cur.fetchone()
    if row is None:
        raise Unauthorized("This account is no longer active")
    return row


def authenticate(request: Request, allow_pending_password_change: bool = False) -> Actor:
    """
    Resolve the Actor from the request's ``Authorization: Bearer`` header.

    Users who still have an admin-issued temporary password are refused
    (403 ``password_change_required``) everywhere except the few endpoints
    needed to change it, so the "choose a new password" step can't be bypassed
    by calling the API directly.
    """
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise Unauthorized("Authentication required")
    user_id = decode_token(token.strip(), "access")
    with db.transaction() as cur:
        row = load_active_user(cur, user_id)
    if row["must_change_password"] and not allow_pending_password_change:
        raise ApiError(403, "password_change_required", "Choose a new password before continuing.")
    return actor_from_row(row)


def require_auth(*roles: str, allow_pending_password_change: bool = False) -> Callable:
    """
    Decorator enforcing authentication and (optionally) allowed roles.

    Sets ``request.actor``. Denied attempts on state-changing requests are
    written to the audit log so admins can spot unauthorised activity.

    Usage::

        @router.post("/")
        @require_auth("admin")
        def create_project(request): ...

    ``allow_pending_password_change`` is only for the endpoints a user needs
    while their temporary password is still active (me, change password, logout).
    """
    unknown = set(roles) - set(ROLES)
    if unknown:
        raise ValueError(f"Unknown roles: {unknown}")

    def decorator(func: Callable[[Request], Response]) -> Callable[[Request], Response]:
        @functools.wraps(func)
        def wrapper(request: Request) -> Response:
            request.actor = authenticate(request, allow_pending_password_change)
            if roles and request.actor.role not in roles:
                deny(request, f"requires role: {', '.join(roles)}")
            return func(request)

        return wrapper

    return decorator


def deny(request: Request, reason: str, project_id: int | None = None) -> None:
    """
    Reject the request with 403, auditing it if it would have changed data.

    Use this for fine-grained checks inside handlers too (e.g. a manager
    trying to edit a project they do not manage).
    """
    if request.method != "GET":
        audit.record_denied(
            request.actor,
            "access.denied",
            "endpoint",
            None,
            f"Denied {request.method} /{request.service}{request.path.rstrip('/')} ({reason})",
            project_id=project_id,
        )
    raise Forbidden()
