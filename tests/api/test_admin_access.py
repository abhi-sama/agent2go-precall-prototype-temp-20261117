"""Administrator access controls through the public AppSync API seam."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from harness import Persona
from ground_truth import kpis


OVERVIEW = """
query AdminAccessOverview {
  adminAccessOverview {
    identityMatches { userId identityStatus rosterSourceRowId exactEmailCandidateCount flag }
    roleMatrix { roleId permissions { permissionCode } }
    scopeAssignments { assignmentId territoryId unresolvedTerritory }
  }
}
"""

CREATE_SCOPE = """
mutation CreateScope($input: ScopeAssignmentInput!) {
  createScopeAssignment(input: $input) {
    assignmentId userId territoryId assignmentType effectiveFrom effectiveTo unresolvedTerritory
  }
}
"""

AUDIT = """
query Audit($filter: AccessAuditFilter) {
  accessAudit(filter: $filter) { eventId actorUserId action resourceType resourceId outcome occurredAt }
}
"""


def test_identity_reconciliation_flags_without_auto_merging():
    admin = Persona.sign_in("admin-region-01")
    result = admin.query(OVERVIEW)
    assert not result.errors, result.errors
    identities = {item["userId"]: item for item in result.data["adminAccessOverview"]["identityMatches"]}

    # The fixture has a deliberate two-row exact-email conflict.  The API exposes it
    # for review but does not choose either roster row.
    conflict = identities["admin-region-04"]
    assert conflict["identityStatus"] == "unresolved"
    assert conflict["flag"] == "conflicting"
    assert conflict["exactEmailCandidateCount"] == 2
    assert conflict["rosterSourceRowId"] is None

    # A separate unmatched login is visibly missing, while an approved mapping stays
    # distinct from a matching-looking email candidate.
    assert identities["admin-region-02"]["flag"] == "missing"
    assert identities["admin-region-01"]["flag"] == "matched"


def test_assignment_effective_dates_and_audit_filters(msl, db):
    admin = Persona.sign_in("admin-region-01")
    now = datetime.now(timezone.utc)
    future = (now + timedelta(days=1)).isoformat()
    past = (now - timedelta(minutes=1)).isoformat()
    assignment_ids: list[str] = []
    try:
        scheduled = admin.query(CREATE_SCOPE, {"input": {"userId": "msl-t01-01", "territoryId": "T03-01", "assignmentType": "temporary", "effectiveFrom": future}})
        assert not scheduled.errors, scheduled.errors
        assignment_ids.append(scheduled.data["createScopeAssignment"]["assignmentId"])
        assert scheduled.data["createScopeAssignment"]["territoryId"] == "T03-01"

        # The future grant is visible as scheduled but cannot broaden the MSL's RLS scope yet.
        before = msl.landing_kpis("2026-01-01", "2026-11-03").data["landingKpis"]
        assert before["distinctCalls"] == kpis(db, ["T01-01"], "2026-01-01", "2026-11-03")["distinctCalls"]

        active = admin.query(CREATE_SCOPE, {"input": {"userId": "msl-t01-01", "territoryId": "T02-01", "assignmentType": "temporary", "effectiveFrom": past}})
        assert not active.errors, active.errors
        active_assignment = active.data["createScopeAssignment"]
        assignment_ids.append(active_assignment["assignmentId"])
        assert active_assignment["unresolvedTerritory"] is False
        after = msl.landing_kpis("2026-01-01", "2026-11-03").data["landingKpis"]
        assert after["distinctCalls"] == kpis(db, ["T01-01", "T02-01"], "2026-01-01", "2026-11-03")["distinctCalls"]

        base_filter = {"actorUserId": "admin-region-01", "action": "scope_assignment.created", "resourceType": "user_scope_assignment", "outcome": "applied"}
        filtered = admin.query(AUDIT, {"filter": base_filter})
        assert not filtered.errors, filtered.errors
        events = filtered.data["accessAudit"]
        assert any(event["resourceId"] == active_assignment["assignmentId"] for event in events)

        # Each individual supported search dimension narrows the same audited event.
        for key, value in (*base_filter.items(),):
            result = admin.query(AUDIT, {"filter": {key: value}})
            assert not result.errors, result.errors
            assert any(event["resourceId"] == active_assignment["assignmentId"] for event in result.data["accessAudit"])

        by_time = admin.query(AUDIT, {"filter": {"from": (now - timedelta(minutes=5)).isoformat(), "to": (now + timedelta(minutes=5)).isoformat()}})
        assert not by_time.errors, by_time.errors
        assert any(event["resourceId"] == active_assignment["assignmentId"] for event in by_time.data["accessAudit"])
    finally:
        if assignment_ids:
            db.execute("DELETE FROM audit_events WHERE resource_type = 'user_scope_assignment' AND resource_id = ANY(%s)", (assignment_ids,))
            db.execute("DELETE FROM user_scope_assignments WHERE assignment_id = ANY(%s)", ([int(value) for value in assignment_ids],))


def test_admin_access_queries_are_not_available_to_an_msl(msl):
    result = msl.query(OVERVIEW)
    assert "Forbidden" in result.error_types
