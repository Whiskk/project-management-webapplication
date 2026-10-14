"""Unit tests for pm_core.workdays."""

from datetime import date, timedelta

import pytest

from pm_core.workdays import capacity_hours, working_days


def brute_force(start: date, end: date) -> int:
    """Reference implementation: check every day."""
    return sum(1 for n in range((end - start).days + 1) if (start + timedelta(n)).weekday() < 5)


@pytest.mark.parametrize(
    ("start", "end", "expected"),
    [
        (date(2026, 10, 12), date(2026, 10, 16), 5),  # Mon-Fri
        (date(2026, 10, 12), date(2026, 10, 18), 5),  # Mon-Sun
        (date(2026, 10, 17), date(2026, 10, 18), 0),  # weekend only
        (date(2026, 10, 14), date(2026, 10, 14), 1),  # single weekday
        (date(2026, 10, 16), date(2026, 10, 19), 2),  # Fri-Mon
        (date(2026, 10, 20), date(2026, 10, 19), 0),  # end before start
    ],
)
def test_working_days(start: date, end: date, expected: int) -> None:
    assert working_days(start, end) == expected


def test_matches_brute_force_for_many_ranges() -> None:
    base = date(2026, 1, 1)
    for start_offset in range(7):
        for length in range(0, 60):
            start = base + timedelta(start_offset)
            end = start + timedelta(length)
            assert working_days(start, end) == brute_force(start, end)


def test_capacity_is_eight_hours_per_working_day() -> None:
    assert capacity_hours(date(2026, 10, 12), date(2026, 10, 23)) == 80
