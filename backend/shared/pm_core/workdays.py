"""
Working-day calendar helpers.

Project capacity is measured in working days (Monday-Friday) at 8 hours per
day, which is also the basis for the 40-hour week and labour-cost rules.
Public holidays are not modelled.
"""

from datetime import date, timedelta

HOURS_PER_DAY = 8
DAYS_PER_WEEK = 5


def working_days(start: date, end: date) -> int:
    """Count Monday-Friday days in the inclusive range ``[start, end]``."""
    if end < start:
        return 0
    total_days = (end - start).days + 1
    full_weeks, remainder = divmod(total_days, 7)
    days = full_weeks * DAYS_PER_WEEK
    for offset in range(remainder):
        if (start + timedelta(days=full_weeks * 7 + offset)).weekday() < 5:
            days += 1
    return days


def capacity_hours(start: date, end: date) -> int:
    """Total available hours for one full-time person over the range."""
    return working_days(start, end) * HOURS_PER_DAY
