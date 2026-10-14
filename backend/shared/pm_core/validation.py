"""
Declarative request validation.

Each service describes its payload as a dict of ``Field`` specs and calls
``validate(payload, spec)``. All problems are collected and returned together
as ``{"field": "message"}`` so the frontend can show them next to each input.
"""

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from pm_core.errors import ValidationError

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@dataclass(frozen=True)
class Field:
    """Validation rules for a single payload field."""

    kind: str  # "str" | "email" | "date" | "int" | "decimal" | "bool" | "enum" | "list"
    required: bool = True
    max_length: int | None = None
    min_value: Decimal | int | None = None
    max_value: Decimal | int | None = None
    choices: tuple[str, ...] = ()
    nullable: bool = False


def validate(payload: Any, spec: dict[str, Field], partial: bool = False) -> dict[str, Any]:
    """
    Validate ``payload`` against ``spec`` and return the cleaned values.

    Args:
        payload: The parsed JSON body.
        spec: Field name to ``Field`` rules.
        partial: When True (PATCH/PUT updates), missing fields are skipped
            instead of reported as required.

    Raises:
        ValidationError: If the payload is not an object or any field is invalid.
    """
    if not isinstance(payload, dict):
        raise ValidationError({"_": "Request body must be a JSON object"})

    errors: dict[str, str] = {}
    cleaned: dict[str, Any] = {}

    unknown = set(payload) - set(spec)
    for name in sorted(unknown):
        errors[name] = "Unknown field"

    for name, field in spec.items():
        if name not in payload:
            if field.required and not partial:
                errors[name] = "This field is required"
            continue
        value = payload[name]
        if value is None:
            if field.nullable:
                cleaned[name] = None
            else:
                errors[name] = "This field is required"
            continue
        try:
            cleaned[name] = _coerce(value, field)
        except ValueError as exc:
            errors[name] = str(exc)

    if errors:
        raise ValidationError(errors)
    return cleaned


def _coerce(value: Any, field: Field) -> Any:
    """Convert and check a single value, raising ValueError with a user-facing message."""
    match field.kind:
        case "str" | "email":
            if not isinstance(value, str):
                raise ValueError("Must be text")
            value = value.strip()
            if field.required and not value:
                raise ValueError("This field is required")
            if field.max_length is not None and len(value) > field.max_length:
                raise ValueError(f"Must be at most {field.max_length} characters")
            if field.kind == "email":
                if not _EMAIL_RE.match(value):
                    raise ValueError("Must be a valid email address")
                value = value.lower()
            return value
        case "enum":
            if value not in field.choices:
                raise ValueError(f"Must be one of: {', '.join(field.choices)}")
            return value
        case "bool":
            if not isinstance(value, bool):
                raise ValueError("Must be true or false")
            return value
        case "list":
            # Element rules are domain-specific, so callers validate the items.
            if not isinstance(value, list):
                raise ValueError("Must be a list")
            if field.max_length is not None and len(value) > field.max_length:
                raise ValueError(f"Must have at most {field.max_length} items")
            return value
        case "date":
            if not isinstance(value, str):
                raise ValueError("Must be a date (YYYY-MM-DD)")
            try:
                return date.fromisoformat(value)
            except ValueError:
                raise ValueError("Must be a date (YYYY-MM-DD)") from None
        case "int":
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError("Must be a whole number")
            _check_range(value, field)
            return value
        case "decimal":
            if isinstance(value, bool) or not isinstance(value, (int, float, str)):
                raise ValueError("Must be a number")
            try:
                number = Decimal(str(value))
            except InvalidOperation:
                raise ValueError("Must be a number") from None
            if not number.is_finite():
                raise ValueError("Must be a number")
            _check_range(number, field)
            return number
    raise ValueError(f"Unsupported field kind {field.kind}")


def _check_range(value: Decimal | int, field: Field) -> None:
    """Enforce min/max bounds on numeric values."""
    if field.min_value is not None and value < field.min_value:
        raise ValueError(f"Must be at least {field.min_value}")
    if field.max_value is not None and value > field.max_value:
        raise ValueError(f"Must be at most {field.max_value}")


def parse_id(raw: str, name: str = "id") -> int:
    """Parse a positive integer path/query id or raise a validation error."""
    if not raw.isdigit() or int(raw) <= 0:
        raise ValidationError({name: "Must be a positive integer"})
    return int(raw)


def parse_pagination(query: dict[str, str], default_size: int = 25, max_size: int = 100) -> tuple[int, int]:
    """
    Read ``page`` (1-based) and ``page_size`` query parameters.

    Returns:
        ``(limit, offset)`` ready for SQL.
    """
    errors: dict[str, str] = {}
    page_raw = query.get("page", "1")
    size_raw = query.get("page_size", str(default_size))
    if not page_raw.isdigit() or int(page_raw) < 1:
        errors["page"] = "Must be a positive integer"
    if not size_raw.isdigit() or not 1 <= int(size_raw) <= max_size:
        errors["page_size"] = f"Must be between 1 and {max_size}"
    if errors:
        raise ValidationError(errors)
    size = int(size_raw)
    return size, (int(page_raw) - 1) * size


def parse_choice(query: dict[str, str], name: str, choices: tuple[str, ...], default: str | None = None) -> str | None:
    """Read an optional query parameter restricted to ``choices``."""
    value = query.get(name, default)
    if value is not None and value not in choices:
        raise ValidationError({name: f"Must be one of: {', '.join(choices)}"})
    return value
