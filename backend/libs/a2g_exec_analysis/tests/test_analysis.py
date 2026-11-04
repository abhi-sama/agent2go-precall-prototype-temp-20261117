"""Disclosure and shaping rules of the shared Executive analysis, over canned SQL results (no database).

The database half (scope, SECURITY DEFINER functions, the approved trend rule) is proven through the API in
tests/api/test_executive_themes.py. These tests pin what this library decides: which counts are withheld, that a
withheld count never carries a value, and that the response never lets a small group be recovered.
"""

from __future__ import annotations

import datetime as dt
import re
from collections import defaultdict
from typing import Any

import pytest
from a2g_exec_analysis import (
    InvalidFacet,
    InvalidFacetValue,
    InvalidWindow,
    NoExecutiveScope,
    executive_themes,
    executive_topic_matrix,
    suppress_flags,
)

FROM, TO = dt.date(2026, 8, 1), dt.date(2026, 10, 31)


def emerging_status(cur_n: int, pri_n: int, cur_t: int, pri_t: int) -> str:
    """The database rule (migration 009_director_insights), for the fake's trend function."""
    if cur_t < 30 or pri_t < 30:
        return "INSUFFICIENT_SAMPLE"
    if cur_n >= 10 and 100 * cur_n / cur_t - 100 * pri_n / pri_t >= 2 and (pri_n == 0 or cur_n / cur_t >= pri_n / pri_t * 1.5):
        return "EMERGING"
    if pri_n >= 10 and 100 * pri_n / pri_t - 100 * cur_n / cur_t >= 2 and cur_n / cur_t <= pri_n / pri_t * 0.5:
        return "DECLINING"
    return "STABLE"


class FakeCursor:
    """Answers the library's few queries from a cell table: {(facet value, region, topic): (cur, prior)}."""

    def __init__(self, cells: dict[tuple[str, str, str], tuple[int, int]], regions: dict[str, str], *, approved: bool = True) -> None:
        self.cells, self.regions, self.approved = cells, regions, approved
        self._rows: list[tuple[Any, ...]] = []
        self.queries: list[str] = []

    def execute(self, sql: str, params: Any = None) -> None:
        self.queries.append(sql)
        text = " ".join(sql.split())
        if "FROM app.exec_units()" in text:
            self._rows = [(r, name, 6) for r, name in sorted(self.regions.items())]
        elif "app.exec_theme_counts" in text:
            self._rows = self._counts()
        elif "app.emerging_thresholds" in text:
            self._rows = [(30, 10, 0.5, 2.0)]
        elif "app.exec_threshold_definition" in text:
            self._rows = [("emerging-topic-rule", 1, dt.datetime(2026, 11, 1, tzinfo=dt.UTC))] if self.approved else []
        elif "app.exec_trend_status" in text:
            cur_n, pri_n, cur_t, pri_t = params
            status = {"EMERGING": "EMERGING", "DECLINING": "DECLINING", "STABLE": "STABLE", "INSUFFICIENT_SAMPLE": "INSUFFICIENT_SAMPLE"}
            self._rows = [(i + 1, status[emerging_status(*vals)]) for i, vals in enumerate(zip(cur_n, pri_n, cur_t, pri_t))]
        elif "app.exec_theme_records" in text:
            _frm, _to, _facet, fv, topic, _max = params
            self._rows = [("RSP-1", "T01-01", dt.date(2026, 10, 30), "Payers keep asking for appeals data. " * 10, "Q?")]
        else:  # pragma: no cover - a new query must be taught to the fake on purpose
            raise AssertionError(f"unexpected SQL: {text[:80]}")

    def _counts(self) -> list[tuple[Any, ...]]:
        cell, theme, region, group = {}, defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0])
        for (fv, r, t), (c, p) in self.cells.items():
            cell[(fv, r, t)] = (c, p)
            for acc, key in ((theme, (fv, t)), (region, (fv, r)), (group, fv)):
                acc[key][0] += c
                acc[key][1] += p
        rows = [("CELL", fv, r, t, c, p, c, p) for (fv, r, t), (c, p) in cell.items()]
        rows += [("THEME", fv, None, t, c, p, c, p) for (fv, t), (c, p) in theme.items()]
        rows += [("REGION", fv, r, None, c, p, c, p) for (fv, r), (c, p) in region.items()]
        rows += [("GROUP", fv, None, None, c, p, c, p) for fv, (c, p) in group.items()]
        return rows

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self._rows

    def fetchone(self) -> tuple[Any, ...] | None:
        return self._rows[0] if self._rows else None


REGIONS = {"R1": "Region One", "R2": "Region Two", "R3": "Region Three"}


