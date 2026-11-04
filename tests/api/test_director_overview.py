"""Director overview and territory comparisons, proven through the AppSync API as seeded personas.

Expectations are computed with the owner role (no RLS) straight from the source rows, so a scoping
or counting bug in the Lambda cannot also hide in the expected value.
"""

from __future__ import annotations

import contextlib
import json
import re

import pytest

from ground_truth import kpis, region_territories
from harness import Persona, be_lambda_logs

FROM, TO = "2026-08-01", "2026-10-31"

OVERVIEW = """
query Overview($from: AWSDate, $to: AWSDate) {
  directorOverview(from: $from, to: $to) {
    from to dataThrough scopeLabel definitionVersion
    definitions { key label text }
    kpis { distinctCalls distinctEngagedHcps callProductRows responseCount reportingMembers territoriesInScope
           territoriesWithActivity unattributedCalls reportingCompleteness }
    months { month isPartial distinctCalls distinctEngagedHcps }
    territories { territoryId name regionId regionName distinctCalls distinctEngagedHcps callProductRows responseCount
                  reportingMembers rosteredMembers callsPerReportingMember reportingCompleteness latestLoadDate
                  coverage { status targetHcps engagedTargetHcps percentage } }
    members { memberId name linkedToRoster territoryIds distinctCalls activeMonths expectedMonths reportingCompleteness
              months { month distinctCalls } }
    mix { dimension label totalDistinctCalls valueTotal valuesOverlap
          values { value distinctCalls callProductRows months { month distinctCalls } } }
    coverage { status targetHcps engagedTargetHcps percentage territoriesWithTargets territoriesInScope asOf }
    notes { code message }
  }
}
"""
COMPARE = """
query Compare($ids: [ID!]!, $from: AWSDate, $to: AWSDate) {
  territoryComparison(territoryIds: $ids, from: $from, to: $to) {
    from to dataThrough scopeLabel definitionVersion
    definitions { key }
    territories { territoryId name distinctCalls distinctEngagedHcps responseCount reportingMembers rosteredMembers
                  callsPerReportingMember reportingCompleteness latestLoadDate
                  coverage { status targetHcps engagedTargetHcps percentage } }
    populationsUnequal
    disclosures { code message }
  }
}
"""


@pytest.fixture(scope="module")
def director() -> Persona:
    return Persona.sign_in("director-region-01")


def overview(persona: Persona, frm: str | None = FROM, to: str | None = TO) -> dict:
    res = persona.query(OVERVIEW, {"from": frm, "to": to})
    assert not res.errors, res.errors
    return res.data["directorOverview"]


def compare(persona: Persona, ids: list[str], frm: str | None = FROM, to: str | None = TO):
    return persona.query(COMPARE, {"ids": ids, "from": frm, "to": to})


def by_territory(data: dict) -> dict[str, dict]:
    return {t["territoryId"]: t for t in data["territories"]}


@contextlib.contextmanager
def extra_calls(db, rows):
    """Arrange extra Call Activity rows (call id, date, territory, user, hcp, product, channel), then remove them."""
    ids = []
    try:
        for call_id, call_dt, territory, user, hcp, product, channel in rows:
            (row_id,) = db.execute(
                """INSERT INTO call_activity (call_chnl, call_dt, crm_call_id, call_type, call_sta, prd_nm, territory_id,
                       territory_name, crm_call_user_id, rep_nm, cust_mdm_id, cust_full_nm, sys_inserted_datetime,
                       reason_for_visit, derived_disease_state)
                   VALUES (%s, %s, %s, 'scientific', 'completed', %s, %s, %s, %s, %s, %s, %s, '2026-11-03T12:00:00Z',
                           'pre-call planning', 'breast cancer')
                   RETURNING source_row_id""",
                (channel, call_dt, call_id, product, territory, f"{territory} Oncology", user, f"Rep {user}" if user else None, hcp, f"Synthetic HCP {hcp}"),
            ).fetchone()
            ids.append(row_id)
        yield
    finally:
        db.execute("DELETE FROM call_activity WHERE source_row_id = ANY(%s)", (ids,))


@contextlib.contextmanager
def targets(db, rows):
    """Arrange target-population rows (hcp, territory, status, from-offset, to-offset), then remove them."""
    ids = []
    try:
        for hcp, territory, status, start, end in rows:
            (row_id,) = db.execute(
                f"""INSERT INTO target_assignments (entity_id, scope_id, status, source, approved_by, effective_from, effective_to)
                    VALUES (%s, %s, %s, 'test list', %s, now() + interval '{start}', {f"now() + interval '{end}'" if end else "NULL"})
                    RETURNING assignment_id""",
                (hcp, territory, status, "admin-region-01" if status == "approved" else None),
            ).fetchone()
            ids.append(row_id)
        yield
    finally:
        db.execute("DELETE FROM target_assignments WHERE assignment_id = ANY(%s)", (ids,))


