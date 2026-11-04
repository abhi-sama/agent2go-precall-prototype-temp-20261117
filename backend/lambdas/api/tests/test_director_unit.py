"""Pure rules of the Director overview: windows, completeness months, coverage and disclosures."""

from __future__ import annotations

import datetime as dt

import pytest

from a2g_api import director
from a2g_api.errors import BadRequest

D = dt.date


def months(frm, to, through):
    return [(m["month"].isoformat(), m["isPartial"]) for m in director._window_months(frm, to, through)]


def test_months_stop_at_data_through_and_mark_cut_months_partial():
    assert months(D(2026, 8, 1), D(2026, 10, 31), D(2026, 11, 3)) == [
        ("2026-08-01", False),
        ("2026-09-01", False),
        ("2026-10-01", False),
    ]
    # A window that starts mid-month and runs past data-through: both ends are partial.
    assert months(D(2026, 9, 15), D(2026, 11, 30), D(2026, 11, 3)) == [
        ("2026-09-01", True),
        ("2026-10-01", False),
        ("2026-11-01", True),
    ]


def test_no_months_are_expected_before_data_arrives():
    assert months(D(2026, 12, 1), D(2026, 12, 31), D(2026, 11, 3)) == []


def test_window_defaults_to_ninety_days_ending_at_data_through():
    frm, to = director._window({}, dt.datetime(2026, 11, 3, 12, tzinfo=dt.UTC))
    assert (to, (to - frm).days + 1) == (D(2026, 11, 3), 90)


@pytest.mark.parametrize(
    "args",
    [{"from": "2026-10-01", "to": "2026-09-01"}, {"from": "2025-01-01", "to": "2026-11-03"}, {"from": "nope"}],
)
def test_window_rejects_reversed_overlong_and_malformed_ranges(args):
    with pytest.raises(BadRequest):
        director._window(args, dt.datetime(2026, 11, 3, tzinfo=dt.UTC))


def test_a_year_is_allowed_but_not_a_day_more():
    assert director._window({"from": "2025-11-03", "to": "2026-11-03"}, None)
    with pytest.raises(BadRequest):
        director._window({"from": "2025-11-02", "to": "2026-11-03"}, None)


def test_coverage_is_withheld_without_a_target_population():
    assert director._coverage(0, 0) == {"status": "NO_TARGET_POPULATION", "targetHcps": None, "engagedTargetHcps": None, "percentage": None}
    assert director._coverage(3, 2) == {"status": "AVAILABLE", "targetHcps": 3, "engagedTargetHcps": 2, "percentage": 66.7}
    assert director._coverage(8, 0)["percentage"] == 0.0


def row(**over):
    base = {
        "reportingMembers": 3,
        "rosteredMembers": 3,
        "reportingCompleteness": 1.0,
        "latestLoadDate": "2026-11-03",
        "coverage": director._coverage(0, 0),
    }
    return {**base, **over}


def codes(rows, frm=D(2026, 8, 1), to=D(2026, 10, 31)):
    return {d["code"] for d in director._disclosures(rows, frm, to, D(2026, 11, 3))}


def test_equal_populations_raise_no_unequal_disclosure():
    found = codes([row(), row()])
    assert found == {"COVERAGE_WITHHELD"}
    assert not found & director.UNEQUAL_CODES


def test_unequal_team_sizes_completeness_and_targets_are_disclosed():
    found = codes([row(), row(reportingMembers=1, rosteredMembers=2, reportingCompleteness=0.5)])
    assert {"REPORTING_MEMBERS_DIFFER", "ROSTER_SIZE_DIFFERS", "COMPLETENESS_DIFFERS"} <= found
    assert codes([row(coverage=director._coverage(4, 2)), row()]) >= {"TARGET_DATA_UNEVEN"}
    assert "TARGET_POPULATION_DIFFERS" in codes([row(coverage=director._coverage(4, 2)), row(coverage=director._coverage(9, 3))])
    assert "TARGET_POPULATION_DIFFERS" not in codes([row(coverage=director._coverage(4, 2)), row(coverage=director._coverage(4, 3))])


def test_a_partial_period_is_disclosed_for_every_territory_alike():
    assert "PARTIAL_PERIOD" in codes([row(), row()], frm=D(2026, 9, 15))
