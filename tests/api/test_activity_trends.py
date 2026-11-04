"""Personal activity trends and the evidence drawer, proven through the AppSync API.

Expectations are computed with the owner role (no RLS) straight from the source rows, so
a scoping or counting bug in the Lambda cannot also hide in the expected value.
"""

from __future__ import annotations

import contextlib
import json
import re

import pytest

from harness import Persona, be_lambda_logs, graphql

TRENDS = """
query Trends($months: Int) {
  activityTrends(months: $months) {
    from to channels totalDistinctCalls totalDistinctEngagedHcps dataThrough scopeLabel
    months { month distinctCalls distinctEngagedHcps isPartial channels { channel distinctCalls } }
  }
}
"""
EVIDENCE = """
query Evidence($metric: ActivityMetric!, $month: AWSDate!, $channel: String, $limit: Int) {
  activityEvidence(metric: $metric, month: $month, channel: $channel, limit: $limit) {
    metric month channel total truncated latestInteractionDate latestLoadedAt dataThrough scopeLabel
    records { recordId kind hcpId hcpName territoryId channel callCount interactionDate loadedAt }
  }
}
"""
FIRST, LAST = "2025-12-01", "2026-11-30"  # 12 months ending in the month the seed is loaded through


def trends(persona: Persona, months: int | None = None) -> dict:
    res = persona.query(TRENDS, {"months": months})
    assert not res.errors, res.errors
    return res.data["activityTrends"]


def evidence(persona: Persona, metric: str, month: str, channel: str | None = None, limit: int | None = None):
    return persona.query(EVIDENCE, {"metric": metric, "month": month, "channel": channel, "limit": limit})


def truth(db, territories, month_start: str, channel: str | None = None) -> tuple[int, int]:
    """(distinct calls, distinct HCPs) for one calendar month, from the raw rows."""
    sql = """SELECT count(DISTINCT crm_call_id), count(DISTINCT cust_mdm_id) FROM call_activity
             WHERE territory_id = ANY(%s) AND call_dt >= %s::date AND call_dt < (%s::date + interval '1 month')"""
    args: list = [territories, month_start, month_start]
    if channel is not None:
        sql += " AND coalesce(nullif(btrim(call_chnl), ''), 'Unspecified') = %s"
        args.append(channel)
    return db.execute(sql, args).fetchone()


@contextlib.contextmanager
def extra_calls(db, rows):
    """Arrange extra Call Activity rows for T01-01 (channels and load dates the seed lacks), then remove them."""
    ids = []
    try:
        for call_id, call_dt, channel, loaded, hcp, product in rows:
            (row_id,) = db.execute(
                """INSERT INTO call_activity (call_chnl, call_dt, crm_call_id, call_type, call_sta, prd_nm,
                       territory_id, territory_name, cust_mdm_id, cust_full_nm, sys_inserted_datetime)
                   VALUES (%s, %s, %s, 'scientific', 'completed', %s, 'T01-01', 'T01-01 Oncology', %s, %s, %s)
                   RETURNING source_row_id""",
                (channel, call_dt, call_id, product, hcp, f"Synthetic HCP {hcp}", loaded),
            ).fetchone()
            ids.append(row_id)
        yield
    finally:
        db.execute("DELETE FROM call_activity WHERE source_row_id = ANY(%s)", (ids,))


def test_monthly_counts_are_distinct_calls_and_hcps(msl, db):
    t = trends(msl)
    assert (t["from"], t["to"]) == (FIRST, LAST)
    assert len(t["months"]) == 12
    assert t["scopeLabel"] == "T01-01"
    assert t["dataThrough"], "every view carries a data-through load date"
    for point in t["months"]:
        calls, hcps = truth(db, ["T01-01"], point["month"])
        assert (point["distinctCalls"], point["distinctEngagedHcps"]) == (calls, hcps), point["month"]
    (raw,) = db.execute(
        "SELECT count(*) FROM call_activity WHERE territory_id = 'T01-01' AND call_dt BETWEEN %s AND %s", (FIRST, LAST)
    ).fetchone()
    assert raw > t["totalDistinctCalls"], "the seed repeats crm_call_id per product row, so raw rows must not be counted"
    assert sum(p["distinctCalls"] for p in t["months"]) == t["totalDistinctCalls"]


