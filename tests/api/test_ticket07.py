"""Ticket 07 acceptance proof through Cognito -> AppSync -> BE Lambda.

No helper invokes the Lambda or DynamoDB directly: the assertions exercise the same
persona-authenticated GraphQL route used by the browser.
"""

from __future__ import annotations


DISCOVERY = """
query Discovery($filters: InsightFiltersInput) {
  insightDiscovery(filters: $filters) {
    distributions { questionId response count denominator percentage }
    questions { questionId status effectiveFrom effectiveTo applicability }
  }
}
"""

SAVE = """
mutation Save($input: SaveViewInput!) {
  saveView(input: $input) { savedViewId name reportKind filters { questionId molecule } }
}
"""

SAVED = "query Saved { savedViews { savedViewId name reportKind filters { questionId molecule } } }"


def test_question_filter_keeps_distributions_question_scoped_with_denominators(msl):
    result = msl.query(DISCOVERY, {"filters": {"from": "2026-01-01", "to": "2026-11-03", "questionId": "Q-0001"}})
    assert not result.errors, result.errors
    rows = result.data["insightDiscovery"]["distributions"]
    assert rows and {row["questionId"] for row in rows} == {"Q-0001"}
    denominator = rows[0]["denominator"]
    assert denominator > 0
    assert all(row["denominator"] == denominator for row in rows)
    assert sum(row["count"] for row in rows) == denominator
    assert all(row["percentage"] == round((row["count"] / denominator) * 100, 1) for row in rows)


def test_catalog_cards_return_status_and_effective_dates(msl):
    result = msl.query(DISCOVERY, {"filters": {"questionId": "Q-0001"}})
    assert not result.errors, result.errors
    (question,) = result.data["insightDiscovery"]["questions"]
    assert question["questionId"] == "Q-0001"
    assert question["status"] == "Active"
    assert question["effectiveFrom"]
    assert question["applicability"]


def test_saved_views_are_reopenable_and_owner_scoped(msl, other_msl):
    input_ = {"name": "Ticket 07 saved filter", "reportKind": "insight-discovery", "filters": {"questionId": "Q-0001", "molecule": "trastuzumab deruxtecan"}}
    saved = msl.query(SAVE, {"input": input_})
    assert not saved.errors, saved.errors
    view = saved.data["saveView"]
    assert view["name"] == input_["name"] and view["filters"] == input_["filters"]

    mine = msl.query(SAVED)
    assert not mine.errors, mine.errors
    assert any(item["savedViewId"] == view["savedViewId"] for item in mine.data["savedViews"])

    theirs = other_msl.query(SAVED)
    assert not theirs.errors, theirs.errors
    assert all(item["savedViewId"] != view["savedViewId"] for item in theirs.data["savedViews"])
