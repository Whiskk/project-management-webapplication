"""
API error types shared by every service.

Raising an ``ApiError`` anywhere inside a route handler produces a consistent
JSON error response of the form ``{"error": {"code", "message", "details"}}``.
"""

from typing import Any


class ApiError(Exception):
    """An error that maps directly to an HTTP error response."""

    def __init__(self, status: int, code: str, message: str, details: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details

    def to_body(self) -> dict:
        """Return the JSON-serialisable error body."""
        body: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details is not None:
            body["details"] = self.details
        return {"error": body}


class ValidationError(ApiError):
    """400 - request body or query parameters failed validation."""

    def __init__(self, details: dict[str, str], message: str = "Validation failed") -> None:
        super().__init__(400, "validation_error", message, details)


class BadRequest(ApiError):
    """400 - malformed request (e.g. invalid JSON)."""

    def __init__(self, message: str = "Malformed request") -> None:
        super().__init__(400, "bad_request", message)


class Unauthorized(ApiError):
    """401 - missing, invalid or expired credentials."""

    def __init__(self, message: str = "Authentication required") -> None:
        super().__init__(401, "unauthorized", message)


class Forbidden(ApiError):
    """403 - authenticated but not permitted to perform the action."""

    def __init__(self, message: str = "You do not have permission to perform this action") -> None:
        super().__init__(403, "forbidden", message)


class NotFound(ApiError):
    """404 - resource does not exist (or is not visible to the caller)."""

    def __init__(self, message: str = "Resource not found") -> None:
        super().__init__(404, "not_found", message)


class Conflict(ApiError):
    """409 - request conflicts with current state (duplicates, business rules)."""

    def __init__(self, message: str, details: Any = None) -> None:
        super().__init__(409, "conflict", message, details)
