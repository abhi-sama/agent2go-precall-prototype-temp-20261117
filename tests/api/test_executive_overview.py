"""Executive overview, proven through the AppSync API as seeded personas (ticket 12, #13).

Expectations are computed with the owner role (no RLS) straight from the source rows, so a scoping,
counting or suppression bug in the Lambda cannot also hide in the expected value.
"""

from __future__ import annotations

import contextlib
import json
import re

import pytest

from ground_truth import kpis, region_territories
from harness import Persona, be_lambda_logs

FROM, TO = "2026-08-01", "2026-10-31"
QUIET = ("2024-12-01", "2024-12-31")  # before the seed's data: only rows a test plants exist here

COUNT = "{ value suppressed }"
UNIT = f"rank id name level regionId regionName territoriesInScope calls {COUNT} responses {COUNT} engagedHcps {COUNT} callsPerTerritory reportingCompleteness"
OVERVIEW = f"""
query Overview($from: AWSDate, $to: AWSDate, $rankBy: ExecutiveRankBy) {{
  executiveOverview(from: $from, to: $to, rankBy: $rankBy) {{
    from to dataThrough scopeLabel accessLevel drilldownAllowed definitionVersion rankBy
    definitions {{ key label text }}
    disclosure {{ minCell text suppressedCells applied }}
    kpis {{ calls {COUNT} responses {COUNT} engagedHcps {COUNT} regionsInScope territoriesInScope reportingCompleteness }}
    freshness {{ status callsLoadedThrough responsesLoadedThrough sourceLagDays monthsShown }}
    months {{ month isPartial calls {COUNT} responses {COUNT} engagedHcps {COUNT} territoriesReporting territoriesInScope reportingCompleteness }}
    regions {{ {UNIT} }}
    territories {{ {UNIT} }}
    engagement {{
      engagedHcps {COUNT} callsPerEngagedHcp
      depth {{ band hcps {COUNT} }} channels {{ channel calls {COUNT} }}
      coverage {{ status percentage territoriesWithTargets territoriesInScope }}
    }}
    notes {{ code message }}
  }}
}}
"""
DRILLDOWN = """
query Drilldown($scopeId: ID!, $kind: ExecutiveDrilldownKind!, $month: AWSDate!, $limit: Int) {
  executiveDrilldown(scopeId: $scopeId, kind: $kind, month: $month, limit: $limit) {
    scopeId kind month total truncated dataThrough scopeLabel
    records { recordId kind territoryId hcpId hcpName detail responseText interactionDate loadedAt }
  }
}
"""


@pytest.fixture(scope="module")
def executive() -> Persona:
    return Persona.sign_in("executive-region-01")


def overview(persona: Persona, frm: str | None = FROM, to: str | None = TO, rank_by: str | None = None) -> dict:
    res = persona.query(OVERVIEW, {"from": frm, "to": to, "rankBy": rank_by})
    assert not res.errors, res.errors
    return res.data["executiveOverview"]


def drilldown(persona: Persona, scope_id: str, kind: str = "CALLS", month: str = "2026-10-01", limit: int | None = None):
    return persona.query(DRILLDOWN, {"scopeId": scope_id, "kind": kind, "month": month, "limit": limit})


def value(cell: dict) -> int | None:
    return cell["value"]


@contextlib.contextmanager
def planted_calls(db, rows):
    """Arrange extra Call Activity rows (call id, date, territory, hcp), then remove them."""
    ids = []
    try:
        for call_id, call_dt, territory, hcp in rows:
            (row_id,) = db.execute(
                """INSERT INTO call_activity (call_chnl, call_dt, crm_call_id, call_type, call_sta, prd_nm, territory_id,
                       territory_name, crm_call_user_id, rep_nm, cust_mdm_id, cust_full_nm, sys_inserted_datetime,
                       reason_for_visit, derived_disease_state)
                   VALUES ('field', %s, %s, 'scientific', 'completed', 'ProductX', %s, %s, 'planted-user', 'Planted Rep',
                           %s, %s, '2026-11-03T12:00:00Z', 'pre-call planning', 'breast cancer')
                   RETURNING source_row_id""",
                (call_dt, call_id, territory, f"{territory} Oncology", hcp, f"Planted HCP {hcp}"),
            ).fetchone()
            ids.append(row_id)
        yield
    finally:
        db.execute("DELETE FROM call_activity WHERE source_row_id = ANY(%s)", (ids,))


