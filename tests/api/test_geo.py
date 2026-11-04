"""Territory map data through the API, as each persona.

``geoActivity`` serves the globe and the flat map. It must return only the caller's effective
scope (nothing out of scope is named or counted), use distinct calls, work for the
aggregate-only Executive without exposing a call row, and suppress small groups for them.
"""

from __future__ import annotations

import json

from ground_truth import calls_by_country, calls_by_territory, kpis, region_territories
from harness import GEO_ACTIVITY, Persona, graphql

FROM, TO = "2026-01-01", "2026-11-03"
ONE_DAY = "2026-10-20"


def geo(persona: Persona, frm: str = FROM, to: str = TO) -> dict:
    res = persona.geo_activity(frm, to)
    assert not res.errors, res.errors
    return res.data["geoActivity"]


def by_id(items: list[dict], key: str) -> dict[str, dict]:
    return {i[key]: i for i in items}


def test_msl_sees_only_own_territory_on_the_map(msl, db):
    g = geo(msl)
    (t,) = g["territories"]
    assert (t["territoryId"], t["isOwn"], t["countryCode"], t["subdivisionCode"], t["subdivisionName"]) == ("T01-01", True, "US", "MA", "Massachusetts")
    assert t["name"] == "Boston" and t["regionId"] == "REGION-01" and not t["suppressed"]
    assert t["distinctCalls"] == kpis(db, ["T01-01"], FROM, TO)["distinctCalls"]
    (c,) = g["countries"]
    assert (c["countryCode"], c["territoryCount"], c["distinctCalls"]) == ("US", 1, t["distinctCalls"])
    assert (g["from"], g["to"], g["scopeLabel"]) == (FROM, TO, "T01-01")
    assert g["dataThrough"]


def test_out_of_scope_territories_are_not_in_the_response_at_all(msl, other_msl):
    """Not hidden client-side: the API never sends another territory's id, name, state or count."""
    mine = json.dumps(geo(msl))
    theirs = geo(other_msl)["territories"][0]
    assert theirs["territoryId"] == "T02-01"
    for leaked in (theirs["territoryId"], theirs["name"], theirs["subdivisionName"], "T01-06", "Toronto", "REGION-02"):
        assert leaked not in mine, leaked


def test_director_gets_every_region_territory_and_country(db):
    director = Persona.sign_in("director-region-01")
    g = geo(director)
    ids = region_territories(db, "REGION-01")
    assert sorted(t["territoryId"] for t in g["territories"]) == ids
    expected = calls_by_territory(db, ids, FROM, TO)
    assert {t["territoryId"]: t["distinctCalls"] for t in g["territories"]} == expected
    assert not any(t["isOwn"] for t in g["territories"])
    # REGION-01 spans five US states and one Canadian province.
    countries = by_id(g["countries"], "countryCode")
    assert sorted(countries) == ["CA", "US"]
    assert (countries["US"]["territoryCount"], countries["CA"]["territoryCount"]) == (5, 1)
    assert {code: c["distinctCalls"] for code, c in countries.items()} == calls_by_country(db, ids, FROM, TO)
    assert g["scopeLabel"] == "REGION-01 · 6 territories"


def test_country_counts_are_distinct_calls_not_a_sum_of_rows(db):
    director = Persona.sign_in("director-region-03")
    g = geo(director)
    ids = region_territories(db, "REGION-03")
    countries = by_id(g["countries"], "countryCode")
    assert sorted(countries) == ["DE", "FR", "US"]
    raw_rows = db.execute(
        "SELECT count(*) FROM call_activity WHERE territory_id = ANY(%s) AND call_dt BETWEEN %s AND %s", (ids, FROM, TO)
    ).fetchone()[0]
    total = sum(c["distinctCalls"] for c in countries.values())
    assert total == kpis(db, ids, FROM, TO)["distinctCalls"]
    assert raw_rows > total, "the seed repeats crm_call_id once per product row"


def test_executive_gets_the_map_without_record_access(db):
    """Aggregate-only: record-level KPIs stay refused, but the map is served as counts."""
    executive = Persona.sign_in("executive-region-02")
    assert "Forbidden" in executive.landing_kpis(FROM, TO).error_types
    g = geo(executive)
    ids = region_territories(db, "REGION-02")
    assert sorted(t["territoryId"] for t in g["territories"]) == ids
    assert {t["territoryId"]: t["distinctCalls"] for t in g["territories"]} == calls_by_territory(db, ids, FROM, TO)
    assert sorted(c["countryCode"] for c in g["countries"]) == ["GB", "US"]
    assert g["scopeLabel"] == "REGION-02 · 6 territories"
    assert g["dataThrough"], "aggregate-only callers still get the data-through badge"
    assert not any(t["isOwn"] for t in g["territories"])


def test_aggregate_only_small_groups_are_suppressed_but_record_personas_see_them(db):
    executive = geo(Persona.sign_in("executive-region-01"), ONE_DAY, ONE_DAY)
    expected = calls_by_territory(db, region_territories(db, "REGION-01"), ONE_DAY, ONE_DAY)
    assert max(expected.values()) < 5, "fixture assumption: one day is a small group"
    assert all(t["suppressed"] and t["distinctCalls"] is None for t in executive["territories"])
    assert all(c["suppressed"] and c["distinctCalls"] is None for c in executive["countries"])
    # The Director may read the underlying rows, so small numbers are not hidden from them.
    director = geo(Persona.sign_in("director-region-01"), ONE_DAY, ONE_DAY)
    assert {t["territoryId"]: t["distinctCalls"] for t in director["territories"]} == expected
    assert not any(t["suppressed"] for t in director["territories"])


def test_executive_scope_is_their_assignment_not_everything():
    g = geo(Persona.sign_in("executive-region-04"))
    assert {t["regionId"] for t in g["territories"]} == {"REGION-04"}
    assert sorted(c["countryCode"] for c in g["countries"]) == ["BR", "JP", "US"]


def test_effective_dated_assignment_changes_the_map(msl, db):
    before = [t["territoryId"] for t in geo(msl)["territories"]]
    (temp_id,) = db.execute(
        """INSERT INTO user_scope_assignments(user_id, territory_id, assignment_type, effective_from)
           VALUES ('msl-t01-01', 'T01-06', 'temporary', now() - interval '1 minute') RETURNING assignment_id"""
    ).fetchone()
    try:
        g = geo(msl)
        assert sorted(t["territoryId"] for t in g["territories"]) == ["T01-01", "T01-06"]
        assert sorted(c["countryCode"] for c in g["countries"]) == ["CA", "US"]
        assert by_id(g["territories"], "territoryId")["T01-06"]["isOwn"]
    finally:
        db.execute("DELETE FROM user_scope_assignments WHERE assignment_id = %s", (temp_id,))
    assert [t["territoryId"] for t in geo(msl)["territories"]] == before


def test_invalid_range_and_missing_token_are_rejected(msl):
    assert "BadRequest" in msl.geo_activity("2026-11-03", "2026-01-01").error_types
    res = graphql(GEO_ACTIVITY, {"from": FROM, "to": TO}, token=None)
    assert res.data is None or res.data.get("geoActivity") is None
    assert res.status == 401 or any("Unauthorized" in t for t in res.error_types)


def test_unresolved_login_gets_no_map():
    res = Persona.sign_in("admin-region-04").geo_activity(FROM, TO)
    assert "Forbidden" in res.error_types