# --- descendant scopes only ------------------------------------------------------------------------


def test_director_sees_exactly_the_descendant_territories_and_their_numbers(director, db):
    data = overview(director)
    expected = region_territories(db, "REGION-01")
    assert sorted(by_territory(data)) == expected and len(expected) == 6
    assert data["scopeLabel"] == "REGION-01 · 6 territories"
    assert data["kpis"]["territoriesInScope"] == 6
    truth = kpis(db, expected, FROM, TO)
    k = data["kpis"]
    assert (k["distinctCalls"], k["distinctEngagedHcps"], k["responseCount"]) == (
        truth["distinctCalls"],
        truth["distinctEngagedHcps"],
        truth["responseCount"],
    )
    for tid, row in by_territory(data).items():
        t = kpis(db, [tid], FROM, TO)
        assert (row["distinctCalls"], row["distinctEngagedHcps"], row["responseCount"]) == (
            t["distinctCalls"],
            t["distinctEngagedHcps"],
            t["responseCount"],
        ), tid
    assert data["dataThrough"], "every view carries a data-through load date"


def test_two_directors_see_disjoint_regions(director, db):
    other = Persona.sign_in("director-region-02")
    mine, theirs = set(by_territory(overview(director))), set(by_territory(overview(other)))
    assert mine == set(region_territories(db, "REGION-01")) - {"NATIONAL-01"}
    assert theirs == set(region_territories(db, "REGION-02"))
    assert not mine & theirs
    assert not any(m["territoryIds"][0] in theirs for m in overview(director)["members"])


def test_overview_follows_effective_dated_scope(director, db):
    """A temporary coverage assignment brings a territory in; ending it takes it away again."""
    assert "T02-01" not in by_territory(overview(director))
    (assignment,) = db.execute(
        """INSERT INTO user_scope_assignments(user_id, territory_id, assignment_type, effective_from)
           VALUES ('director-region-01', 'T02-01', 'temporary', now() - interval '1 minute') RETURNING assignment_id"""
    ).fetchone()
    try:
        data = overview(director)
        assert "T02-01" in by_territory(data)
        assert data["kpis"]["distinctCalls"] == kpis(db, [*region_territories(db, "REGION-01"), "T02-01"], FROM, TO)["distinctCalls"]
        assert compare(director, ["T01-01", "T02-01"]).errors == []
        db.execute("UPDATE user_scope_assignments SET effective_to = now() WHERE assignment_id = %s", (assignment,))
        assert "T02-01" not in by_territory(overview(director))
        assert "Forbidden" in compare(director, ["T01-01", "T02-01"]).error_types
    finally:
        db.execute("DELETE FROM user_scope_assignments WHERE assignment_id = %s", (assignment,))


def test_msl_and_executive_cannot_open_the_team_overview():
    for user in ("msl-t01-01", "executive-region-01"):
        res = Persona.sign_in(user).query(OVERVIEW, {"from": FROM, "to": TO})
        assert "Forbidden" in res.error_types, user
        assert res.data is None or res.data.get("directorOverview") is None


def test_comparison_refuses_a_territory_outside_scope_without_confirming_it_exists(director):
    out_of_scope = compare(director, ["T01-01", "T02-01"])
    missing = compare(director, ["T01-01", "T99-99"])
    assert "Forbidden" in out_of_scope.error_types
    assert out_of_scope.error_types == missing.error_types
    assert out_of_scope.errors[0]["message"] == missing.errors[0]["message"]


# --- distinct calls, members, completeness ---------------------------------------------------------


def test_calls_are_distinct_and_call_product_rows_are_separate(director, db):
    k = overview(director)["kpis"]
    assert k["callProductRows"] > k["distinctCalls"], "the seed repeats crm_call_id once per product"
    (rows,) = db.execute(
        "SELECT count(*) FROM call_activity WHERE territory_id = ANY(%s) AND call_dt BETWEEN %s AND %s",
        (region_territories(db, "REGION-01"), FROM, TO),
    ).fetchone()
    assert k["callProductRows"] == rows