@contextlib.contextmanager
def record_level_permission(db, user_id: str):
    """Grant one user explicit record-level permission through a role of their own, then take it away."""
    db.execute("INSERT INTO roles VALUES ('test-t12-records', 'Executive with record-level drill-down')")
    db.execute("INSERT INTO role_permissions VALUES ('test-t12-records', 'source.records.read')")
    db.execute(
        "INSERT INTO user_role_assignments(user_id, role_id, effective_from) VALUES (%s, 'test-t12-records', now() - interval '1 minute')",
        (user_id,),
    )
    try:
        yield
    finally:
        db.execute("DELETE FROM user_role_assignments WHERE role_id = 'test-t12-records'")
        db.execute("DELETE FROM role_permissions WHERE role_id = 'test-t12-records'")
        db.execute("DELETE FROM roles WHERE role_id = 'test-t12-records'")


@contextlib.contextmanager
def changed_assignment(db, user_id: str, territory: str, set_clause: str):
    """Change the executive assignment in place, then restore the seeded row."""
    db.execute(f"UPDATE user_scope_assignments SET {set_clause} WHERE user_id = %s AND territory_id = %s", (user_id, territory))
    try:
        yield
    finally:
        db.execute(
            """UPDATE user_scope_assignments SET assignment_type = 'executive', effective_to = NULL,
                   effective_from = '2024-01-01T00:00:00Z' WHERE user_id = %s AND territory_id = %s""",
            (user_id, territory),
        )


# --- acceptance: executive scope comes only from explicit assignments -------------------------------


def test_executive_sees_exactly_the_territories_they_are_assigned_and_their_numbers(executive, db):
    data = overview(executive)
    expected = region_territories(db, "REGION-01")
    assert sorted(t["id"] for t in data["territories"]) == expected and len(expected) == 6
    assert data["scopeLabel"] == "REGION-01 · 6 territories"
    assert data["accessLevel"] == "AGGREGATE_ONLY" and data["drilldownAllowed"] is False
    truth = kpis(db, expected, FROM, TO)
    k = data["kpis"]
    assert (value(k["calls"]), value(k["responses"]), value(k["engagedHcps"])) == (
        truth["distinctCalls"], truth["responseCount"], truth["distinctEngagedHcps"],
    )
    for row in data["territories"]:
        t = kpis(db, [row["id"]], FROM, TO)
        assert (value(row["calls"]), value(row["responses"]), value(row["engagedHcps"])) == (
            t["distinctCalls"], t["responseCount"], t["distinctEngagedHcps"],
        ), row["id"]
    assert data["freshness"]["status"] == "CURRENT" and data["dataThrough"]


def test_two_executives_see_disjoint_regions(executive, db):
    other = overview(Persona.sign_in("executive-region-02"))
    assert {t["id"] for t in other["territories"]} == set(region_territories(db, "REGION-02"))
    assert not {t["id"] for t in other["territories"]} & {t["id"] for t in overview(executive)["territories"]}
    assert other["scopeLabel"] == "REGION-02 · 6 territories"


def test_a_roster_label_alone_grants_no_executive_scope(db):
    """An Executive login whose assignment is not an executive grant sees nothing, whatever the roster says."""
    (labelled,) = db.execute("SELECT count(*) FROM medical_roster WHERE region_name = 'REGION-03'").fetchone()
    assert labelled > 0, "the roster carries REGION-03 labels"
    persona = Persona.sign_in("executive-region-03")
    assert overview(persona)["scopeLabel"].startswith("REGION-03")
    with changed_assignment(db, "executive-region-03", "REGION-03", "assignment_type = 'primary'"):
        res = persona.query(OVERVIEW, {"from": FROM, "to": TO})
        assert "NoScope" in res.error_types, res.errors
    assert overview(persona)["scopeLabel"].startswith("REGION-03")