def test_hcp_counts_are_not_additive_across_months(msl, db):
    """An HCP seen in two months counts once in each month and once in the window total."""
    h1, h2 = "HCP-T09-A", "HCP-T09-B"
    rows = [
        ("T09-C1", "2026-09-05", "field", "2026-09-06T08:00:00Z", h1, "PRD-0"),
        ("T09-C2", "2026-10-05", "field", "2026-10-06T08:00:00Z", h1, "PRD-0"),
        ("T09-C3", "2026-10-06", "field", "2026-10-07T08:00:00Z", h2, "PRD-0"),
    ]
    before = trends(msl)
    with extra_calls(db, rows):
        after = trends(msl)
    month = {p["month"]: p for p in after["months"]}
    prev = {p["month"]: p for p in before["months"]}
    assert month["2026-09-01"]["distinctEngagedHcps"] == prev["2026-09-01"]["distinctEngagedHcps"] + 1
    assert month["2026-10-01"]["distinctEngagedHcps"] == prev["2026-10-01"]["distinctEngagedHcps"] + 2
    # h1 is in both months, so the window total grows by 2 (h1, h2), not 3.
    assert after["totalDistinctEngagedHcps"] == before["totalDistinctEngagedHcps"] + 2
    assert after["totalDistinctCalls"] == before["totalDistinctCalls"] + 3


def test_a_call_with_several_product_rows_counts_once(msl, db):
    rows = [
        ("T09-MULTI", "2026-10-10", "field", "2026-10-11T08:00:00Z", "HCP-T09-M", "PRD-1"),
        ("T09-MULTI", "2026-10-10", "field", "2026-10-11T08:00:00Z", "HCP-T09-M", "PRD-2"),
        ("T09-MULTI", "2026-10-10", "field", "2026-10-11T08:00:00Z", "HCP-T09-M", "PRD-3"),
    ]
    before = {p["month"]: p for p in trends(msl)["months"]}["2026-10-01"]
    with extra_calls(db, rows):
        after = {p["month"]: p for p in trends(msl)["months"]}["2026-10-01"]
    assert after["distinctCalls"] == before["distinctCalls"] + 1
    assert after["distinctEngagedHcps"] == before["distinctEngagedHcps"] + 1


def test_channel_mix_counts_distinct_calls_per_channel(msl, db):
    rows = [
        ("T09-V1", "2026-10-12", "virtual", "2026-10-13T08:00:00Z", "HCP-T09-V", "PRD-0"),
        ("T09-V1", "2026-10-12", "virtual", "2026-10-13T08:00:00Z", "HCP-T09-V", "PRD-1"),
        ("T09-V2", "2026-10-13", "virtual", "2026-10-14T08:00:00Z", "HCP-T09-V", "PRD-0"),
        ("T09-B1", "2026-10-14", "", "2026-10-15T08:00:00Z", "HCP-T09-V", "PRD-0"),
    ]
    with extra_calls(db, rows):
        t = trends(msl)
        october = {p["month"]: p for p in t["months"]}["2026-10-01"]
        mix = {c["channel"]: c["distinctCalls"] for c in october["channels"]}
        assert mix["virtual"] == 2
        assert mix["Unspecified"] == 1, "a blank channel is reported as Unspecified, never dropped"
        assert mix["field"] == truth(db, ["T01-01"], "2026-10-01", "field")[0]
        assert {"field", "virtual", "Unspecified"} <= set(t["channels"])
        assert sum(mix.values()) == october["distinctCalls"]  # no call here spans channels


def test_empty_months_are_zero_not_missing(msl):
    t = trends(msl, months=24)
    assert len(t["months"]) == 24
    months = [p["month"] for p in t["months"]]
    assert months == sorted(months) and len(set(months)) == 24
    first = t["months"][0]
    assert first["distinctCalls"] == 0 and first["distinctEngagedHcps"] == 0 and first["channels"] == []


