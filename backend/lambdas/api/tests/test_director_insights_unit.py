"""Pure rules of the Director insights: windows, response bars, and the drill-down vocabulary."""

from __future__ import annotations

import datetime as dt

import pytest

from a2g_api import director_insights as di
from a2g_api.errors import BadRequest

D = dt.date


def test_prior_window_is_the_equal_length_period_immediately_before() -> None:
    assert di._prior_window(D(2026, 8, 6), D(2026, 11, 3)) == (D(2026, 5, 8), D(2026, 8, 5))
    assert di._prior_window(D(2026, 11, 3), D(2026, 11, 3)) == (D(2026, 11, 2), D(2026, 11, 2))


@pytest.mark.parametrize("facet", ["MOLECULE", "TUMOR_TYPE", "STUDY", "SURVEY"])
def test_facets_are_a_fixed_vocabulary(facet) -> None:
    assert di._facet({"facet": facet}) == facet


@pytest.mark.parametrize("facet", ["molecule", "h.molecule_type; drop table x", "ALL", 3])
def test_unknown_facets_are_refused_not_interpolated(facet) -> None:
    with pytest.raises(BadRequest):
        di._facet({"facet": facet})


def test_no_facet_means_one_group() -> None:
    assert di._facet({}) is None and di._facet({"facet": "NONE"}) is None


def row(rid, answer, hcp="H1", territory="T01-01", interaction="I1"):
    return {"responseId": rid, "answer": answer, "hcp": hcp, "territory": territory, "interaction": interaction}


def test_choice_bars_count_distinct_responses_and_use_one_denominator() -> None:
    rows = [row("R1", "Yes", "H1"), row("R2", "Yes", "H1"), row("R3", "No", "H2"), row("R3", "No", "H2")]
    bars, _note = di._question_bars("yes_no", rows, {})
    assert {b["label"]: (b["responses"], b["distinctHcps"]) for b in bars} == {"Yes": (2, 1), "No": (1, 1)}
    assert {b["label"]: b["percentage"] for b in bars} == {"Yes": 66.7, "No": 33.3}


def test_select_all_counts_once_per_option_and_says_so() -> None:
    rows = [row("R1", "A;B"), row("R2", "A")]
    bars, note = di._question_bars("multi_select", rows, {})
    assert {b["label"]: b["responses"] for b in bars} == {"A": 2, "B": 1}
    assert "more than the denominator" in note
    assert {b["label"]: b["percentage"] for b in bars}["A"] == 100.0


def test_scales_sort_by_value_not_by_count() -> None:
    rows = [row(f"R{i}", str(v)) for i, v in enumerate([5, 1, 3, 3, 3, 10])]
    bars, _ = di._question_bars("rating_0_10", rows, {})
    assert [b["label"] for b in bars] == ["1", "3", "5", "10"]


def test_ranking_uses_the_option_ranked_first() -> None:
    bars, note = di._question_bars("ranking", [row("R1", "Efficacy > Safety"), row("R2", "Safety > Efficacy")], {})
    assert {b["label"] for b in bars} == {"Ranked first: Efficacy", "Ranked first: Safety"} and "ranked first" in note


def test_numeric_answers_fall_into_at_most_five_ranges() -> None:
    bars, _ = di._question_bars("numeric", [row(f"R{i}", str(i)) for i in range(0, 50)], {})
    assert 1 <= len(bars) <= 5 and sum(b["responses"] for b in bars) == 50


def test_free_text_is_grouped_by_derived_theme() -> None:
    rows = [row("R1", "ctDNA monitoring"), row("R2", "payer denied it")]
    bars, note = di._question_bars("open_text", rows, {"R1": "ctDNA monitoring (emerging)", "R2": "Access and reimbursement"})
    assert {b["label"] for b in bars} == {"ctDNA monitoring (emerging)", "Access and reimbursement"} and "derived themes" in note


def test_blank_and_dated_answers() -> None:
    bars, _ = di._question_bars("date", [row("R1", "2026-03-14"), row("R2", "2026-03-20"), row("R3", "")], {})
    assert {b["label"]: b["responses"] for b in bars} == {"2026-03": 2, "No response recorded": 1}


def test_evidence_is_deduplicated_and_clipped() -> None:
    long = "x" * 600
    rows = [("R1", long, "Q?", D(2026, 11, 3), "T01-01"), ("R1", long, "Q?", D(2026, 11, 3), "T01-01")]
    evidence = di._evidence(rows)
    assert len(evidence) == 1 and len(evidence[0]["excerpt"]) <= di.EXCERPT_CHARS
