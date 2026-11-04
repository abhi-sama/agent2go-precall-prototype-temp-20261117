"""Administrator-only ingestion and data-quality validation through AppSync."""

from __future__ import annotations

from harness import Persona


ADMIN_DATA_QUALITY = """
query AdminDataQuality {
  adminDataQuality {
    ingestionRuns { runId sourceId status recordsLoaded errorSummary }
    identities { matched unmatched }
    duplicateKeyCount
    recordGrain { callProductRows distinctCalls }
    issues { issueId category affectedCount records { recordId sourceTable sourceRecordId } }
    questionGraph { missingParentCount duplicateKeyCount cycleCount nodes { questionId parentQuestionId state } }
  }
}
"""


def test_admin_api_exposes_planted_load_and_validation_defects():
    result = Persona.sign_in("admin-region-01").query(ADMIN_DATA_QUALITY)
    assert not result.errors, result.errors
    quality = result.data["adminDataQuality"]

    statuses = {run["runId"]: run["status"] for run in quality["ingestionRuns"]}
    assert statuses["run-failed"] == "failed"
    assert statuses["run-stale"] == "stale"
    assert quality["duplicateKeyCount"] >= 1
    assert quality["recordGrain"]["callProductRows"] > quality["recordGrain"]["distinctCalls"]
    assert quality["identities"]["unmatched"] >= 1

    issues = {issue["issueId"]: issue for issue in quality["issues"]}
    assert any(record["sourceRecordId"] == "INT-000001" for record in issues["duplicate-response-keys"]["records"])
    assert any(record["sourceRecordId"] == "Q-0100" for record in issues["missing-question-parents"]["records"])
    assert quality["questionGraph"]["missingParentCount"] >= 1
    assert any(node["questionId"] == "Q-0100" and node["parentQuestionId"] == "Q-NOT-IN-CATALOG" for node in quality["questionGraph"]["nodes"])


def test_non_administrator_cannot_read_quality_dashboard(msl):
    result = msl.query(ADMIN_DATA_QUALITY)
    assert result.data is None or result.data.get("adminDataQuality") is None
    assert "Forbidden" in result.error_types
