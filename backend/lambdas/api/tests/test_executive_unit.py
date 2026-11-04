"""Pure rules of the Executive overview: small-group suppression, ranking and windows."""

from __future__ import annotations

import datetime as dt

import pytest

from a2g_api import executive
from a2g_api.errors import BadRequest

D = dt.date


def test_values_below_the_threshold_are_withheld_but_zero_is_not_a_small_group():
    flags, total_hidden = executive.suppress_flags([40, 0, 3, 25], 68, additive=False)
    assert flags == [False, False, True, False]
    assert total_hidden is False


def test_one_withheld_component_also_withholds_the_next_smallest_so_subtraction_fails():
    flags, total_hidden = executive.suppress_flags([40, 3, 25, 31], 99, additive=True)
    assert flags == [False, True, True, False]  # 25 is the smallest remaining; 99-40-31 no longer isolates 3
    assert total_hidden is False


def test_two_withheld_components_need_no_extra_withholding():
    flags, _ = executive.suppress_flags([40, 3, 2, 31], 76, additive=True)
    assert flags == [False, True, True, False]


def test_a_single_withheld_component_with_nothing_else_to_hide_withholds_the_total():
    flags, total_hidden = executive.suppress_flags([3, 0, 0], 3, additive=True)
    assert flags == [True, False, False]
    assert total_hidden is True


def test_a_small_total_is_withheld():
    assert executive.suppress_flags([2, 1], 3, additive=True)[1] is True


def test_non_additive_values_are_not_given_complementary_suppression():
    flags, _ = executive.suppress_flags([40, 3, 25], 90, additive=False)
    assert flags == [False, True, False]


def test_the_threshold_itself_is_shown():
    assert executive.suppress_flags([5, 4], None, additive=False)[0] == [False, True]


def test_withheld_counts_carry_no_value():
    assert executive._count(3, True) == {"value": None, "suppressed": True}
    assert executive._count(7, False) == {"value": 7, "suppressed": False}


def row(name, calls, **extra):
    base = {"id": name, "name": name, "calls": {"value": calls, "suppressed": calls is None}, "responses": {"value": 1, "suppressed": False},
            "engagedHcps": {"value": 1, "suppressed": False}, "callsPerTerritory": None, "reportingCompleteness": None}
    return {**base, **extra}


def test_ranking_orders_by_the_metric_with_ties_sharing_a_rank_and_withheld_values_unranked():
    ranked = executive._sorted_units([row("B", 50), row("A", 80), row("C", 50), row("Z", None)], "CALLS")
    assert [(r["id"], r["rank"]) for r in ranked] == [("A", 1), ("B", 2), ("C", 2), ("Z", None)]


def test_ranking_rejects_nothing_but_the_known_metrics():
    assert set(executive.RANK_BY) == {"CALLS", "RESPONSES", "ENGAGED_HCPS", "CALLS_PER_TERRITORY", "COMPLETENESS"}


def test_months_stop_at_data_through_and_mark_cut_months_partial():
    months = executive._months(D(2026, 8, 1), D(2026, 11, 30), D(2026, 11, 3))
    assert [(m["month"].isoformat(), m["isPartial"]) for m in months] == [
        ("2026-08-01", False), ("2026-09-01", False), ("2026-10-01", False), ("2026-11-01", True)
    ]


def test_the_default_window_is_twelve_months_ending_at_data_through():
    frm, to = executive._window({}, D(2026, 11, 3))
    assert (frm, to) == (D(2025, 12, 1), D(2026, 11, 3))


def test_windows_are_bounded():
    with pytest.raises(BadRequest):
        executive._window({"from": "2020-01-01", "to": "2026-01-01"}, None)
    with pytest.raises(BadRequest):
        executive._window({"from": "2026-02-01", "to": "2026-01-01"}, None)