def test_executive_scope_is_effective_dated(db):
    persona = Persona.sign_in("executive-region-04")
    assert len(overview(persona)["territories"]) == 6
    with changed_assignment(db, "executive-region-04", "REGION-04", "effective_to = now() - interval '1 minute'"):
        assert "NoScope" in persona.query(OVERVIEW, {"from": FROM, "to": TO}).error_types
    with changed_assignment(db, "executive-region-04", "REGION-04", "effective_from = now() + interval '1 day'"):
        assert "NoScope" in persona.query(OVERVIEW, {"from": FROM, "to": TO}).error_types
    assert len(overview(persona)["territories"]) == 6


def test_an_explicit_second_assignment_adds_a_region_and_regions_rank(executive, db):
    (assignment,) = db.execute(
        """INSERT INTO user_scope_assignments(user_id, territory_id, assignment_type, effective_from)
           VALUES ('executive-region-01', 'REGION-02', 'executive', now() - interval '1 minute') RETURNING assignment_id"""
    ).fetchone()
    try:
        data = overview(executive)
        assert {r["id"] for r in data["regions"]} == {"REGION-01", "REGION-02"}
        assert data["kpis"]["regionsInScope"] == 2 and data["kpis"]["territoriesInScope"] == 12
        truth = {r: kpis(db, region_territories(db, r), FROM, TO)["distinctCalls"] for r in ("REGION-01", "REGION-02")}
        ranked = [(r["id"], value(r["calls"])) for r in data["regions"]]
        assert dict(ranked) == truth
        assert [calls for _id, calls in ranked] == sorted(truth.values(), reverse=True), "ranked best first"
        assert [r["rank"] for r in data["regions"]][0] == 1
    finally:
        db.execute("DELETE FROM user_scope_assignments WHERE assignment_id = %s", (assignment,))
    assert {r["id"] for r in overview(executive)["regions"]} == {"REGION-01"}


@pytest.mark.parametrize("user", ["msl-t01-01", "director-region-01", "admin-region-01"])
def test_only_executives_open_the_executive_overview(user):
    persona = Persona.sign_in(user)
    assert "Forbidden" in persona.query(OVERVIEW, {"from": FROM, "to": TO}).error_types
    assert "Forbidden" in drilldown(persona, "T01-01").error_types


def test_comparisons_use_one_window_and_one_definition_set(executive):
    data = overview(executive)
    assert data["definitionVersion"] == "executive-overview-v1"
    assert {d["key"] for d in data["definitions"]} >= {"calls", "responses", "engagedHcps", "reportingCompleteness", "coverage"}
    assert (data["from"], data["to"]) == (FROM, TO)
    assert data["territories"][0]["level"] == "TERRITORY" and data["regions"][0]["level"] == "REGION"


@pytest.mark.parametrize("rank_by", ["CALLS", "RESPONSES", "ENGAGED_HCPS", "COMPLETENESS"])
def test_territories_are_ranked_by_the_chosen_metric(executive, rank_by):
    rows = overview(executive, rank_by=rank_by)["territories"]
    metric = {"CALLS": lambda r: value(r["calls"]), "RESPONSES": lambda r: value(r["responses"]),
              "ENGAGED_HCPS": lambda r: value(r["engagedHcps"]), "COMPLETENESS": lambda r: r["reportingCompleteness"]}[rank_by]
    values = [metric(r) for r in rows]
    assert values == sorted(values, reverse=True)
    assert rows[0]["rank"] == 1 and all(a["rank"] <= b["rank"] for a, b in zip(rows, rows[1:]))


def test_an_unknown_ranking_metric_or_window_is_a_bad_request(executive):
    assert "BadRequest" in executive.query("query { executiveOverview(from: \"2020-01-01\", to: \"2026-10-01\") { from } }").error_types
    assert "BadRequest" in executive.query(OVERVIEW, {"from": "2026-10-01", "to": "2026-09-01"}).error_types


# --- trends, freshness, completeness, engagement ---------------------------------------------------------


def test_monthly_trend_matches_the_source_with_freshness_and_completeness(executive, db):
    data = overview(executive, "2026-06-01", "2026-11-30")
    tids = region_territories(db, "REGION-01")
    months = {m["month"]: m for m in data["months"]}
    assert list(months) == ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"]
    for month, row in months.items():
        last = db.execute("SELECT (date_trunc('month', %s::date) + interval '1 month - 1 day')::date", (month,)).fetchone()[0]
        truth = kpis(db, tids, month, str(last))
        assert (value(row["calls"]), value(row["responses"])) == (truth["distinctCalls"], truth["responseCount"]), month
        assert row["territoriesInScope"] == 6 and row["territoriesReporting"] == 6 and row["reportingCompleteness"] == 100.0
    assert months["2026-11-01"]["isPartial"] is True and months["2026-10-01"]["isPartial"] is False
    assert data["freshness"]["status"] == "PARTIAL", "the window runs past the load date"
    assert any(n["code"] == "AFTER_DATA_THROUGH" for n in data["notes"])


