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


def test_timeline_consolidates_calls_and_keeps_followups_in_their_interaction(msl, other_msl, db):
    """The API, rather than the UI, owns source grain and parent-link safety."""
    call_id = "CALL-TIMELINE-TEST"
    interaction_a = "INT-TIMELINE-A"
    interaction_b = "INT-TIMELINE-B"
    interaction_c = "INT-TIMELINE-C"
    source_ids = ("INS-TIMELINE-PARENT-A", "INS-TIMELINE-CHILD-A", "INS-TIMELINE-CHILD-B", "INS-TIMELINE-PARENT-C")
    try:
        # One physical call intentionally has two products; it must be a single API interaction.
        db.execute(
            """
            INSERT INTO call_activity (crm_call_id, call_dt, call_chnl, call_type, call_sta, prd_nm,
              reason_for_visit, derived_disease_state, territory_id, cust_mdm_id)
            VALUES (%s, '2026-11-01', 'in-person', 'scientific', 'completed', 'osimertinib',
              'evidence review', 'non-small cell lung cancer', 'T01-01', 'HCP-0001'),
              (%s, '2026-11-01', 'in-person', 'scientific', 'completed', 'pembrolizumab',
              'evidence review', 'non-small cell lung cancer', 'T01-01', 'HCP-0001')
            """,
            (call_id, call_id),
        )
        db.execute(
            """
            INSERT INTO hcp_raw_insights (insight_intrctn_dtl_sfdc_id, insight_intrctn_rspns_sfdc_id,
              uniq_rspns_id, date_of_interaction, territory_id, cust_mdm_id, qstn_ext_id, qstn_pid,
              qstn_txt, rspns_txt, excluded_rspns_flag)
            VALUES
              (%s, %s, 'RESP-TIMELINE-1', '2026-10-20', 'T01-01', 'LEGACY-HCP-0001', 'Q-TL-P', NULL,
                'What evidence would be most useful?', 'Original answer A', false),
              (%s, %s, 'RESP-TIMELINE-2', '2026-10-20', 'T01-01', 'LEGACY-HCP-0001', 'Q-TL-C', 'Q-TL-P',
                'Which evidence should be discussed first?', 'Follow-up answer A', false),
              (%s, %s, 'RESP-TIMELINE-3', '2026-09-20', 'T01-01', 'LEGACY-HCP-0001', 'Q-TL-C', 'Q-TL-P',
                'Which evidence should be discussed first?', 'Follow-up without a local parent', false),
              (%s, %s, 'RESP-TIMELINE-4', '2026-08-20', 'T01-01', 'LEGACY-HCP-0001', 'Q-TL-P', NULL,
                'What evidence would be most useful?', 'Original answer B', false)
            """,
            (interaction_a, source_ids[0], interaction_a, source_ids[1], interaction_b, source_ids[2], interaction_c, source_ids[3]),
        )

        result = msl.hcp_timeline("HCP-0001")
        assert not result.errors, result.errors
        timeline = result.data["hcpTimeline"]
        call = next(item for item in timeline["interactions"] if item["callId"] == call_id)
        assert call["products"] == ["osimertinib", "pembrolizumab"]
        assert call["channels"] == ["in-person"]
        assert set(call["topics"]) == {"evidence review", "non-small cell lung cancer"}

        responses = {item["sourceRecordId"]: item for item in timeline["responses"]}
        assert responses[source_ids[1]]["parentResponseId"] == responses[source_ids[0]]["responseId"]
        # The same follow-up question in a second interaction does not borrow A's parent.
        assert responses[source_ids[2]]["parentResponseId"] is None
        assert responses[source_ids[1]]["interactionDate"] == "2026-10-20"
        assert responses[source_ids[1]]["answer"] == "Follow-up answer A"

        perspective = next(item for item in timeline["perspectives"] if item["questionId"] == "Q-TL-P")
        assert {item["answer"] for item in perspective["answers"]} >= {"Original answer A", "Original answer B"}
        assert {item["questionId"] for item in perspective["answers"]} == {"Q-TL-P"}

        denied = other_msl.hcp_timeline("HCP-0001")
        assert denied.data is None or denied.data.get("hcpTimeline") is None
        assert "Forbidden" in denied.error_types
    finally:
        db.execute("DELETE FROM hcp_raw_insights WHERE insight_intrctn_dtl_sfdc_id IN (%s, %s, %s)", (interaction_a, interaction_b, interaction_c))
        db.execute("DELETE FROM call_activity WHERE crm_call_id = %s", (call_id,))