def test_distinct_hcps_are_not_additive_across_territories(director, db):
    """An HCP engaged by two territories counts once in the scope total and once in each territory."""
    before = overview(director)
    rows = [
        ("T10-C1", "2026-09-10", "T01-01", "REP-T01-01", "HCP-T10-SHARED", "osimertinib", "field"),
        ("T10-C2", "2026-09-11", "T01-02", "REP-T01-02", "HCP-T10-SHARED", "osimertinib", "field"),
    ]
    with extra_calls(db, rows):
        after = overview(director)
    assert after["kpis"]["distinctEngagedHcps"] == before["kpis"]["distinctEngagedHcps"] + 1
    assert after["kpis"]["distinctCalls"] == before["kpis"]["distinctCalls"] + 2
    a, b = by_territory(before), by_territory(after)
    assert b["T01-01"]["distinctEngagedHcps"] == a["T01-01"]["distinctEngagedHcps"] + 1
    assert b["T01-02"]["distinctEngagedHcps"] == a["T01-02"]["distinctEngagedHcps"] + 1


def test_activity_by_member_and_reporting_completeness(director, db):
    data = overview(director)
    months = [m["month"] for m in data["months"]]
    assert months == ["2026-08-01", "2026-09-01", "2026-10-01"]
    for member in data["members"]:
        (truth,) = db.execute(
            "SELECT count(DISTINCT crm_call_id) FROM call_activity WHERE crm_call_user_id = %s AND call_dt BETWEEN %s AND %s",
            (member["memberId"], FROM, TO),
        ).fetchone()
        assert member["distinctCalls"] == truth
        assert [m["month"] for m in member["months"]] == months
        assert member["expectedMonths"] == 3


def test_a_month_without_recorded_calls_lowers_completeness_and_is_not_hidden(director, db):
    """Remove one member's October calls: that member reports 2 of 3 months, the territory pools to match."""
    before = by_territory(overview(director))["T01-03"]
    assert before["reportingCompleteness"] == 1.0
    ids = [
        r[0]
        for r in db.execute(
            "SELECT source_row_id FROM call_activity WHERE territory_id = 'T01-03' AND call_dt BETWEEN '2026-10-01' AND '2026-10-31'"
        ).fetchall()
    ]
    db.execute("UPDATE call_activity SET call_dt = call_dt - interval '1 month' WHERE source_row_id = ANY(%s)", (ids,))
    try:
        data = overview(director)
        row = by_territory(data)["T01-03"]
        assert row["reportingCompleteness"] == pytest.approx(2 / 3, abs=1e-3)
        member = next(m for m in data["members"] if m["territoryIds"] == ["T01-03"])
        assert (member["activeMonths"], member["expectedMonths"]) == (2, 3)
        assert [m["distinctCalls"] for m in member["months"]][2] == 0
    finally:
        db.execute("UPDATE call_activity SET call_dt = call_dt + interval '1 month' WHERE source_row_id = ANY(%s)", (ids,))
    assert by_territory(overview(director))["T01-03"]["reportingCompleteness"] == 1.0


def test_calls_without_a_team_member_are_disclosed_not_dropped(director, db):
    before = overview(director)
    with extra_calls(db, [("T10-U1", "2026-09-20", "T01-01", None, "HCP-T10-U", "osimertinib", "field")]):
        after = overview(director)
    assert after["kpis"]["unattributedCalls"] == before["kpis"]["unattributedCalls"] + 1
    assert after["kpis"]["distinctCalls"] == before["kpis"]["distinctCalls"] + 1
    assert any(n["code"] == "UNATTRIBUTED_CALLS" for n in after["notes"])


# --- mix -------------------------------------------------------------------------------------------


def test_multi_product_counts_are_labelled_apart_from_distinct_calls(director, db):
    data = overview(director)
    mix = {m["dimension"]: m for m in data["mix"]}
    assert set(mix) == {"CHANNEL", "TOPIC", "DISEASE_STATE", "PRODUCT"}
    product = mix["PRODUCT"]
    assert product["totalDistinctCalls"] == data["kpis"]["distinctCalls"]
    assert product["valueTotal"] > product["totalDistinctCalls"] and product["valuesOverlap"]
    assert product["label"].lower().startswith("product (mentions")
    truth = db.execute(
        """SELECT prd_nm, count(DISTINCT crm_call_id) FROM call_activity
           WHERE territory_id = ANY(%s) AND call_dt BETWEEN %s AND %s GROUP BY 1""",
        (region_territories(db, "REGION-01"), FROM, TO),
    ).fetchall()
    assert {v["value"]: v["distinctCalls"] for v in product["values"]} == dict(truth)
    assert sum(v["distinctCalls"] for v in product["values"]) == product["valueTotal"]
    assert mix["CHANNEL"]["valuesOverlap"] is False
    for value in product["values"]:
        assert len(value["months"]) == 3