def test_current_month_is_marked_partial(msl):
    months = trends(msl)["months"]
    assert [p["isPartial"] for p in months] == [False] * 11 + [True]


def test_trends_expose_no_performance_measure(msl):
    """Counts only: the contract has no score, target, rank or attainment field to ask for."""
    for bad in ("performanceScore", "target", "attainment", "rank"):
        res = msl.query(f"query {{ activityTrends {{ {bad} }} }}")
        assert res.errors, f"{bad} must not exist on ActivityTrends"
        res = msl.query(f"query {{ activityTrends {{ months {{ {bad} }} }} }}")
        assert res.errors, f"{bad} must not exist on ActivityMonth"


def test_trends_are_scoped_to_the_callers_territory(msl, other_msl, db):
    mine, theirs = trends(msl), trends(other_msl)
    assert theirs["scopeLabel"] == "T02-01"
    for point in theirs["months"]:
        assert (point["distinctCalls"], point["distinctEngagedHcps"]) == truth(db, ["T02-01"], point["month"])
    assert mine["scopeLabel"] == "T01-01" and mine["totalDistinctCalls"] > 0
    series = lambda t: [(p["month"], p["distinctCalls"], p["distinctEngagedHcps"]) for p in t["months"]]  # noqa: E731
    assert series(mine) != series(theirs), "two territories must not return the same numbers"


def test_director_trends_cover_the_region(db):
    director = Persona.sign_in("director-region-01")
    t = trends(director)
    region = [r[0] for r in db.execute(
        "SELECT DISTINCT child_territory_id FROM territory_scope_relationships WHERE parent_territory_id = 'REGION-01'")]
    for point in t["months"]:
        assert (point["distinctCalls"], point["distinctEngagedHcps"]) == truth(db, region, point["month"])


def test_executive_is_aggregate_only_and_refused_record_level_trends():
    res = Persona.sign_in("executive-region-01").query(TRENDS)
    assert res.data is None or res.data.get("activityTrends") is None
    assert "Forbidden" in res.error_types


@pytest.mark.parametrize("months", [0, 25, -3])
def test_months_out_of_range_are_rejected(msl, months):
    assert "BadRequest" in msl.query(TRENDS, {"months": months}).error_types


@pytest.mark.parametrize("token", [None, "garbage"])
def test_trends_need_a_valid_token(token):
    res = graphql(TRENDS, None, token=token)
    assert res.status == 401 or any("Unauthorized" in t for t in res.error_types)


# ---- evidence drawer ----------------------------------------------------------------


def test_evidence_total_matches_every_chart_point(msl):
    for point in trends(msl)["months"]:
        calls = evidence(msl, "CALLS", point["month"], limit=1)
        hcps = evidence(msl, "HCPS", point["month"], limit=1)
        assert not calls.errors and not hcps.errors, (calls.errors, hcps.errors)
        assert calls.data["activityEvidence"]["total"] == point["distinctCalls"]
        assert hcps.data["activityEvidence"]["total"] == point["distinctEngagedHcps"]


def test_evidence_lists_the_distinct_calls_with_both_dates(msl, db):
    rows = [
        ("T09-E1", "2026-09-10", "virtual", "2026-10-02T12:00:00Z", "HCP-T09-E", "PRD-0"),
        ("T09-E1", "2026-09-10", "virtual", "2026-10-02T12:00:00Z", "HCP-T09-E", "PRD-1"),
    ]
    with extra_calls(db, rows):
        res = evidence(msl, "CALLS", "2026-09-20", channel="virtual", limit=50)
        assert not res.errors, res.errors
        ev = res.data["activityEvidence"]
        assert (ev["metric"], ev["month"], ev["channel"], ev["total"]) == ("CALLS", "2026-09-01", "virtual", 1)
        (rec,) = ev["records"]
        assert rec["recordId"] == "T09-E1" and rec["kind"] == "CALL" and rec["hcpId"] == "HCP-T09-E"
        assert rec["territoryId"] == "T01-01" and rec["channel"] == "virtual"
        # The interaction happened on the 10th of September; the record reached the system on 2 October.
        assert rec["interactionDate"] == "2026-09-10"
        assert rec["loadedAt"].startswith("2026-10-02T12:00:00")
        assert rec["interactionDate"] != rec["loadedAt"][:10]
        assert ev["latestInteractionDate"] == "2026-09-10"
        assert ev["latestLoadedAt"].startswith("2026-10-02T12:00:00")
        assert ev["dataThrough"], "the drawer states the data-through load date too"


