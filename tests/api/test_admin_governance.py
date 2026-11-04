"""Ticket 17 administrator governance is exercised only through AppSync as seeded personas."""

from __future__ import annotations

from harness import Persona


GOVERNANCE = """
query Governance {
  adminMetadataReconciliation {
    questionId field isConsistent
    catalogValues { value sourceTable sourceRecordId observedAt }
    responseValues { value sourceTable sourceRecordId observedAt }
  }
  adminDefinitions { definitionId version kind name ownerUserId status approvedBy approvedAt }
  governanceRequestQueue { requestId requestType resourceType resourceId status auditHistory { actorUserId action occurredAt } }
}
"""
CREATE_DEFINITION = """
mutation Create($input: CreateDefinitionInput!) { createDefinition(input: $input) { definitionId version status ownerUserId } }
"""
APPROVE_DEFINITION = """
mutation Approve($input: ApproveDefinitionInput!) { approveDefinition(input: $input) { definitionId version status approvedBy approvedAt } }
"""
CREATE_QUEUE = """
mutation Queue($input: CreateGovernanceRequestInput!) {
  createGovernanceRequest(input: $input) { requestId requestType resourceId status auditHistory { action actorUserId } }
}
"""
ISSUE_ASSISTANT = """
query IssueAssistant($issueId: ID!) {
  adminIssueAssistant(issueId: $issueId) { issueId explanation suggestedSteps capabilities autonomousActions }
}
"""


def test_metadata_values_keep_both_sources_and_provenance():
    result = Persona.sign_in("admin-region-01").query(GOVERNANCE)
    assert not result.errors, result.errors
    rows = result.data["adminMetadataReconciliation"]
    mismatch = next(row for row in rows if row["questionId"] == "Q-0001")
    assert mismatch["field"] == "status"
    assert mismatch["isConsistent"] is False
    assert {item["value"] for item in mismatch["catalogValues"]} == {"Active"}
    assert "Retired" in {item["value"] for item in mismatch["responseValues"]}
    for item in mismatch["catalogValues"] + mismatch["responseValues"]:
        assert item["sourceTable"] and item["sourceRecordId"] and item["observedAt"]


def test_definition_versions_need_another_administrator_to_approve():
    author = Persona.sign_in("admin-region-01")
    created = author.query(CREATE_DEFINITION, {"input": {"definitionId": "test-governed-metric", "kind": "METRIC", "name": "Test governed metric", "definition": "A test definition."}})
    assert not created.errors, created.errors
    definition = created.data["createDefinition"]
    assert definition["version"] == 1 and definition["status"] == "DRAFT"
    own_approval = author.query(APPROVE_DEFINITION, {"input": {"definitionId": definition["definitionId"], "version": 1}})
    assert "BadRequest" in own_approval.error_types
    approved = Persona.sign_in("admin-region-02").query(APPROVE_DEFINITION, {"input": {"definitionId": definition["definitionId"], "version": 1}})
    assert not approved.errors, approved.errors
    assert approved.data["approveDefinition"]["status"] == "APPROVED"
    assert approved.data["approveDefinition"]["approvedBy"] == "admin-region-02"


def test_lifecycle_queue_keeps_request_audit_history():
    result = Persona.sign_in("admin-region-01").query(CREATE_QUEUE, {"input": {"requestType": "CORRECTION", "resourceType": "question_tag", "resourceId": "Q-0100", "reason": "Verify parent relationship."}})
    assert not result.errors, result.errors
    queue = result.data["createGovernanceRequest"]
    assert queue["status"] == "OPEN"
    assert queue["auditHistory"] == [{"action": "CREATED", "actorUserId": "admin-region-01"}]


def test_issue_assistant_is_read_only_and_schema_offers_no_assistant_mutation():
    admin = Persona.sign_in("admin-region-01")
    result = admin.query(ISSUE_ASSISTANT, {"issueId": "missing-question-parents"})
    assert not result.errors, result.errors
    assistant = result.data["adminIssueAssistant"]
    assert assistant["explanation"] and assistant["suggestedSteps"]
    assert assistant["capabilities"] == ["EXPLAIN", "SUGGEST"]
    assert assistant["autonomousActions"] == []

    # AppSync rejects an invented write field before it can reach a resolver: the assistant has
    # no mutation surface through which it could fix data or grant access.
    mutation = admin.query("mutation { adminIssueAssistant(issueId: \"missing-question-parents\") { issueId } }")
    assert mutation.errors


def test_governance_ticket_17_is_administrator_only(msl):
    result = msl.query(GOVERNANCE)
    assert "Forbidden" in result.error_types