def test_a_call_in_two_channels_counts_once_in_each_and_once_overall(director, db):
    before = {m["dimension"]: m for m in overview(director)["mix"]}["CHANNEL"]
    rows = [
        ("T10-X", "2026-09-15", "T01-01", "REP-T01-01", "HCP-T10-X", "osimertinib", "virtual"),
        ("T10-X", "2026-09-15", "T01-01", "REP-T01-01", "HCP-T10-X", "osimertinib", "in_person"),
    ]
    with extra_calls(db, rows):
        after = {m["dimension"]: m for m in overview(director)["mix"]}["CHANNEL"]
    assert after["totalDistinctCalls"] == before["totalDistinctCalls"] + 1
    assert after["valueTotal"] == before["valueTotal"] + 2 and after["valuesOverlap"]
    counts = {v["value"]: v["distinctCalls"] for v in after["values"]}
    assert counts["virtual"] == 1 and counts["in_person"] == 1


# --- coverage only with an authoritative target population ----------------------------------------


def test_coverage_is_hidden_when_there_is_no_target_population(director):
    data = overview(director)
    assert data["coverage"] == {
        "status": "NO_TARGET_POPULATION",
        "targetHcps": None,
        "engagedTargetHcps": None,
        "percentage": None,
        "territoriesWithTargets": 0,
        "territoriesInScope": 6,
        "asOf": TO,
    }
    for row in data["territories"]:
        assert row["coverage"] == {"status": "NO_TARGET_POPULATION", "targetHcps": None, "engagedTargetHcps": None, "percentage": None}
        assert row["distinctEngagedHcps"] > 0, "engaged counts stay visible without a target"


def test_draft_expired_and_future_targets_do_not_make_coverage_appear(director, db):
    rows = [
        ("HCP-T10-D", "T01-01", "draft", "-30 days", None),
        ("HCP-T10-E", "T01-01", "approved", "-90 days", "-60 days"),
        ("HCP-T10-F", "T01-01", "approved", "+10 days", None),
    ]
    with targets(db, rows):
        data = overview(director)
    assert data["coverage"]["status"] == "NO_TARGET_POPULATION" and data["coverage"]["percentage"] is None


def test_coverage_is_engaged_targets_over_the_approved_population(director, db):
    # Window ends 2026-10-31: two of three approved targets of T01-01 are engaged in it, and one is not.
    rows = [
        ("HCP-T10-A", "T01-01", "approved", "-30 days", None),
        ("HCP-T10-B", "T01-01", "approved", "-30 days", None),
        ("HCP-T10-C", "T01-01", "approved", "-30 days", None),
        ("HCP-T10-IGN", "T01-01", "draft", "-30 days", None),
    ]
    calls = [
        ("T10-T1", "2026-09-01", "T01-01", "REP-T01-01", "HCP-T10-A", "osimertinib", "field"),
        ("T10-T2", "2026-10-01", "T01-01", "REP-T01-01", "HCP-T10-B", "osimertinib", "field"),
        ("T10-T3", "2026-11-02", "T01-01", "REP-T01-01", "HCP-T10-C", "osimertinib", "field"),  # after the window
        ("T10-T4", "2026-09-02", "T01-02", "REP-T01-02", "HCP-T10-C", "osimertinib", "field"),  # not their territory
    ]
    with extra_calls(db, calls), targets(db, rows):
        data = overview(director)
        row = by_territory(data)["T01-01"]
        assert row["coverage"] == {"status": "AVAILABLE", "targetHcps": 3, "engagedTargetHcps": 2, "percentage": 66.7}
        assert by_territory(data)["T01-02"]["coverage"]["status"] == "NO_TARGET_POPULATION"
        assert data["coverage"]["percentage"] == 66.7
        assert (data["coverage"]["territoriesWithTargets"], data["coverage"]["territoriesInScope"]) == (1, 6)
        assert compare(director, ["T01-01", "T01-02"]).data["territoryComparison"]["territories"][0]["coverage"]["percentage"] == 66.7
    assert overview(director)["coverage"]["status"] == "NO_TARGET_POPULATION"


# --- comparisons: identical periods and definitions, disclosed populations --------------------------


