"""Ticket 08 acceptance: derived qualitative insight remains evidence-backed and scoped."""
from __future__ import annotations


DISCOVERY = """
query Insights { insightDiscovery { themes { name responseCount excerpt recordId } followUpTopics { topic evidenceCount excerpt recordId } } }
"""
SEARCH = """
query Search($query: String!) { semanticInsightSearch(query: $query, limit: 10) { responseId territoryId responseText } }
"""


def test_themes_and_possible_followups_are_evidence_backed(msl):
    result = msl.query(DISCOVERY)
    assert result.errors == []
    insights = result.data["insightDiscovery"]
    assert insights["themes"]
    assert all(row["responseCount"] > 0 and row["recordId"] and row["excerpt"] for row in insights["themes"])
    assert insights["followUpTopics"]
    assert all(row["evidenceCount"] > 0 and row["recordId"] and row["topic"] for row in insights["followUpTopics"])


def test_semantic_search_is_rls_scoped_api_as_persona(msl, other_msl):
    mine = msl.query(SEARCH, {"query": "evidence and access"})
    theirs = other_msl.query(SEARCH, {"query": "evidence and access"})
    assert mine.errors == [] and theirs.errors == []
    mine_rows, their_rows = mine.data["semanticInsightSearch"], theirs.data["semanticInsightSearch"]
    assert mine_rows and their_rows
    assert {row["territoryId"] for row in mine_rows} == {"T01-01"}
    assert {row["territoryId"] for row in their_rows} == {"T02-01"}
    assert not ({row["responseId"] for row in mine_rows} & {row["responseId"] for row in their_rows})