def test_a_territory_that_stopped_reporting_lowers_completeness(executive, db):
    with planted_calls(db, [(f"T12-GAP-{n}", "2024-12-10", "T01-01", f"T12-H{n}") for n in range(8)]):
        data = overview(executive, *QUIET)
    assert data["months"][0]["territoriesReporting"] == 1
    assert data["months"][0]["reportingCompleteness"] == round(100 / 6, 1)
    assert data["kpis"]["reportingCompleteness"] == round(100 / 6, 1)


def test_engagement_patterns_are_counts_of_hcps_never_who(executive, db):
    data = overview(executive)
    tids = region_territories(db, "REGION-01")
    (bands,) = db.execute(
        """SELECT count(*) FROM (SELECT cust_mdm_id FROM call_activity WHERE territory_id = ANY(%s)
           AND call_dt BETWEEN %s AND %s AND cust_mdm_id IS NOT NULL GROUP BY 1) x""",
        (tids, FROM, TO),
    ).fetchone()
    assert sum(value(b["hcps"]) for b in data["engagement"]["depth"]) == bands == value(data["engagement"]["engagedHcps"])
    assert sum(value(c["calls"]) for c in data["engagement"]["channels"]) == value(data["kpis"]["calls"])


def test_coverage_is_withheld_without_a_target_population_and_computed_with_one(executive, db):
    assert overview(executive)["engagement"]["coverage"] == {
        "status": "NO_TARGET_POPULATION", "percentage": None, "territoriesWithTargets": 0, "territoriesInScope": 6,
    }
    hcps = [r[0] for r in db.execute(
        "SELECT DISTINCT cust_mdm_id FROM call_activity WHERE territory_id = 'T01-01' AND call_dt BETWEEN %s AND %s ORDER BY 1 LIMIT 10", (FROM, TO)
    )]
    ids = []
    try:
        for hcp in [*hcps[:8], "HCP-T12-NEVER-ENGAGED", "HCP-T12-NEVER-ENGAGED-2"]:
            (assignment,) = db.execute(
                """INSERT INTO target_assignments(entity_id, scope_id, status, approved_by, effective_from)
                   VALUES (%s, 'T01-01', 'approved', 'admin-region-01', '2024-01-01') RETURNING assignment_id""",
                (hcp,),
            ).fetchone()
            ids.append(assignment)
        coverage = overview(executive)["engagement"]["coverage"]
        assert coverage["status"] == "AVAILABLE" and coverage["percentage"] == 80.0 and coverage["territoriesWithTargets"] == 1
    finally:
        db.execute("DELETE FROM target_assignments WHERE assignment_id = ANY(%s)", (ids,))


# --- acceptance: small groups are suppressed in aggregate-only views --------------------------------------


def test_small_groups_are_withheld_and_a_withheld_value_cannot_be_recovered_by_subtraction(executive, db):
    rows = [(f"T12-S1-{n}", "2024-12-05", "T01-01", f"T12-HA{n}") for n in range(3)]
    rows += [(f"T12-S2-{n}", "2024-12-06", "T01-02", f"T12-HB{n}") for n in range(7)]
    rows += [(f"T12-S3-{n}", "2024-12-07", "T01-03", f"T12-HC{n}") for n in range(9)]
    with planted_calls(db, rows):
        data = overview(executive, *QUIET)
        total = value(data["kpis"]["calls"])
        by_id = {t["id"]: t for t in data["territories"]}
    assert total == 19 and value(data["months"][0]["calls"]) == 19
    # T01-01 has 3 calls: below the threshold, so it is withheld with no number at all.
    assert by_id["T01-01"]["calls"] == {"value": None, "suppressed": True}
    # Showing T01-02 (7) and T01-03 (9) beside the total (19) would reveal T01-01 = 19 - 7 - 9, so T01-02 goes too.
    assert by_id["T01-02"]["calls"] == {"value": None, "suppressed": True}
    assert value(by_id["T01-03"]["calls"]) == 9
    assert all(value(by_id[t]["calls"]) == 0 for t in ("T01-04", "T01-05", "T01-06")), "zero is not a small group"
    unranked = [t["id"] for t in data["territories"] if t["rank"] is None]
    assert sorted(unranked) == ["T01-01", "T01-02"]
    assert data["disclosure"]["applied"] is True and data["disclosure"]["minCell"] == 5 and data["disclosure"]["suppressedCells"] > 0
    # HCPs are measured on the same calls, so a unit whose calls are withheld does not leak them as an HCP count.
    assert by_id["T01-01"]["engagedHcps"]["suppressed"] and by_id["T01-02"]["engagedHcps"]["suppressed"]
    assert value(by_id["T01-03"]["engagedHcps"]) == 9


