"""Unit tests for pm_core.validation."""

from datetime import date
from decimal import Decimal

import pytest

from pm_core.errors import ValidationError
from pm_core.validation import Field, parse_id, validate

SPEC = {
    "name": Field("str", max_length=10),
    "email": Field("email"),
    "start": Field("date"),
    "budget": Field("decimal", min_value=0),
    "hours": Field("int", required=False, min_value=1, max_value=40),
    "role": Field("enum", choices=("admin", "employee")),
    "active": Field("bool", required=False),
    "note": Field("str", required=False, nullable=True),
}

VALID = {
    "name": "  Apollo ",
    "email": "Jo@Example.com",
    "start": "2026-10-13",
    "budget": "1500.50",
    "role": "admin",
}


def errors_for(payload: object, partial: bool = False) -> dict:
    """Return the validation error details for a payload."""
    with pytest.raises(ValidationError) as exc:
        validate(payload, SPEC, partial=partial)
    return exc.value.details


def test_valid_payload_is_cleaned() -> None:
    cleaned = validate(VALID, SPEC)
    assert cleaned == {
        "name": "Apollo",
        "email": "jo@example.com",
        "start": date(2026, 10, 13),
        "budget": Decimal("1500.50"),
        "role": "admin",
    }


def test_missing_required_fields_are_reported_together() -> None:
    details = errors_for({})
    assert set(details) == {"name", "email", "start", "budget", "role"}
    assert details["name"] == "This field is required"


def test_partial_skips_missing_fields() -> None:
    assert validate({"hours": 8}, SPEC, partial=True) == {"hours": 8}


def test_unknown_fields_are_rejected() -> None:
    assert errors_for({**VALID, "is_admin": True})["is_admin"] == "Unknown field"


def test_body_must_be_object() -> None:
    assert "_" in errors_for(["not", "an", "object"])


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("name", "x" * 11, "Must be at most 10 characters"),
        ("name", "   ", "This field is required"),
        ("name", 5, "Must be text"),
        ("email", "not-an-email", "Must be a valid email address"),
        ("start", "13/10/2026", "Must be a date (YYYY-MM-DD)"),
        ("start", 20261013, "Must be a date (YYYY-MM-DD)"),
        ("budget", "-1", "Must be at least 0"),
        ("budget", "abc", "Must be a number"),
        ("budget", "NaN", "Must be a number"),
        ("budget", True, "Must be a number"),
        ("hours", 41, "Must be at most 40"),
        ("hours", 1.5, "Must be a whole number"),
        ("hours", True, "Must be a whole number"),
        ("role", "superuser", "Must be one of: admin, employee"),
        ("active", "yes", "Must be true or false"),
        ("name", None, "This field is required"),
    ],
)
def test_invalid_values(field: str, value: object, message: str) -> None:
    assert errors_for({**VALID, field: value})[field] == message


def test_nullable_field_accepts_null() -> None:
    assert validate({**VALID, "note": None}, SPEC)["note"] is None


@pytest.mark.parametrize("raw", ["0", "-1", "abc", "1.5", ""])
def test_parse_id_rejects_invalid(raw: str) -> None:
    with pytest.raises(ValidationError):
        parse_id(raw)


def test_parse_id_accepts_positive_integer() -> None:
    assert parse_id("42") == 42