def portfolio(rows: dict[tuple[str, str], tuple[int, int]]) -> FakeCursor:
    return FakeCursor({("Portfolio", r, t): v for (r, t), v in rows.items()}, REGIONS)


def all_counts(node: Any) -> list[dict[str, Any]]:
    """Every {value, suppressed} object anywhere in a response."""
    found: list[dict[str, Any]] = []
    if isinstance(node, dict):
        if set(node) == {"value", "suppressed"}:
            found.append(node)
        for v in node.values():
            found.extend(all_counts(v))
    elif isinstance(node, list):
        for v in node:
            found.extend(all_counts(v))
    return found


def assert_no_small_group(response: dict[str, Any]) -> None:
    for c in all_counts(response):
        if c["suppressed"]:
            assert c["value"] is None
        else:
            assert c["value"] is None or not 1 <= c["value"] < 5, c


def big_matrix() -> dict[tuple[str, str], tuple[int, int]]:
    out = {}
    for r in REGIONS:
        for t, base in (("Access and reimbursement", 60), ("Biomarker testing", 50), ("Other perspectives", 30)):
            out[(r, t)] = (base, base)
    return out


def test_suppress_flags_withholds_small_groups_and_their_complement():
    assert suppress_flags([40, 0, 3, 25], 68, additive=False) == ([False, False, True, False], False)
    flags, total_hidden = suppress_flags([40, 3, 25, 31], 99, additive=True)
    assert flags == [False, True, True, False] and total_hidden is False
    flags, total_hidden = suppress_flags([3, 0, 0], 3, additive=True)
    assert flags == [True, False, False] and total_hidden is True


def test_small_cell_is_withheld_and_the_next_smallest_cell_goes_with_it():
    rows = big_matrix()
    rows[("R1", "Biomarker testing")] = (3, 40)  # one small cell in R1's column
    out = executive_topic_matrix(portfolio(rows), FROM, TO)
    assert_no_small_group(out)
    cells = {(row["topic"], c["regionId"]): c for row in out["rows"] for c in row["cells"]}
    assert cells[("Biomarker testing", "R1")]["responses"] == {"value": None, "suppressed": True}
    # The column still shows its total, so a second cell is withheld and 3 cannot be found by subtraction.
    hidden_in_r1 = [t for (t, r), c in cells.items() if r == "R1" and c["responses"]["suppressed"]]
    assert len(hidden_in_r1) == 2 and "Other perspectives" in hidden_in_r1
    assert cells[("Biomarker testing", "R2")]["responses"]["value"] == 50


def test_a_withheld_count_never_yields_an_arrow_or_a_share():
    rows = big_matrix()
    rows[("R1", "Biomarker testing")] = (2, 40)
    out = executive_topic_matrix(portfolio(rows), FROM, TO)
    cell = next(c for row in out["rows"] for c in row["cells"] if row["topic"] == "Biomarker testing" and c["regionId"] == "R1")
    assert cell["trend"] == "WITHHELD" and cell["share"] is None and cell["alert"] is False and cell["sharePointChange"] is None


def test_rising_in_two_regions_is_a_cross_region_topic_and_alerts():
    rows = big_matrix()
    rows[("R1", "Access and reimbursement")] = (90, 40)
    rows[("R2", "Access and reimbursement")] = (80, 40)
    out = executive_topic_matrix(portfolio(rows), FROM, TO)
    row = next(r for r in out["rows"] if r["topic"] == "Access and reimbursement")
    assert row["crossRegion"] is True and row["regionsRising"] == 2
    assert [c["alert"] for c in row["cells"]] == [True, True, False]
    assert [c["trend"] for c in row["cells"]] == ["RISING", "RISING", "STEADY"]


def test_a_region_with_too_few_responses_is_flagged_and_gets_no_trend():
    rows = {("R1", "Access and reimbursement"): (60, 60), ("R1", "Other perspectives"): (30, 30), ("R2", "Access and reimbursement"): (12, 12), ("R2", "Other perspectives"): (9, 9)}
    out = executive_topic_matrix(portfolio(rows), FROM, TO)
    regions = {r["regionId"]: r for r in out["regions"]}
    assert regions["R1"]["sampleSufficient"] is True and regions["R2"]["sampleSufficient"] is False
    assert all(c["trend"] == "INSUFFICIENT_SAMPLE" for row in out["rows"] for c in row["cells"] if c["regionId"] == "R2")
    assert any("Region Two" in text and "no trend" in text for text in out["sampleLimitations"])


