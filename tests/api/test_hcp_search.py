"""Authorized HCP discovery and profile facts, exercised through AppSync as personas."""

from __future__ import annotations


def ids(result) -> list[str]:
    assert not result.errors, result.errors
    return [row["hcpId"] for row in result.data["searchHcps"]]


def test_search_returns_only_hcps_in_the_callers_scope(msl, other_msl, db):
    # HCP-0001 belongs to the first MSL's territory. Another MSL receives no result
    # even when it knows the exact source display name.
    mine = msl.search_hcps("Call system HCP 0001")
    assert ids(mine) == ["HCP-0001"]
    assert ids(other_msl.search_hcps("Call system HCP 0001")) == []

    # Institution and territory terms work as well. The API result set is a subset of
    # the RLS-approved crosswalk ids, never a name-based list from another territory.
    by_institution = ids(msl.search_hcps("Synthetic Cancer Center", limit=50))
    expected = {
        row[0]
        for row in db.execute(
            """
            SELECT DISTINCT x.hcp_id
            FROM hcp_identifier_crosswalk x
            JOIN hcp_raw_insights i
              ON x.source_system = 'hcp_raw_insights.cust_mdm_id'
             AND x.source_identifier = i.cust_mdm_id
            WHERE i.territory_id = 'T01-01' AND i.hcp_institution = 'Synthetic Cancer Center'
            """
        )
    }
    assert set(by_institution) <= expected
    assert by_institution
    assert ids(msl.search_hcps("T01-01 Oncology", limit=50))


def test_profile_uses_canonical_crosswalk_and_marks_missing_facts(msl, other_msl, db):
    # This seeded HCP has a call-system ID and a different legacy insight-system ID;
    # the profile gets its specialty only through hcp_identifier_crosswalk.
    assert db.execute(
        "SELECT count(*) FROM hcp_raw_insights WHERE cust_mdm_id = 'LEGACY-HCP-0001'"
    ).fetchone()[0] > 0

    result = msl.hcp_profile("HCP-0001")
    assert not result.errors, result.errors
    profile = result.data["hcpProfile"]
    assert profile["hcpId"] == "HCP-0001"
    assert profile["specialty"] == {"value": "medical oncology", "state": "PRESENT"}
    assert profile["credentials"] == {"value": None, "state": "MISSING"}

    # A canonical ID is not an authorization token: the same profile is forbidden
    # for a persona without a scoped source row.
    denied = other_msl.hcp_profile("HCP-0001")
    assert denied.data is None or denied.data.get("hcpProfile") is None
    assert "Forbidden" in denied.error_types
