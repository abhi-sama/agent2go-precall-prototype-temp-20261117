"""Optional MSL workflows, proven through seeded Cognito personas and AppSync."""

from __future__ import annotations

from harness import Persona


CREATE_DRAFT = """
mutation Draft($input: PostCallDraftInput!) {
  createPostCallDraft(input: $input) { draftId notes structuredLines status }
}
"""
CONFIRM_DRAFT = "mutation ConfirmDraft($draftId: ID!) { confirmPostCallDraft(draftId: $draftId) { draftId status } }"
TASKS = "query Tasks { myFollowUpTasks { taskId description ownerUserId dueDate status } }"
CONFIRM_TASKS = """
mutation ConfirmTasks($input: [ConfirmFollowUpTaskInput!]!) {
  confirmFollowUpTasks(input: $input) { taskId description ownerUserId dueDate status }
}
"""
CREATE_RULE = """
mutation Rule($input: TopicAlertRuleInput!) {
  createTopicAlertRule(input: $input) { ruleId topic threshold periodDays }
}
"""
ALERTS = "query Alerts { topicAlerts { ruleId topic threshold periodDays count evidenceResponseIds } }"


def test_draft_is_lossless_and_requires_explicit_confirmation(msl):
    notes = "HCP requested long-term evidence.\nFollow up with a source-linked package."
    draft = msl.query(CREATE_DRAFT, {"input": {"notes": notes}})
    assert not draft.errors, draft.errors
    created = draft.data["createPostCallDraft"]
    assert created["notes"] == notes
    assert created["structuredLines"] == notes.splitlines()
    assert created["status"] == "DRAFT"
    confirmed = msl.query(CONFIRM_DRAFT, {"draftId": created["draftId"]})
    assert not confirmed.errors, confirmed.errors
    assert confirmed.data["confirmPostCallDraft"]["status"] == "CONFIRMED"


def test_tasks_do_not_exist_until_an_msl_confirms_them(msl, other_msl):
    before = msl.query(TASKS)
    assert not before.errors and before.data["myFollowUpTasks"] == []
    created = msl.query(CONFIRM_TASKS, {"input": [{"description": "Send approved evidence package", "dueDate": "2026-11-10"}]})
    assert not created.errors, created.errors
    task = created.data["confirmFollowUpTasks"][0]
    assert task["ownerUserId"] == "msl-t01-01" and task["status"] == "OPEN"
    assert msl.query(TASKS).data["myFollowUpTasks"][0]["taskId"] == task["taskId"]
    assert other_msl.query(TASKS).data["myFollowUpTasks"] == []


def test_topic_alert_threshold_is_deterministic_and_returns_evidence(msl):
    rule = msl.query(CREATE_RULE, {"input": {"topic": "evidence", "threshold": 1, "periodDays": 366}})
    assert not rule.errors, rule.errors
    alert = next(item for item in msl.query(ALERTS).data["topicAlerts"] if item["ruleId"] == rule.data["createTopicAlertRule"]["ruleId"])
    assert alert["count"] >= alert["threshold"]
    assert alert["periodDays"] == 366 and alert["evidenceResponseIds"]