def test_hcp_evidence_groups_calls_per_hcp(msl, db):
    rows = [
        ("T09-H1", "2026-10-03", "field", "2026-10-04T08:00:00Z", "HCP-T09-H", "PRD-0"),
        ("T09-H2", "2026-10-20", "field", "2026-10-25T08:00:00Z", "HCP-T09-H", "PRD-0"),
    ]
    with extra_calls(db, rows):
        ev = evidence(msl, "HCPS", "2026-10-01", limit=100).data["activityEvidence"]
        hcp = next(r for r in ev["records"] if r["recordId"] == "HCP-T09-H")
        assert hcp["kind"] == "HCP" and hcp["callCount"] == 2
        assert hcp["interactionDate"] == "2026-10-20", "latest interaction in the month"
        assert hcp["loadedAt"].startswith("2026-10-25")


def test_evidence_is_truncated_honestly(msl):
    month = max(trends(msl)["months"][:-1], key=lambda p: p["distinctCalls"])
    ev = evidence(msl, "CALLS", month["month"], limit=5).data["activityEvidence"]
    assert len(ev["records"]) == 5 and ev["total"] == month["distinctCalls"] and ev["truncated"] is True
    full = evidence(msl, "CALLS", month["month"], limit=100).data["activityEvidence"]
    assert full["truncated"] == (full["total"] > 100)


def test_evidence_never_leaks_another_territory(msl, other_msl, db):
    mine = evidence(msl, "CALLS", "2026-10-01", limit=100).data["activityEvidence"]["records"]
    theirs = evidence(other_msl, "CALLS", "2026-10-01", limit=100).data["activityEvidence"]["records"]
    assert {r["territoryId"] for r in mine} == {"T01-01"}
    assert {r["territoryId"] for r in theirs} == {"T02-01"}
    assert not {r["recordId"] for r in mine} & {r["recordId"] for r in theirs}
    owned = {r[0] for r in db.execute("SELECT DISTINCT crm_call_id FROM call_activity WHERE territory_id = 'T01-01'")}
    assert {r["recordId"] for r in mine} <= owned


def test_executive_gets_no_evidence_records():
    res = evidence(Persona.sign_in("executive-region-01"), "CALLS", "2026-10-01")
    assert "Forbidden" in res.error_types


@pytest.mark.parametrize("limit", [0, 101, -1])
def test_evidence_limit_is_bounded(msl, limit):
    assert "BadRequest" in evidence(msl, "CALLS", "2026-10-01", limit=limit).error_types


def test_evidence_rejects_an_implausible_month(msl):
    assert "BadRequest" in evidence(msl, "CALLS", "1970-01-01").error_types


def test_activity_logs_hold_no_hcp_identity(msl, db):
    """Names that evidence returns to the user must never reach the BE logs."""
    ev = evidence(msl, "CALLS", "2026-10-01", limit=20).data["activityEvidence"]
    trends(msl)
    names = {r["hcpName"] for r in ev["records"] if r["hcpName"]}
    assert names
    logs = be_lambda_logs(since="5m")
    lines = [m for m in re.findall(r"\[lambda:a2g-be-api[^\]]*\] (\{\"ts\".*)$", logs, re.MULTILINE) if "activity" in m]
    assert lines, "expected structured activity log lines"
    for rec in map(json.loads, lines):
        assert rec["service"] and rec["correlation_id"]
    for name in names:
        assert name not in logs
