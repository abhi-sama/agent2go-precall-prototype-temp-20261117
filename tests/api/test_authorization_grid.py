"""Ticket 19: the Administrator-visible authorization verification coverage.

The individual path assertions live beside their feature tests; this test is the single
CI inventory that proves every persona, protected access path, and effective-dated
scope case is represented in the published Administrator matrix.
"""
from __future__ import annotations

import pytest

from harness import Persona


GRID = """
query AuthorizationVerificationGrid {
  authorizationVerificationGrid {
    suiteId localOnly total passed
    results { testId persona accessPath scopeScenario expectation status }
  }
}
"""

PERSONAS = {"MSL", "Director", "Executive", "Administrator"}
PATHS = {
    "API search", "Dashboards", "Chat retrieval", "Vector search", "Saved outputs",
    "Offline caches", "Exports", "Drill-down",
}
SCENARIOS = {"in_scope", "out_of_scope", "after_transfer", "coverage_expired"}


def test_administrator_can_read_the_complete_local_appsync_verification_matrix():
    result = Persona.sign_in("admin-region-01").query(GRID)
    assert not result.errors, result.errors
    grid = result.data["authorizationVerificationGrid"]
    assert grid["suiteId"] == "local-appsync-authorization-v1"
    assert grid["localOnly"] is True
    assert grid["total"] == grid["passed"] == len(PERSONAS) * len(PATHS) * len(SCENARIOS)
    assert {row["persona"] for row in grid["results"]} == PERSONAS
    assert {row["accessPath"] for row in grid["results"]} == PATHS
    assert {row["scopeScenario"] for row in grid["results"]} == SCENARIOS
    assert {row["status"] for row in grid["results"]} == {"PASS"}
    assert all(row["expectation"] and row["testId"].startswith("authorization-grid::") for row in grid["results"])


@pytest.mark.parametrize("user_id", ["msl-t01-01", "director-region-01", "executive-region-01"])
def test_authorization_verification_results_are_administrator_only(user_id):
    result = Persona.sign_in(user_id).query(GRID)
    assert "Forbidden" in result.error_types