def test_a_small_total_is_withheld_everywhere_it_appears(executive, db):
    with planted_calls(db, [(f"T12-TINY-{n}", "2024-12-05", "T01-01", f"T12-HT{n}") for n in range(3)]):
        data = overview(executive, *QUIET)
    for cell in (data["kpis"]["calls"], data["kpis"]["engagedHcps"], data["months"][0]["calls"], data["engagement"]["engagedHcps"]):
        assert cell == {"value": None, "suppressed": True}
    assert data["engagement"]["callsPerEngagedHcp"] is None
    assert all(b["hcps"]["suppressed"] for b in data["engagement"]["depth"] if b["hcps"]["value"] != 0)
    assert data["engagement"]["channels"][0]["calls"] == {"value": None, "suppressed": True}


def test_a_single_day_window_withholds_every_territory_small_group(executive, db):
    day = "2026-11-03"
    data = overview(executive, day, day)
    for row in data["territories"]:
        truth = kpis(db, [row["id"]], day, day)
        if 0 < truth["distinctCalls"] < 5:
            assert row["calls"] == {"value": None, "suppressed": True}, row["id"]
        if 0 < truth["responseCount"] < 5:
            assert row["responses"] == {"value": None, "suppressed": True}, row["id"]
    assert any(t["calls"]["suppressed"] for t in data["territories"]), "the seed's daily volume per territory is a small group"


def test_the_aggregate_response_holds_no_identifiable_record(executive, db):
    res = executive.query(OVERVIEW, {"from": FROM, "to": TO})
    text = json.dumps(res.data)
    secrets = [r[0] for r in db.execute("SELECT DISTINCT cust_full_nm FROM call_activity WHERE territory_id LIKE 'T01-%' LIMIT 25")]
    secrets += [r[0] for r in db.execute("SELECT DISTINCT cust_mdm_id FROM call_activity WHERE territory_id LIKE 'T01-%' LIMIT 25")]
    secrets += [r[0] for r in db.execute("SELECT DISTINCT rep_nm FROM call_activity WHERE rep_nm IS NOT NULL LIMIT 10")]
    secrets += [r[0] for r in db.execute("SELECT DISTINCT rspns_txt FROM hcp_raw_insights WHERE territory_id = 'T01-01' AND length(rspns_txt) >= 25 LIMIT 10")]
    assert secrets
    for secret in secrets:
        assert secret not in text, "an identifiable value reached an aggregate-only response"


def test_aggregate_only_executive_cannot_read_source_records_any_other_way(executive):
    # The record-level landing KPIs stay refused for Executives: refused, never a silent zero.
    assert "Forbidden" in executive.landing_kpis(FROM, TO).error_types


# --- acceptance: drill-down denied without record-level permission ---------------------------------------


def test_drilldown_is_denied_without_record_level_permission(executive):
    for scope in ("T01-01", "REGION-01"):
        for kind in ("CALLS", "RESPONSES"):
            res = drilldown(executive, scope, kind)
            assert "Forbidden" in res.error_types, (scope, kind)
            assert res.data is None or res.data.get("executiveDrilldown") is None


