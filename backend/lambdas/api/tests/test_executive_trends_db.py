"""Executive trends against a real migrated and seeded Postgres.

Skipped unless ``A2G_OWNER_DB_URL`` points at one (backend/infra/scripts/test.sh sets it). Proves RLS-respecting
scope (explicit executive assignments only), aggregate-only disclosure, the approved threshold rule evaluated in the
database, and that nothing is served to other personas.
"""

from __future__ import annotations

import contextlib
import os
import re

import psycopg
import pytest

from a2g_api import executive_trends
from a2g_api.errors import BadRequest, Forbidden, NoScope
from a2g_api.identity import Identity

OWNER_DSN = os.environ.get("A2G_OWNER_DB_URL")
pytestmark = pytest.mark.skipif(not OWNER_DSN, reason="needs a migrated, seeded Postgres (A2G_OWNER_DB_URL)")

EXEC = Identity("sub-exec", "executive", "Executive", "Exec One", "exec@example.test", "header")
MSL = Identity("sub-msl", "msl", "MSL", "Msl One", "msl@example.test", "header")
DIRECTOR = Identity("sub-dir", "director", "Director", "Dir One", "dir@example.test", "header")


def app_dsn() -> str:
    return re.sub(r"//[^@]+@", "//app_user:app_user@", OWNER_DSN or "")


@contextlib.contextmanager
def session(user_id: str, persona: str = "Executive"):
    with psycopg.connect(app_dsn()) as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("SELECT app.set_request_identity(%s, %s, %s)", (user_id, persona, "test-corr"))
        yield cur


@pytest.fixture
def owner():
    with psycopg.connect(OWNER_DSN, autocommit=True) as conn:
        yield conn


@contextlib.contextmanager
def extra_regions(owner, user_id: str, regions: list[str]):
    for region in regions:
        owner.execute(
            "INSERT INTO user_scope_assignments(user_id, territory_id, assignment_type, effective_from) "
            "VALUES (%s, %s, 'executive', '2024-01-01T00:00:00Z')",
            (user_id, region),
        )
    try:
        yield
    finally:
        owner.execute("DELETE FROM user_scope_assignments WHERE user_id = %s AND territory_id = ANY(%s)", (user_id, regions))


def trends(user_id="executive-region-01", **args):
    with session(user_id) as cur:
        return executive_trends.executive_trends(cur, EXEC, user_id, args)


def shown(count):
    assert (count["value"] is None) == count["suppressed"]
    assert not (count["value"] is not None and 1 <= count["value"] < 5)
    return count["value"]


def test_an_executive_sees_only_their_explicit_region_by_month_and_by_metric():
    result = trends()
    assert result["accessLevel"] == "AGGREGATE_ONLY" and result["disclosure"]["applied"] is True
    assert [r["regionId"] for r in result["regions"]] == ["REGION-01"]
    region = result["regions"][0]
    assert len(region["months"]) == 12
    assert [m["metric"] for m in region["metrics"]] == ["CALLS", "ENGAGED_HCPS", "RESPONSES"]
    assert result["thresholds"]["approved"] is True and result["thresholds"]["minWindowResponses"] == 30
    assert shown(region["months"][0]["calls"]) is not None


def test_more_explicit_regions_add_columns_and_every_cell_obeys_small_group_disclosure(owner):
    with extra_regions(owner, "executive-region-01", ["REGION-02", "REGION-03"]):
        result = trends()
    assert [r["regionId"] for r in result["regions"]] == ["REGION-01", "REGION-02", "REGION-03"]
    for region in result["regions"]:
        for month in region["months"]:
            for field in ("calls", "responses", "engagedHcps"):
                shown(month[field])
        for metric in region["metrics"]:
            shown(metric["latest"]), shown(metric["prior"])
            if metric["trend"] == "WITHHELD":
                assert metric["changePercent"] is None


def test_steady_seed_activity_gets_no_false_alarm_and_windows_do_not_overlap():
    result = trends()
    assert result["priorTo"] < result["trendFrom"] <= result["trendTo"]
    for metric in result["regions"][0]["metrics"]:
        assert metric["trend"] == "STEADY"