def test_thresholds_are_returned_with_their_approval():
    out = executive_topic_matrix(portfolio(big_matrix()), FROM, TO)
    t = out["thresholds"]
    assert (t["minWindowResponses"], t["minTopicResponses"], t["minSharePoints"], t["minCell"]) == (30, 10, 2.0, 5)
    assert t["approved"] is True and t["definitionId"] == "emerging-topic-rule" and t["version"] == 1
    unapproved = executive_topic_matrix(FakeCursor({("Portfolio", "R1", "x"): (50, 50)}, REGIONS, approved=False), FROM, TO)
    assert unapproved["thresholds"]["approved"] is False and unapproved["thresholds"]["definitionId"] is None


def test_theme_card_count_is_withheld_when_a_region_cell_of_its_row_is_withheld():
    rows = big_matrix()
    rows[("R2", "Biomarker testing")] = (4, 4)
    out = executive_themes(portfolio(rows), FROM, TO)
    assert_no_small_group(out)
    cards = {c["topic"]: c for c in out["groups"][0]["cards"]}
    # The card is the sum of its row of the matrix; showing it would let the withheld cell be recovered.
    assert "Biomarker testing" not in cards
    assert cards["Access and reimbursement"]["responses"]["value"] == 180
    assert out["disclosure"]["suppressedCells"] > 0 and out["disclosure"]["applied"] is True


def test_cards_cite_their_response_set_without_opening_any_record():
    out = executive_themes(portfolio(big_matrix()), FROM, TO)
    card = out["groups"][0]["cards"][0]
    (citation,) = card["citations"]
    assert citation["kind"] == "AGGREGATE" and citation["recordId"] is None and citation["excerpt"] is None
    assert citation["citationId"].startswith("agg:") and citation["responses"]["value"] == card["responses"]["value"]
    assert card["topic"] in citation["label"] and "2026-08-01 to 2026-10-31" in citation["label"]


def test_record_level_permission_withholds_nothing_and_cites_responses():
    rows = big_matrix()
    rows[("R1", "Biomarker testing")] = (3, 3)
    out = executive_topic_matrix(portfolio(rows), FROM, TO, record_level=True)
    cell = next(c for row in out["rows"] for c in row["cells"] if row["topic"] == "Biomarker testing" and c["regionId"] == "R1")
    assert cell["responses"] == {"value": 3, "suppressed": False}
    assert out["disclosure"]["applied"] is False and out["disclosure"]["suppressedCells"] == 0
    themes = executive_themes(portfolio(rows), FROM, TO, record_level=True)
    kinds = {c["kind"] for g in themes["groups"] for card in g["cards"] for c in card["citations"]}
    assert kinds == {"AGGREGATE", "RECORD"}
    record = next(c for g in themes["groups"] for card in g["cards"] for c in card["citations"] if c["kind"] == "RECORD")
    assert record["recordId"] == "RSP-1" and len(record["excerpt"]) <= 280


def test_sample_limitations_say_what_the_numbers_are_and_are_not():
    out = executive_themes(portfolio(big_matrix()), FROM, TO)
    text = " ".join(out["sampleLimitations"])
    assert re.search(r"Based on 420 free-text responses between 2026-08-01 and 2026-10-31", text)
    assert "not a random sample" in text and "not why" in text and "derived" in text


def test_facets_group_by_value_and_the_matrix_reads_one_value():
    cells = {("breast cancer", "R1", "Access and reimbursement"): (60, 55), ("lung cancer", "R1", "Access and reimbursement"): (40, 45)}
    cur = FakeCursor(cells, {"R1": "Region One"})
    themes = executive_themes(cur, FROM, TO, "DISEASE_AREA")
    assert [g["facetValue"] for g in themes["groups"]] == ["breast cancer", "lung cancer"] and themes["facet"] == "DISEASE_AREA"
    matrix = executive_topic_matrix(cur, FROM, TO, "DISEASE_AREA", "lung cancer")
    assert matrix["facetValue"] == "lung cancer" and matrix["rows"][0]["cells"][0]["responses"]["value"] == 40


def test_invalid_input_is_refused():
    cur = portfolio(big_matrix())
    with pytest.raises(InvalidFacet):
        executive_themes(cur, FROM, TO, "TEAM")
    with pytest.raises(InvalidFacetValue):
        executive_topic_matrix(cur, FROM, TO, "PORTFOLIO", "breast cancer")
    with pytest.raises(InvalidFacetValue):
        executive_topic_matrix(FakeCursor({("a", "R1", "x"): (50, 50)}, REGIONS), FROM, TO, "STUDY", "nope")
    with pytest.raises(InvalidWindow):
        executive_themes(cur, TO, FROM)
    with pytest.raises(NoExecutiveScope):
        executive_themes(FakeCursor({}, {}), FROM, TO)
