"""Administrator hierarchy governance through the public AppSync API seam (ticket 15, #16).

Acceptance criteria proven here, each as a seeded persona calling AppSync:

* cycles and orphan territories are detected;
* temporary coverage expires on its end date;
* seeing a catalog question never grants seeing its responses.

The owner database connection only arranges damaged hierarchy data and cleans up afterwards.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest

from ground_truth import kpis
from harness import Persona

HIERARCHY = """
query Hierarchy {
  adminHierarchy {
    generatedAt errorCount warningCount
    findings { code severity territoryIds message }
    edges { childId parentId source }
    nodes {
      territoryId name kind parentIds childIds depth findingCodes
      directHolders { userId assignmentType viaTerritoryId }
      inheritedHolders { userId assignmentType viaTerritoryId }
    }
  }
}
"""

TIMELINE = """
query Timeline($userId: ID) {
  adminAccessTimeline(userId: $userId) {
    entries { assignmentId userId territoryId assignmentType effectiveFrom effectiveTo approvedBy requestId status secondsRemaining }
    requests { requestId kind userId fromTerritoryId toTerritoryId effectiveFrom effectiveTo reason status requestedBy decidedBy decidedAt decisionNote }
    overlaps { kind userId territoryId assignmentIds message }
  }
}
"""

REQUEST = """
mutation Request($input: ScopeChangeInput!) {
  requestScopeChange(input: $input) { requestId kind status userId toTerritoryId requestedBy decidedBy }
}
"""

DECIDE = """
mutation Decide($input: ScopeChangeDecisionInput!) {
  decideScopeChange(input: $input) { requestId status requestedBy decidedBy decisionNote }
}
"""

CREATE_SCOPE = """
mutation CreateScope($input: ScopeAssignmentInput!) {
  createScopeAssignment(input: $input) { assignmentId }
}
"""

AUDIT = """
query Audit($filter: AccessAuditFilter) {
  accessAudit(filter: $filter) { eventId actorUserId action resourceType resourceId outcome }
}
"""

VISIBILITY = """
query Visibility {
  adminVisibility {
    catalogMatrix { roleId catalogVisible }
    responseMatrix { roleId level }
  }
}
"""

SET_CATALOG = """
mutation SetCatalog($input: CatalogVisibilityInput!) {
  setCatalogVisibility(input: $input) { roleId catalogVisible }
}
"""

SET_RESPONSES = """
mutation SetResponses($input: ResponseAccessInput!) {
  setResponseAccess(input: $input) { roleId level }
}
"""

CATALOG = """
query Catalog($limit: Int) { catalogQuestions(limit: $limit) { questionId text status molecule tumorType study survey } }
"""

RESPONSES = """
query Responses($questionId: ID!, $limit: Int) {
  questionResponses(questionId: $questionId, limit: $limit) { questionId total responses { responseId territoryId interactionDate text } }
}
"""

FROM, TO = "2026-01-01", "2026-11-03"


@pytest.fixture(scope="module")
def admin() -> Persona:
    return Persona.sign_in("admin-region-01")


@pytest.fixture(scope="module")
def second_admin() -> Persona:
    return Persona.sign_in("admin-region-02")


@pytest.fixture(scope="module")
def executive() -> Persona:
    return Persona.sign_in("executive-region-01")


def now() -> datetime:
    return datetime.now(timezone.utc)


def ok(result):
    assert not result.errors, result.errors
    return result.data


def findings(admin: Persona, code: str) -> list[dict]:
    return [f for f in ok(admin.query(HIERARCHY))["adminHierarchy"]["findings"] if f["code"] == code]


@contextmanager
def damaged_hierarchy(db, *, relationships=(), rd_access=(), unplaced=()):
    """Insert damaged hierarchy rows as the owner, and always remove exactly those rows."""
    rel_ids: list[int] = []
    rd_ids: list[int] = []
    try:
        for child, parent in relationships:
            row = db.execute(
                "INSERT INTO territory_scope_relationships(child_territory_id, parent_territory_id, effective_from) "
                "VALUES (%s, %s, '2024-01-01') RETURNING relationship_id",
                (child, parent),
            ).fetchone()
            rel_ids.append(row[0])
        for child, parent in rd_access:
            row = db.execute(
                "INSERT INTO territory_rd_access(child_territory_id, child_territory_name, parent_territory_id) VALUES (%s, %s, %s) RETURNING source_row_id",
                (child, child + " test", parent),
            ).fetchone()
            rd_ids.append(row[0])
        for territory in unplaced:
            # A roster row for a territory that nothing in the hierarchy mentions.
            db.execute(
                "INSERT INTO medical_roster(first_name, last_name, full_name, territory_id, territory_name, source_name, dbt_scd_id) "
                "VALUES ('Test', 'Orphan', 'Test Orphan', %s, %s, 'test-t15', %s)",
                (territory, territory, "t15-" + territory),
            )
        yield
    finally:
        db.execute("DELETE FROM territory_scope_relationships WHERE relationship_id = ANY(%s)", (rel_ids,))
        db.execute("DELETE FROM territory_rd_access WHERE source_row_id = ANY(%s)", (rd_ids,))
        db.execute("DELETE FROM medical_roster WHERE source_name = 'test-t15'")


def forget_requests(db, request_ids: list[str], assignment_ids: list[str] = (), restore_end_for: dict[str, None] | None = None):
    """Remove everything a test created: assignments, requests and their audit rows."""
    ids = [int(r) for r in request_ids]
    db.execute("DELETE FROM user_scope_assignments WHERE request_id = ANY(%s) OR assignment_id = ANY(%s)", (ids, [int(a) for a in assignment_ids]))
    db.execute("DELETE FROM scope_change_requests WHERE request_id = ANY(%s)", (ids,))
    labels = [str(r) for r in request_ids] + [str(a) for a in assignment_ids]
    db.execute("DELETE FROM audit_events WHERE resource_id = ANY(%s) AND resource_type IN ('scope_change_request', 'user_scope_assignment')", (labels,))


# ---------------------------------------------------------------- hierarchy validation


def test_seeded_hierarchy_reports_its_known_defects_and_inheritance(admin):
    graph = ok(admin.query(HIERARCHY))["adminHierarchy"]
    by_code = {(f["code"], tuple(f["territoryIds"])): f for f in graph["findings"]}

    # The seed plants an assignment to a territory that is nowhere in the hierarchy ...
    orphan = by_code[("ORPHAN_TERRITORY", ("UNRESOLVED-01",))]
    assert orphan["severity"] == "ERROR"
    # ... and one territory under two parents, which is legal and so only a warning.
    overlap = by_code[("OVERLAP", ("T01-01", "NATIONAL-01", "REGION-01"))]
    assert overlap["severity"] == "WARNING"
    assert graph["errorCount"] >= 1 and graph["warningCount"] >= 1
    assert not [f for f in graph["findings"] if f["code"] == "CYCLE"]

    nodes = {n["territoryId"]: n for n in graph["nodes"]}
    assert nodes["T01-01"]["parentIds"] == ["NATIONAL-01", "REGION-01"]
    assert nodes["REGION-01"]["kind"] == "REGION" and nodes["T01-02"]["kind"] == "TERRITORY"
    assert nodes["REGION-01"]["depth"] == 0 and nodes["T01-02"]["depth"] == 1
    # Inheritance: whoever holds the region holds its territories, "via" naming where it came from.
    inherited = {(h["userId"], h["viaTerritoryId"]) for h in nodes["T01-02"]["inheritedHolders"]}
    assert ("director-region-01", "REGION-01") in inherited
    assert ("admin-region-01", "REGION-01") in inherited
    assert [h["userId"] for h in nodes["T01-02"]["directHolders"]] == ["msl-t01-02"]
    assert nodes["UNRESOLVED-01"]["parentIds"] == [] and nodes["UNRESOLVED-01"]["depth"] is None


def test_cycles_and_orphan_territories_are_detected(admin, db, msl):
    before = ok(admin.query(HIERARCHY))["adminHierarchy"]
    assert not [f for f in before["findings"] if f["code"] == "CYCLE"]

    with damaged_hierarchy(
        db,
        # REGION-02 becoming a child of its own territory: REGION-02 -> T02-01 -> REGION-02.
        relationships=[("REGION-02", "T02-01"), ("CYC-A", "CYC-B"), ("CYC-B", "CYC-C"), ("CYC-C", "CYC-A")],
        rd_access=[("MISSING-LINK-01", "REGION-03")],
        unplaced=["ORPHAN-OAKLAND"],
    ):
        graph = ok(admin.query(HIERARCHY))["adminHierarchy"]
        cycles = [f for f in graph["findings"] if f["code"] == "CYCLE"]
        assert {tuple(f["territoryIds"]) for f in cycles} == {("CYC-A", "CYC-B", "CYC-C"), ("REGION-02", "T02-01")}
        assert all(f["severity"] == "ERROR" for f in cycles)
        triple = next(f for f in cycles if len(f["territoryIds"]) == 3)
        assert "CYC-A → CYC-B → CYC-C → CYC-A" in triple["message"]

        orphans = {tuple(f["territoryIds"]) for f in graph["findings"] if f["code"] == "ORPHAN_TERRITORY"}
        assert ("ORPHAN-OAKLAND",) in orphans and ("UNRESOLVED-01",) in orphans

        missing = [f for f in graph["findings"] if f["code"] == "MISSING_LINK" and f["severity"] == "ERROR"]
        assert [f["territoryIds"] for f in missing] == [["MISSING-LINK-01", "REGION-03"]]

        nodes = {n["territoryId"]: n for n in graph["nodes"]}
        assert "CYCLE" in nodes["REGION-02"]["findingCodes"] and "CYCLE" in nodes["T02-01"]["findingCodes"]
        assert nodes["CYC-A"]["depth"] is None
        assert graph["errorCount"] == before["errorCount"] + 4  # two cycles, one orphan, one missing link

        # Access still resolves (inheritance is cycle-safe) while the admin sees the problem.
        assert not msl.landing_kpis(FROM, TO).errors

    after = ok(admin.query(HIERARCHY))["adminHierarchy"]
    assert after["errorCount"] == before["errorCount"]
    assert not [f for f in after["findings"] if f["code"] == "CYCLE"]
    assert "ORPHAN-OAKLAND" not in {n["territoryId"] for n in after["nodes"]}


# ---------------------------------------------------------------- temporary coverage and transfers


def test_temporary_coverage_expires_on_its_end_date(admin, second_admin, msl, db):
    request_ids: list[str] = []
    try:
        start = now() - timedelta(minutes=1)
        end = now() + timedelta(seconds=14)
        created = ok(admin.query(REQUEST, {"input": {
            "kind": "TEMPORARY_COVERAGE", "userId": "msl-t01-01", "toTerritoryId": "T02-01",
            "effectiveFrom": start.isoformat(), "effectiveTo": end.isoformat(), "reason": "Cover leave",
        }}))["requestScopeChange"]
        request_ids.append(created["requestId"])
        assert created["status"] == "PENDING" and created["requestedBy"] == "admin-region-01"

        # Asking changes nothing: the MSL is still limited to their own territory.
        own_only = kpis(db, ["T01-01"], FROM, TO)["distinctCalls"]
        both = kpis(db, ["T01-01", "T02-01"], FROM, TO)["distinctCalls"]
        assert own_only != both
        assert msl.landing_kpis(FROM, TO).data["landingKpis"]["distinctCalls"] == own_only

        decided = ok(second_admin.query(DECIDE, {"input": {"requestId": created["requestId"], "decision": "APPROVE", "note": "Approved for leave cover"}}))["decideScopeChange"]
        assert decided["status"] == "APPROVED" and decided["decidedBy"] == "admin-region-02"

        # Active until the end date ...
        assert msl.landing_kpis(FROM, TO).data["landingKpis"]["distinctCalls"] == both
        timeline = ok(admin.query(TIMELINE, {"userId": "msl-t01-01"}))["adminAccessTimeline"]
        coverage = next(e for e in timeline["entries"] if e["requestId"] == created["requestId"])
        assert coverage["status"] == "ACTIVE" and coverage["assignmentType"] == "temporary"
        assert coverage["approvedBy"] == "admin-region-02" and 0 < coverage["secondsRemaining"] <= 14

        # ... and gone the moment it passes, with no job having run in between.
        time.sleep(max(0.0, (end - now()).total_seconds()) + 1.5)
        assert msl.landing_kpis(FROM, TO).data["landingKpis"]["distinctCalls"] == own_only
        timeline = ok(admin.query(TIMELINE, {"userId": "msl-t01-01"}))["adminAccessTimeline"]
        coverage = next(e for e in timeline["entries"] if e["requestId"] == created["requestId"])
        assert coverage["status"] == "EXPIRED" and coverage["secondsRemaining"] is None
        assert next(e for e in timeline["entries"] if e["territoryId"] == "T01-01")["status"] == "ACTIVE"
    finally:
        forget_requests(db, request_ids)


def test_expired_or_open_ended_coverage_cannot_be_requested(admin):
    past = now() - timedelta(hours=2)
    base = {"kind": "TEMPORARY_COVERAGE", "userId": "msl-t01-01", "toTerritoryId": "T02-01", "reason": "x"}
    already_over = admin.query(REQUEST, {"input": {**base, "effectiveFrom": past.isoformat(), "effectiveTo": (past + timedelta(hours=1)).isoformat()}})
    assert "BadRequest" in already_over.error_types
    no_end = admin.query(REQUEST, {"input": {**base, "effectiveFrom": now().isoformat()}})
    assert "BadRequest" in no_end.error_types
    transfer_without_origin = admin.query(REQUEST, {"input": {**base, "kind": "TRANSFER", "effectiveFrom": now().isoformat()}})
    assert "BadRequest" in transfer_without_origin.error_types
    unknown_territory = admin.query(REQUEST, {"input": {**base, "toTerritoryId": "NOWHERE-99", "effectiveFrom": now().isoformat(), "effectiveTo": (now() + timedelta(days=1)).isoformat()}})
    assert "BadRequest" in unknown_territory.error_types


def test_transfer_needs_a_second_administrator_and_is_effective_dated(admin, second_admin, msl, db):
    request_ids: list[str] = []
    moved = "msl-t01-03"
    try:
        # A transfer dated tomorrow: the old assignment keeps working until then.
        tomorrow = now() + timedelta(days=1)
        created = ok(admin.query(REQUEST, {"input": {
            "kind": "TRANSFER", "userId": moved, "fromTerritoryId": "T01-03", "toTerritoryId": "T02-03",
            "effectiveFrom": tomorrow.isoformat(), "reason": "Territory realignment",
        }}))["requestScopeChange"]
        request_ids.append(created["requestId"])

        # Four eyes: the requester cannot decide their own request, and an MSL cannot decide anything.
        assert "Forbidden" in admin.query(DECIDE, {"input": {"requestId": created["requestId"], "decision": "APPROVE"}}).error_types
        assert "Forbidden" in msl.query(DECIDE, {"input": {"requestId": created["requestId"], "decision": "APPROVE"}}).error_types
        assert "Forbidden" in msl.query(REQUEST, {"input": {"kind": "TRANSFER", "userId": moved, "fromTerritoryId": "T01-03", "toTerritoryId": "T02-03", "effectiveFrom": tomorrow.isoformat(), "reason": "x"}}).error_types
        still_pending = ok(admin.query(TIMELINE, {"userId": moved}))["adminAccessTimeline"]
        assert [e["territoryId"] for e in still_pending["entries"]] == ["T01-03"]  # nothing written yet

        ok(second_admin.query(DECIDE, {"input": {"requestId": created["requestId"], "decision": "APPROVE", "note": "Confirmed with the director"}}))
        # Deciding twice is refused.
        assert "BadRequest" in second_admin.query(DECIDE, {"input": {"requestId": created["requestId"], "decision": "REJECT"}}).error_types

        timeline = ok(admin.query(TIMELINE, {"userId": moved}))["adminAccessTimeline"]
        entries = {e["territoryId"]: e for e in timeline["entries"]}
        assert entries["T01-03"]["status"] == "ACTIVE" and entries["T01-03"]["effectiveTo"] is not None  # ends tomorrow
        assert entries["T02-03"]["status"] == "SCHEDULED" and entries["T02-03"]["assignmentType"] == "primary"
        assert entries["T02-03"]["effectiveFrom"] == entries["T01-03"]["effectiveTo"]
        assert entries["T02-03"]["requestId"] == created["requestId"]
        assert timeline["overlaps"] == []  # back to back, never both at once

        trail = next(r for r in timeline["requests"] if r["requestId"] == created["requestId"])
        assert (trail["status"], trail["requestedBy"], trail["decidedBy"]) == ("APPROVED", "admin-region-01", "admin-region-02")
        assert trail["reason"] == "Territory realignment" and trail["decisionNote"] == "Confirmed with the director"

        audit = ok(admin.query(AUDIT, {"filter": {"resourceType": "scope_change_request"}}))["accessAudit"]
        actions = {(e["action"], e["actorUserId"]) for e in audit if e["resourceId"] == created["requestId"]}
        assert actions == {("scope_change.requested", "admin-region-01"), ("scope_change.approved", "admin-region-02")}
    finally:
        forget_requests(db, request_ids)
        db.execute("UPDATE user_scope_assignments SET effective_to = NULL WHERE user_id = %s AND territory_id = 'T01-03'", (moved,))


def test_an_immediate_transfer_moves_access_and_a_rejection_grants_nothing(admin, second_admin, db):
    mover = Persona.sign_in("msl-t01-04")
    request_ids: list[str] = []
    try:
        rejected = ok(admin.query(REQUEST, {"input": {
            "kind": "TRANSFER", "userId": "msl-t01-04", "fromTerritoryId": "T01-04", "toTerritoryId": "T02-04",
            "effectiveFrom": now().isoformat(), "reason": "Proposed move",
        }}))["requestScopeChange"]
        request_ids.append(rejected["requestId"])
        done = ok(second_admin.query(DECIDE, {"input": {"requestId": rejected["requestId"], "decision": "REJECT", "note": "Not now"}}))["decideScopeChange"]
        assert done["status"] == "REJECTED"
        assert mover.landing_kpis(FROM, TO).data["landingKpis"]["distinctCalls"] == kpis(db, ["T01-04"], FROM, TO)["distinctCalls"]

        approved = ok(admin.query(REQUEST, {"input": {
            "kind": "TRANSFER", "userId": "msl-t01-04", "fromTerritoryId": "T01-04", "toTerritoryId": "T02-04",
            "effectiveFrom": now().isoformat(), "reason": "Realignment",
        }}))["requestScopeChange"]
        request_ids.append(approved["requestId"])
        ok(second_admin.query(DECIDE, {"input": {"requestId": approved["requestId"], "decision": "APPROVE"}}))
        # Access moved with the transfer: the new territory only, not both.
        assert mover.landing_kpis(FROM, TO).data["landingKpis"]["distinctCalls"] == kpis(db, ["T02-04"], FROM, TO)["distinctCalls"]
    finally:
        forget_requests(db, request_ids)
        db.execute("UPDATE user_scope_assignments SET effective_to = NULL WHERE user_id = 'msl-t01-04' AND territory_id = 'T01-04'")


def test_overlapping_assignments_are_flagged_on_the_timeline(admin, db):
    assignment_ids: list[str] = []
    try:
        # A temporary grant on a territory the user already holds, and a second primary holder.
        for payload in (
            {"userId": "msl-t01-05", "territoryId": "T01-05", "assignmentType": "temporary", "effectiveFrom": (now() - timedelta(hours=1)).isoformat(), "effectiveTo": (now() + timedelta(hours=1)).isoformat()},
            {"userId": "msl-t01-06", "territoryId": "T01-05", "assignmentType": "primary", "effectiveFrom": (now() - timedelta(hours=1)).isoformat()},
        ):
            assignment_ids.append(ok(admin.query(CREATE_SCOPE, {"input": payload}))["createScopeAssignment"]["assignmentId"])
        overlaps = ok(admin.query(TIMELINE))["adminAccessTimeline"]["overlaps"]
        kinds = {(o["kind"], o["territoryId"]) for o in overlaps if o["territoryId"] == "T01-05"}
        assert kinds == {("SAME_USER_DUPLICATE", "T01-05"), ("SHARED_PRIMARY", "T01-05")}
        shared = next(o for o in overlaps if o["kind"] == "SHARED_PRIMARY")
        assert assignment_ids[1] in shared["assignmentIds"]
    finally:
        forget_requests(db, [], assignment_ids)
    assert not [o for o in ok(admin.query(TIMELINE))["adminAccessTimeline"]["overlaps"] if o["territoryId"] == "T01-05"]


# ---------------------------------------------------------------- catalog vs response visibility


def role_state(admin: Persona, role: str) -> tuple[bool, str]:
    data = ok(admin.query(VISIBILITY))["adminVisibility"]
    catalog = next(r["catalogVisible"] for r in data["catalogMatrix"] if r["roleId"] == role)
    level = next(r["level"] for r in data["responseMatrix"] if r["roleId"] == role)
    return catalog, level


def test_seeing_a_catalog_question_never_grants_seeing_its_responses(admin, executive, msl):
    # The Executive is aggregate-only: no catalog, no responses.
    assert role_state(admin, "executive") == (False, "AGGREGATE_ONLY")
    assert "Forbidden" in executive.query(CATALOG).error_types
    assert "Forbidden" in executive.query(RESPONSES, {"questionId": "Q-0001"}).error_types
    try:
        # Grant catalog visibility alone.
        granted = ok(admin.query(SET_CATALOG, {"input": {"roleId": "executive", "visible": True}}))["setCatalogVisibility"]
        assert granted == {"roleId": "executive", "catalogVisible": True}
        assert role_state(admin, "executive") == (True, "AGGREGATE_ONLY")  # the response matrix did not move

        questions = ok(executive.query(CATALOG, {"limit": 5}))["catalogQuestions"]
        assert len(questions) == 5 and all(q["questionId"] and q["text"] for q in questions)
        # The executive now sees the question, but its responses stay out of reach.
        blocked = executive.query(RESPONSES, {"questionId": questions[0]["questionId"]})
        assert "Forbidden" in blocked.error_types
        assert blocked.data is None or blocked.data.get("questionResponses") is None

        # The converse: an MSL who may read responses loses nothing about them when the catalog is withdrawn.
        assert ok(msl.query(RESPONSES, {"questionId": "Q-0001", "limit": 3}))["questionResponses"]["total"] > 0
        ok(admin.query(SET_CATALOG, {"input": {"roleId": "msl", "visible": False}}))
        assert "Forbidden" in msl.query(CATALOG).error_types
        still = ok(msl.query(RESPONSES, {"questionId": "Q-0001", "limit": 3}))["questionResponses"]
        assert still["total"] > 0 and len(still["responses"]) == 3
        assert role_state(admin, "msl") == (False, "RECORDS")
    finally:
        ok(admin.query(SET_CATALOG, {"input": {"roleId": "executive", "visible": False}}))
        ok(admin.query(SET_CATALOG, {"input": {"roleId": "msl", "visible": True}}))
    assert "Forbidden" in executive.query(CATALOG).error_types
    assert role_state(admin, "msl") == (True, "RECORDS")


def test_response_access_levels_are_independent_of_the_catalog(admin, msl):
    try:
        ok(admin.query(SET_RESPONSES, {"input": {"roleId": "msl", "level": "NONE"}}))
        assert role_state(admin, "msl") == (True, "NONE")  # the catalog stays visible
        assert ok(msl.query(CATALOG, {"limit": 2}))["catalogQuestions"]
        assert "Forbidden" in msl.query(RESPONSES, {"questionId": "Q-0001"}).error_types
    finally:
        ok(admin.query(SET_RESPONSES, {"input": {"roleId": "msl", "level": "RECORDS"}}))
    assert role_state(admin, "msl") == (True, "RECORDS")
    assert ok(msl.query(RESPONSES, {"questionId": "Q-0001", "limit": 1}))["questionResponses"]["total"] > 0


def test_response_access_is_still_limited_to_the_viewers_territory(msl, db):
    """Having response access is not the same as seeing every territory's responses."""
    result = ok(msl.query(RESPONSES, {"questionId": "Q-0001", "limit": 100}))["questionResponses"]
    assert result["responses"] and {r["territoryId"] for r in result["responses"]} == {"T01-01"}
    (expected,) = db.execute(
        "SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE qstn_ext_id = 'Q-0001' AND territory_id = 'T01-01' AND excluded_rspns_flag IS NOT TRUE"
    ).fetchone()
    assert result["total"] == expected