def test_the_approved_rule_is_judged_in_the_database_with_a_sample_gate():
    with session("executive-region-01") as cur:
        cur.execute(
            "SELECT idx, status FROM app.exec_activity_trend_status("
            "ARRAY[100,10,50,10,50,60]::bigint[], ARRAY[50,30,50,30,100,50]::bigint[], "
            "ARRAY[100,20,60,60,60,60]::bigint[], ARRAY[100,40,60,60,60,60]::bigint[]) ORDER BY idx"
        )
        verdicts = [s for _i, s in cur.fetchall()]
    # rising (+100%), too few responses in the latest period, steady, falling (-67%), falling (-50%), steady (+20%)
    assert verdicts == ["RISING", "INSUFFICIENT_SAMPLE", "STEADY", "FALLING", "FALLING", "STEADY"]


def test_a_region_with_too_few_responses_gets_no_trend_and_a_small_group_gets_no_arrow(owner):
    # A window covering only the first days of the data holds almost no responses in the prior period.
    result = trends(**{"from": "2025-11-04", "to": "2025-11-20"})
    region = result["regions"][0]
    assert region["sampleSufficient"] is False
    assert {m["trend"] for m in region["metrics"]} == {"INSUFFICIENT_SAMPLE"}
    assert "Too few responses" in " ".join(result["sampleLimitations"])


def test_nothing_is_served_to_other_personas_or_to_an_executive_without_an_assignment(owner):
    with session("msl-t01-01", "MSL") as cur:
        with pytest.raises(Forbidden):
            executive_trends.executive_trends(cur, MSL, "msl-t01-01", {})
    with session("director-region-01", "Director") as cur:
        with pytest.raises(Forbidden):
            executive_trends.executive_trends(cur, DIRECTOR, "director-region-01", {})
    owner.execute("UPDATE user_scope_assignments SET effective_to = now() - interval '1 day' WHERE user_id = 'executive-region-02'")
    try:
        with session("executive-region-02") as cur:
            with pytest.raises(NoScope):
                executive_trends.executive_trends(cur, EXEC, "executive-region-02", {})
    finally:
        owner.execute("UPDATE user_scope_assignments SET effective_to = NULL WHERE user_id = 'executive-region-02'")


def test_an_executive_cannot_read_the_rows_behind_a_trend():
    with session("executive-region-01") as cur:
        cur.execute("SELECT count(*) FROM call_activity")
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT count(*) FROM hcp_raw_insights")
        assert cur.fetchone()[0] == 0


def test_bad_windows_are_refused():
    with pytest.raises(BadRequest):
        trends(**{"from": "2026-02-01", "to": "2026-01-01"})
    with pytest.raises(BadRequest):
        trends(**{"from": "2020-01-01", "to": "2026-01-01"})


@contextlib.contextmanager
def record_permission(owner, user_id: str):
    owner.execute("INSERT INTO roles VALUES ('test-t121-records', 'Executive with record-level access')")
    owner.execute("INSERT INTO role_permissions VALUES ('test-t121-records', 'source.records.read')")
    owner.execute(
        "INSERT INTO user_role_assignments(user_id, role_id, effective_from) VALUES (%s, 'test-t121-records', now() - interval '1 minute')",
        (user_id,),
    )
    try:
        yield
    finally:
        owner.execute("DELETE FROM user_role_assignments WHERE role_id = 'test-t121-records'")
        owner.execute("DELETE FROM role_permissions WHERE role_id = 'test-t121-records'")
        owner.execute("DELETE FROM roles WHERE role_id = 'test-t121-records'")


def test_record_level_permission_withholds_nothing_but_adds_no_drilldown(owner):
    with record_permission(owner, "executive-region-01"):
        result = trends()
    assert result["accessLevel"] == "RECORD_DRILLDOWN" and result["disclosure"]["applied"] is False
    assert result["disclosure"]["suppressedCells"] == 0
    assert not any(m["calls"]["suppressed"] for m in result["regions"][0]["months"])
    assert set(result) >= {"regions", "thresholds"} and "records" not in result
