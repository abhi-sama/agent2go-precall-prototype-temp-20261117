"""Executive tools over the real shared library and database. Needs ``A2G_AGENT_DB_URL`` (the ``app_user`` DSN)."""

from __future__ import annotations

import os

import pytest

from msl_agent.repository import PostgresScopedRepository
from msl_agent.schemas import Identity
from msl_agent.tools import RunContext, build_tools

AGENT_URL = os.environ.get("A2G_AGENT_DB_URL")
pytestmark = pytest.mark.skipif(not AGENT_URL, reason="needs A2G_AGENT_DB_URL")


def ctx_for(user: str, persona: str) -> RunContext:
    identity = Identity(user_id=user, persona=persona, correlation_id="corr-db-test")
    return RunContext(identity=identity, repository=PostgresScopedRepository(AGENT_URL))


def test_executive_gets_suppressed_aggregates_with_aggregate_citations_and_limitations() -> None:
    ctx = ctx_for("executive-region-01", "Executive")
    tools = {t.tool_name: t for t in build_tools(ctx)}
    assert '"status":"ok"' in tools["get_org_themes"](facet="MOLECULE")
    assert '"status":"ok"' in tools["get_region_topic_matrix"]()
    assert ctx.facts and all(isinstance(f.value, int) for f in ctx.facts)
    assert ctx.citations and all(c.kind == "aggregate" and c.record_id.startswith("agg:") for c in ctx.citations.values())
    assert ctx.limitations and ctx.executive_evidence
    assert not any("suppressed" in r for r in ctx.tool_results)


def test_executive_scope_check_denies_a_foreign_named_territory() -> None:
    repository = PostgresScopedRepository(AGENT_URL)
    identity = Identity(user_id="executive-region-01", persona="Executive", correlation_id="corr-db-test")

    assert repository.territory_in_scope(identity, "T01-01")
    assert not repository.territory_in_scope(identity, "T02-01")


def test_other_personas_and_unscoped_executives_get_nothing() -> None:
    for user, persona, status in (("msl-t01-01", "MSL", "executive_only"), ("director-region-01", "Director", "executive_only"), ("msl-nobody", "Executive", "no_scope")):
        ctx = ctx_for(user, persona)
        result = {t.tool_name: t for t in build_tools(ctx)}["get_org_themes"]()
        assert f'"status":"{status}"' in result and not ctx.facts and not ctx.citations