def test_visibility_changes_are_audited_as_separate_actions(admin):
    ok(admin.query(SET_CATALOG, {"input": {"roleId": "director", "visible": True}}))
    ok(admin.query(SET_RESPONSES, {"input": {"roleId": "director", "level": "RECORDS"}}))
    actions = {e["action"] for e in ok(admin.query(AUDIT, {"filter": {"resourceType": "role", "actorUserId": "admin-region-01"}}))["accessAudit"] if e["resourceId"] == "director"}
    assert {"catalog_visibility.updated", "response_access.updated"} <= actions


# ---------------------------------------------------------------- non-administrators


@pytest.mark.parametrize("query,variables", [
    (HIERARCHY, None),
    (TIMELINE, None),
    (VISIBILITY, None),
    (SET_CATALOG, {"input": {"roleId": "msl", "visible": True}}),
    (SET_RESPONSES, {"input": {"roleId": "msl", "level": "RECORDS"}}),
])
def test_governance_is_administrator_only(msl, executive, query, variables):
    assert "Forbidden" in msl.query(query, variables).error_types
    assert "Forbidden" in executive.query(query, variables).error_types


def test_visibility_inputs_are_validated(admin):
    assert "BadRequest" in admin.query(SET_CATALOG, {"input": {"roleId": "no-such-role", "visible": True}}).error_types
    assert "BadRequest" in admin.query(SET_RESPONSES, {"input": {"roleId": "msl", "level": "NONE"}, "x": 1} if False else {"input": {"roleId": "no-such-role", "level": "NONE"}}).error_types
