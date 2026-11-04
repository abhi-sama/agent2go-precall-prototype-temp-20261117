"""Record-level access through the API: each persona sees exactly its effective scope."""

from __future__ import annotations

import pytest

from ground_truth import kpis, raw_call_rows, region_territories
from harness import LANDING_KPIS, Persona, graphql

FROM, TO = "2026-01-01", "2026-11-03"


def counts(result) -> dict[str, int]:
    assert not result.errors, result.errors
    k = result.data["landingKpis"]
    return {key: k[key] for key in ("distinctCalls", "distinctEngagedHcps", "responseCount")}


def test_msl_sees_exactly_own_territory(msl, db):
    res = msl.landing_kpis(FROM, TO)
    assert counts(res) == kpis(db, ["T01-01"], FROM, TO)
    k = res.data["landingKpis"]
    assert (k["from"], k["to"], k["scopeLabel"]) == (FROM, TO, "T01-01")
    assert k["dataThrough"], "data-through badge needs the load timestamp"


def test_msl_cannot_read_another_territory(msl, other_msl, db):
    mine = counts(msl.landing_kpis(FROM, TO))
    theirs = counts(other_msl.landing_kpis(FROM, TO))
    assert theirs == kpis(db, ["T02-01"], FROM, TO)
    everything = kpis(db, ["T01-01", "T02-01"], FROM, TO)
    # Neither MSL's numbers include the other territory's records.
    assert mine["distinctCalls"] < everything["distinctCalls"]
    assert mine != theirs


def test_counts_distinct_calls_not_raw_rows(msl, db):
    res = counts(msl.landing_kpis(FROM, TO))
    raw = raw_call_rows(db, ["T01-01"], FROM, TO)
    assert raw > res["distinctCalls"], "seed repeats crm_call_id per product row"
    assert res["distinctCalls"] == kpis(db, ["T01-01"], FROM, TO)["distinctCalls"]


def test_effective_dated_assignment_changes_the_result(msl, db):
    """Granting, then ending, effective-dated assignments changes what the same token sees."""
    before = counts(msl.landing_kpis(FROM, TO))
    (temp_id,) = db.execute(
        """INSERT INTO user_scope_assignments(user_id, territory_id, assignment_type, effective_from)
           VALUES ('msl-t01-01', 'T02-01', 'temporary', now() - interval '1 minute') RETURNING assignment_id"""
    ).fetchone()
    future_id = None
    try:
        # Temporary coverage of T02-01 is now in effect.
        assert counts(msl.landing_kpis(FROM, TO)) == kpis(db, ["T01-01", "T02-01"], FROM, TO)

        # End the primary T01-01 assignment: only the temporary coverage remains.
        db.execute(
            """UPDATE user_scope_assignments SET effective_to = now()
               WHERE user_id = 'msl-t01-01' AND territory_id = 'T01-01' AND effective_to IS NULL"""
        )
        assert counts(msl.landing_kpis(FROM, TO)) == kpis(db, ["T02-01"], FROM, TO)

        # A future-dated assignment grants nothing yet.
        (future_id,) = db.execute(
            """INSERT INTO user_scope_assignments(user_id, territory_id, assignment_type, effective_from)
               VALUES ('msl-t01-01', 'T03-01', 'primary', now() + interval '1 day') RETURNING assignment_id"""
        ).fetchone()
        assert counts(msl.landing_kpis(FROM, TO)) == kpis(db, ["T02-01"], FROM, TO)
    finally:
        db.execute("DELETE FROM user_scope_assignments WHERE assignment_id = ANY(%s)", ([temp_id, future_id],))
        db.execute(
            """UPDATE user_scope_assignments SET effective_to = NULL
               WHERE user_id = 'msl-t01-01' AND territory_id = 'T01-01'"""
        )
    assert counts(msl.landing_kpis(FROM, TO)) == before


def test_director_sees_descendant_territories(db):
    director = Persona.sign_in("director-region-01")
    territories = region_territories(db, "REGION-01")
    assert len(territories) == 6
    res = director.landing_kpis(FROM, TO)
    assert counts(res) == kpis(db, territories, FROM, TO)
    assert res.data["landingKpis"]["scopeLabel"] == "REGION-01 · 6 territories"


def test_executive_has_no_record_level_landing():
    """Executives are aggregate-only; record-level counts are refused, never silently zero."""
    res = Persona.sign_in("executive-region-01").landing_kpis(FROM, TO)
    assert res.data is None or res.data.get("landingKpis") is None
    assert "Forbidden" in res.error_types


def test_unresolved_login_gets_no_data():
    """The seed's unresolved login-to-user mapping must not be joined by email or name."""
    res = Persona.sign_in("admin-region-04").query("query { me { userId } }")
    assert "Forbidden" in res.error_types


@pytest.mark.parametrize("token", [None, "garbage", "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0."])
def test_requests_without_a_valid_token_are_rejected(token):
    res = graphql(LANDING_KPIS, {"from": FROM, "to": TO}, token=token)
    assert res.data is None or res.data.get("landingKpis") is None
    assert res.status == 401 or any("Unauthorized" in t for t in res.error_types)


def test_invalid_range_is_rejected(msl):
    assert "BadRequest" in msl.landing_kpis("2026-11-03", "2026-01-01").error_types


TERRITORY_ACTIVITY = """
query T($from: AWSDate, $to: AWSDate) {
  territoryActivity(from: $from, to: $to) {
    territoryId regionId col row inScope isOwn distinctCalls distinctEngagedHcps responseCount
  }
}
"""


def test_territory_visual_returns_only_scoped_territories(msl, db):
    res = msl.query(TERRITORY_ACTIVITY, {"from": FROM, "to": TO})
    assert not res.errors, res.errors
    (tile,) = res.data["territoryActivity"]
    assert tile["territoryId"] == "T01-01" and tile["isOwn"] and tile["inScope"]
    assert {k: tile[k] for k in ("distinctCalls", "distinctEngagedHcps", "responseCount")} == kpis(db, ["T01-01"], FROM, TO)


def test_director_territory_visual_covers_the_region(db):
    res = Persona.sign_in("director-region-01").query(TERRITORY_ACTIVITY, {"from": FROM, "to": TO})
    tiles = res.data["territoryActivity"]
    assert sorted(t["territoryId"] for t in tiles) == region_territories(db, "REGION-01")
    assert {t["regionId"] for t in tiles} == {"REGION-01"}
    assert sorted(t["col"] for t in tiles) == list(range(6))
    assert not any(t["isOwn"] for t in tiles)
