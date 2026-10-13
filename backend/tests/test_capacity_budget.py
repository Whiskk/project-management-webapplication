"""Unit tests for the 40-hour peak calculation and budget arithmetic."""

from datetime import date
from decimal import Decimal

import pytest

from pm_core import budget
from pm_core.capacity import Load, peak_load
from pm_core.errors import Conflict

D = Decimal
JAN = (date(2026, 1, 5), date(2026, 1, 30))
MAR = (date(2026, 3, 2), date(2026, 3, 27))
JAN_TO_MAR = (date(2026, 1, 5), date(2026, 3, 27))


def test_no_loads_means_zero_peak() -> None:
    assert peak_load([], *JAN).hours == 0


def test_non_overlapping_projects_do_not_add_up() -> None:
    peak = peak_load([Load(*JAN, D(30)), Load(*MAR, D(30))], *JAN_TO_MAR)
    assert peak.hours == 30


def test_overlapping_projects_add_up_and_report_when() -> None:
    peak = peak_load(
        [Load(date(2026, 1, 5), date(2026, 1, 23), D(20)), Load(date(2026, 1, 19), date(2026, 2, 6), D(15))],
        *JAN_TO_MAR,
    )
    assert (peak.hours, peak.start, peak.end) == (35, date(2026, 1, 19), date(2026, 1, 23))


def test_loads_outside_the_window_are_ignored() -> None:
    assert peak_load([Load(*MAR, D(40))], *JAN).hours == 0


def test_load_touching_window_edge_counts() -> None:
    assert peak_load([Load(date(2025, 12, 1), date(2026, 1, 5), D(12))], *JAN).hours == 12


def test_back_to_back_projects_do_not_overlap() -> None:
    loads = [Load(date(2026, 1, 5), date(2026, 1, 16), D(30)), Load(date(2026, 1, 17), date(2026, 1, 30), D(30))]
    assert peak_load(loads, *JAN).hours == 30


def test_assignment_cost_uses_working_weeks_and_hourly_rate() -> None:
    # 10 working days = 2 weeks; 104,000 / 2080 = $50/hour; 10h/week -> $1,000
    assert budget.assignment_cost(D(10), D(104000), date(2026, 11, 2), date(2026, 11, 13)) == D("1000.00")


def test_assignment_cost_rounds_to_cents() -> None:
    assert budget.assignment_cost(D("7.5"), D(99999), date(2026, 11, 2), date(2026, 11, 4)) == D("216.34")


def test_within_budget_and_exact_fit_pass() -> None:
    budget.check_within_budget(D("999.99"), D(1000))
    budget.check_within_budget(D(1000), D(1000))


def test_one_cent_over_is_rejected_with_details() -> None:
    with pytest.raises(Conflict) as exc:
        budget.check_within_budget(D("1000.01"), D(1000), D(900), D(1000))
    assert exc.value.details == {"projected_cost": 1000.01, "budget": 1000.0, "over_by": 0.01}
    assert "$0.01 over budget" in exc.value.message


def test_change_that_does_not_make_overspend_worse_is_allowed() -> None:
    # Already over budget (e.g. after a pay rise); cost goes down, budget unchanged.
    budget.check_within_budget(D(1200), D(1000), old_cost=D(1500), old_budget=D(1000))


def test_lowering_budget_below_cost_is_rejected() -> None:
    with pytest.raises(Conflict):
        budget.check_within_budget(D(1000), D(900), old_cost=D(1000), old_budget=D(1000))
