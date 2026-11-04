from __future__ import annotations

from msl_agent.numbers import allowed_numbers, numbers_in, unverified_numbers


def test_dates_identifiers_and_list_markers_are_not_claims() -> None:
    text = "1. In T01-01 between 2026-08-06 and 2026-11-03 CALL-00001 and DESTINY-Breast06 appear."
    assert numbers_in(text) == []


def test_thousands_separators_and_trailing_zeros_normalise() -> None:
    assert numbers_in("There were 1,250 calls and 3.50 hours") == ["1250", "3.5"]
    assert allowed_numbers(['{"distinct_calls":1250}']) == {"1250"}


def test_a_figure_the_model_made_up_is_reported() -> None:
    allowed = allowed_numbers(['{"distinct_calls":42,"period_from":"2026-08-06"}', "how many calls?"])
    assert unverified_numbers("You had 42 calls since August 6.", allowed) == []
    assert unverified_numbers("You had 42 calls.", allowed) == []
    assert unverified_numbers("You had 43 calls, about 50% more.", allowed) == ["43", "50"]


def test_year_from_a_tool_date_is_allowed() -> None:
    allowed = allowed_numbers(['{"period_to":"2026-11-03"}'])
    assert unverified_numbers("Data runs through 2026.", allowed) == []
