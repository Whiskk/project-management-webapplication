"""
Minimal HTTP layer for Lambda Function URL events.

Provides a ``Router`` that maps ``(method, path pattern)`` to handler functions,
parses requests, serialises JSON responses and converts exceptions into the
shared error format. Requests can arrive either directly (``/123/archive``, via
the local dev proxy) or through CloudFront (``/api/projects/123/archive``); the
``/api/<service>`` prefix is stripped so routes are written once.
"""

import base64
import json
import logging
import re
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import psycopg

from pm_core.errors import ApiError, BadRequest, Conflict, NotFound, ValidationError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_PARAM_RE = re.compile(r"\{(\w+)\}")
_MISSING = object()


def _json_default(value: Any) -> Any:
    """Serialise types the stdlib json module does not handle."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raise TypeError(f"Cannot serialise {type(value).__name__}")


def to_json(data: Any) -> str:
    """Serialise data with support for Decimal and date values."""
    return json.dumps(data, default=_json_default)


@dataclass
class Request:
    """A parsed incoming HTTP request."""

    method: str
    path: str
    headers: dict[str, str]
    query: dict[str, str]
    raw_body: str
    request_id: str
    service: str = ""
    params: dict[str, str] = field(default_factory=dict)
    actor: Any = None
    _body: Any = field(default=_MISSING, repr=False)

    @property
    def body(self) -> Any:
        """The JSON-decoded body (``{}`` when empty). Raises 400 on invalid JSON."""
        if self._body is _MISSING:
            if not self.raw_body:
                self._body = {}
            else:
                try:
                    self._body = json.loads(self.raw_body)
                except json.JSONDecodeError:
                    raise BadRequest("Request body is not valid JSON") from None
        return self._body


@dataclass
class Response:
    """An outgoing HTTP response."""

    status: int = 200
    body: Any = None
    headers: dict[str, str] = field(default_factory=dict)

    def to_lambda(self) -> dict:
        """Convert to the Lambda Function URL response format."""
        headers = {"Content-Type": "application/json", **self.headers}
        result: dict[str, Any] = {"statusCode": self.status, "headers": headers}
        if self.body is not None:
            result["body"] = to_json(self.body)
        return result


def ok(body: Any, status: int = 200) -> Response:
    """200 OK (or a custom success status) with a JSON body."""
    return Response(status=status, body=body)


def created(body: Any) -> Response:
    """201 Created with a JSON body."""
    return Response(status=201, body=body)


def no_content() -> Response:
    """204 No Content."""
    return Response(status=204)


Handler = Callable[[Request], Response]


class Router:
    """Maps HTTP method and path patterns (e.g. ``/{id}/archive``) to handlers."""

    def __init__(self, service: str) -> None:
        self.service = service
        self._routes: list[tuple[str, re.Pattern, Handler]] = []
        self._prefix = f"/api/{service}"

    def route(self, method: str, pattern: str) -> Callable[[Handler], Handler]:
        """Register a handler for ``method`` and ``pattern``."""
        regex = re.compile("^" + _PARAM_RE.sub(r"(?P<\1>[^/]+)", pattern.rstrip("/")) + "/?$")

        def decorator(func: Handler) -> Handler:
            self._routes.append((method.upper(), regex, func))
            return func

        return decorator

    def get(self, pattern: str) -> Callable[[Handler], Handler]:
        """Register a GET handler."""
        return self.route("GET", pattern)

    def post(self, pattern: str) -> Callable[[Handler], Handler]:
        """Register a POST handler."""
        return self.route("POST", pattern)

    def put(self, pattern: str) -> Callable[[Handler], Handler]:
        """Register a PUT handler."""
        return self.route("PUT", pattern)

    def patch(self, pattern: str) -> Callable[[Handler], Handler]:
        """
        Register an update handler for both PATCH and PUT.

        Updates have partial-update semantics (send only the fields to change),
        which PATCH describes precisely; PUT is accepted too so clients using
        the conventional ``PUT /resource/{id}`` work unchanged.
        """
        put = self.route("PUT", pattern)
        patch = self.route("PATCH", pattern)
        return lambda func: put(patch(func))

    def delete(self, pattern: str) -> Callable[[Handler], Handler]:
        """Register a DELETE handler."""
        return self.route("DELETE", pattern)

    def handle(self, event: dict | None, context: Any = None) -> dict:
        """Lambda entry point: dispatch the event and always return a valid response."""
        started = time.perf_counter()
        request = self._parse(event or {}, context)
        try:
            response = self._dispatch(request)
        except ApiError as exc:
            response = Response(status=exc.status, body=exc.to_body())
        except psycopg.errors.UniqueViolation:
            response = _error_response(Conflict("A record with these details already exists"))
        except psycopg.errors.ForeignKeyViolation:
            response = _error_response(
                ValidationError({"_": "A referenced record does not exist"})
            )
        except psycopg.errors.CheckViolation:
            response = _error_response(ValidationError({"_": "A value is out of the allowed range"}))
        except Exception:  # pylint: disable=broad-except
            logger.exception("Unhandled error (request_id=%s)", request.request_id)
            response = Response(
                status=500,
                body={"error": {
                    "code": "internal_error",
                    "message": "Something went wrong. Please try again.",
                    "details": {"request_id": request.request_id},
                }},
            )
        logger.info(
            "%s %s -> %s (%.0f ms, request_id=%s)",
            request.method, request.path, response.status,
            (time.perf_counter() - started) * 1000, request.request_id,
        )
        return response.to_lambda()

    def _dispatch(self, request: Request) -> Response:
        """Find the matching route and invoke it."""
        if request.method == "OPTIONS":
            return no_content()
        path_matched = False
        for method, regex, func in self._routes:
            match = regex.match(request.path)
            if not match:
                continue
            path_matched = True
            if method == request.method:
                request.params = match.groupdict()
                return func(request)
        if path_matched:
            raise ApiError(405, "method_not_allowed", f"{request.method} is not allowed here")
        raise NotFound(f"No route for {request.method} {request.path}")

    def _parse(self, event: dict, context: Any) -> Request:
        """Build a Request from a Lambda Function URL (payload v2) event."""
        http = event.get("requestContext", {}).get("http", {})
        method = (http.get("method") or event.get("httpMethod") or "GET").upper()
        path = event.get("rawPath") or event.get("path") or "/"
        if path == self._prefix or path.startswith(self._prefix + "/"):
            path = path[len(self._prefix):]
        path = "/" + path.strip("/")

        raw_body = event.get("body") or ""
        if raw_body and event.get("isBase64Encoded"):
            raw_body = base64.b64decode(raw_body).decode("utf-8", errors="replace")

        request_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())
        headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
        return Request(
            method=method,
            path=path,
            headers=headers,
            query=dict(event.get("queryStringParameters") or {}),
            raw_body=raw_body,
            request_id=request_id,
            service=self.service,
        )


def _error_response(error: ApiError) -> Response:
    """Convert an ApiError into a Response."""
    return Response(status=error.status, body=error.to_body())