def test_drilldown_opens_with_record_level_permission_and_stays_inside_the_explicit_scope(db):
    persona = Persona.sign_in("executive-region-01")
    assert "Forbidden" in drilldown(persona, "T01-01").error_types
    with record_level_permission(db, "executive-region-01"):
        data = overview(persona)
        assert data["accessLevel"] == "RECORD_DRILLDOWN" and data["drilldownAllowed"] is True
        assert data["disclosure"]["applied"] is False
        res = drilldown(persona, "T01-01", "CALLS", "2026-10-01", limit=25)
        assert not res.errors, res.errors
        result = res.data["executiveDrilldown"]
        (truth,) = db.execute(
            "SELECT count(DISTINCT crm_call_id) FROM call_activity WHERE territory_id = 'T01-01' AND call_dt BETWEEN '2026-10-01' AND '2026-10-31'"
        ).fetchone()
        assert result["total"] == truth and len(result["records"]) == min(25, truth) and result["truncated"] == (truth > 25)
        assert {r["territoryId"] for r in result["records"]} == {"T01-01"}
        assert all(r["hcpId"] and r["interactionDate"].startswith("2026-10") for r in result["records"])
        region = drilldown(persona, "REGION-01", "RESPONSES", "2026-10-01", limit=10).data["executiveDrilldown"]
        assert region["records"] and {r["territoryId"] for r in region["records"]} <= set(region_territories(db, "REGION-01"))
        # Record-level permission never widens scope: another region, and a made-up id, get the same refusal.
        outside, missing = drilldown(persona, "T02-01"), drilldown(persona, "T99-99")
        assert "Forbidden" in outside.error_types and outside.errors == missing.errors
        assert "Forbidden" in drilldown(persona, "REGION-02", "RESPONSES").error_types
    assert "Forbidden" in drilldown(persona, "T01-01").error_types, "revoking the grant closes the drill-down at once"
    assert overview(persona)["accessLevel"] == "AGGREGATE_ONLY"


def test_drilldown_validates_its_arguments(db):
    persona = Persona.sign_in("executive-region-01")
    with record_level_permission(db, "executive-region-01"):
        assert "BadRequest" in drilldown(persona, "bad id\n").error_types
        # A malformed date never reaches the Lambda: AppSync rejects the AWSDate itself.
        assert "ValidationError" in drilldown(persona, "T01-01", "CALLS", "not-a-date").error_types
        assert "BadRequest" in drilldown(persona, "T01-01", "CALLS", "2026-10-01", limit=0).error_types
        assert "BadRequest" in drilldown(persona, "T01-01", "CALLS", "2026-10-01", limit=1000).error_types


def test_record_level_permission_without_a_grant_of_scope_still_sees_nothing(db):
    """Permission and scope are separate: record access with no executive assignment opens nothing."""
    with record_level_permission(db, "executive-region-03"):
        with changed_assignment(db, "executive-region-03", "REGION-03", "assignment_type = 'primary'"):
            persona = Persona.sign_in("executive-region-03")
            assert "NoScope" in drilldown(persona, "T03-01").error_types


# --- logging ---------------------------------------------------------------------------------------------


def test_executive_logs_hold_no_names_emails_hcp_identity_or_record_text(executive, db):
    overview(executive)
    with record_level_permission(db, "executive-region-01"):
        drilldown(executive, "T01-01")
    logs = be_lambda_logs(since="5m")
    records = [json.loads(m.group(1)) for m in re.finditer(r"\[lambda:a2g-be-[a-z]+[^\]]*\] (\{\"ts\".*)$", logs, re.MULTILINE)]
    msgs = {r.get("msg") for r in records}
    assert "executive overview served" in msgs and "executive drilldown served" in msgs
    secrets = [executive.id_token, "executive.region-01@example.test", "Executive REGION-01"]
    secrets += [r[0] for r in db.execute("SELECT DISTINCT cust_full_nm FROM call_activity WHERE territory_id = 'T01-01' LIMIT 10")]
    secrets += [r[0] for r in db.execute("SELECT DISTINCT cust_mdm_id FROM call_activity WHERE territory_id = 'T01-01' LIMIT 10")]
    secrets += [r[0] for r in db.execute("SELECT DISTINCT rspns_txt FROM hcp_raw_insights WHERE territory_id = 'T01-01' AND length(rspns_txt) >= 25 LIMIT 5")]
    for secret in secrets:
        assert secret and secret not in logs, f"sensitive value leaked into BE logs: {secret[:10]}"