def test_comparison_applies_one_period_and_one_set_of_definitions_to_every_territory(director, db):
    res = compare(director, ["T01-01", "T01-02", "T01-03"])
    assert not res.errors, res.errors
    c = res.data["territoryComparison"]
    assert (c["from"], c["to"]) == (FROM, TO)
    assert c["definitionVersion"] == "team-overview-v1"
    assert [t["territoryId"] for t in c["territories"]] == ["T01-01", "T01-02", "T01-03"]
    for t in c["territories"]:
        truth = kpis(db, [t["territoryId"]], FROM, TO)
        assert (t["distinctCalls"], t["distinctEngagedHcps"], t["responseCount"]) == (
            truth["distinctCalls"],
            truth["distinctEngagedHcps"],
            truth["responseCount"],
        )
    # The same territory under the overview's identical window and definitions gives the same numbers.
    row = by_territory(overview(director))["T01-02"]
    cmp_row = next(t for t in c["territories"] if t["territoryId"] == "T01-02")
    assert row["distinctCalls"] == cmp_row["distinctCalls"] and row["responseCount"] == cmp_row["responseCount"]
    assert {d["key"] for d in c["definitions"]} >= {"distinctCalls", "reportingCompleteness", "coverage"}


def test_comparison_has_no_per_territory_period_so_the_window_cannot_differ(director):
    res = director.query(
        "query { territoryComparison(territoryIds: [\"T01-01\", \"T01-02\"], periods: [{from: \"2026-08-01\"}]) { from } }"
    )
    assert res.errors and res.data is None


def test_unequal_populations_are_disclosed(director, db):
    rows = [
        ("T10-P1", "2026-09-03", "T01-01", "REP-T01-99", "HCP-T10-P1", "osimertinib", "field"),
        ("T10-P2", "2026-09-04", "T01-01", "REP-T01-98", "HCP-T10-P2", "osimertinib", "field"),
    ]
    base = compare(director, ["T01-01", "T01-02"]).data["territoryComparison"]
    assert base["populationsUnequal"] is False
    assert {d["code"] for d in base["disclosures"]} >= {"COVERAGE_WITHHELD"}
    with extra_calls(db, rows):
        c = compare(director, ["T01-01", "T01-02"]).data["territoryComparison"]
    assert c["populationsUnequal"] is True
    codes = {d["code"]: d["message"] for d in c["disclosures"]}
    assert "REPORTING_MEMBERS_DIFFER" in codes and "3, 1" in codes["REPORTING_MEMBERS_DIFFER"]
    first, second = c["territories"]
    assert first["reportingMembers"] == 3 and second["reportingMembers"] == 1
    assert first["callsPerReportingMember"] == pytest.approx(first["distinctCalls"] / 3, abs=0.06)


def test_uneven_target_data_is_disclosed_and_coverage_is_not_compared(director, db):
    with targets(db, [("HCP-T10-Q", "T01-01", "approved", "-30 days", None)]):
        c = compare(director, ["T01-01", "T01-02"]).data["territoryComparison"]
    assert c["populationsUnequal"] is True
    assert "TARGET_DATA_UNEVEN" in {d["code"] for d in c["disclosures"]}
    statuses = {t["territoryId"]: t["coverage"]["status"] for t in c["territories"]}
    assert statuses == {"T01-01": "AVAILABLE", "T01-02": "NO_TARGET_POPULATION"}


@pytest.mark.parametrize(
    "ids",
    [["T01-01"], [f"T01-0{n}" for n in range(1, 7)] + ["T02-01"], [], ["T01-01", "bad id\n"]],
)
def test_comparison_needs_two_to_six_territories(director, ids):
    assert "BadRequest" in compare(director, ids).error_types


def test_a_window_longer_than_a_year_or_reversed_is_rejected(director):
    assert "BadRequest" in director.query(OVERVIEW, {"from": "2025-01-01", "to": "2026-11-03"}).error_types
    assert "BadRequest" in director.query(OVERVIEW, {"from": "2026-10-01", "to": "2026-09-01"}).error_types


# --- logging -----------------------------------------------------------------------------------------


def test_director_logs_hold_no_names_emails_or_hcp_identity(director, db):
    overview(director)
    compare(director, ["T01-01", "T01-02"])
    logs = be_lambda_logs(since="5m")
    records = [json.loads(m.group(1)) for m in re.finditer(r"\[lambda:a2g-be-[a-z]+[^\]]*\] (\{\"ts\".*)$", logs, re.MULTILINE)]
    assert any(r.get("msg") == "director overview computed" for r in records)
    secrets = [director.id_token, "director.region-01@example.test", "Director REGION-01"]
    secrets += [r[0] for r in db.execute("SELECT DISTINCT cust_full_nm FROM call_activity WHERE territory_id = 'T01-01' LIMIT 10")]
    secrets += [r[0] for r in db.execute("SELECT DISTINCT rep_nm FROM call_activity WHERE rep_nm IS NOT NULL LIMIT 5")]
    for secret in secrets:
        assert secret and secret not in logs, f"sensitive value leaked into BE logs: {secret[:10]}"
