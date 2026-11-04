"""Executive organisational analysis: aggregate tools, withheld counts, citations, and the limitations paragraph."""

from __future__ import annotations

from typing import Any

import pytest
from conftest import make_invocation
from test_runtime import collect, names, runtime

from msl_agent.repository import FixtureScopedRepository

EXEC = "executive-region-01"


def executive(question: str = "Which themes are rising across regions?"):
    return make_invocation(EXEC, "Executive", question)


def event(events: list[dict[str, Any]], name: str) -> Any:
    return next(e for e in events if e.get("name") == name)["value"]


def text_of(events: list[dict[str, Any]]) -> str:
    return "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")


@pytest.mark.asyncio
async def test_executive_themes_emit_facts_aggregate_citations_and_limitations(settings, repository) -> None:
    steps = [("tool", "get_org_themes", {}), "ctDNA monitoring is flagged RISING with 72 responses."]
    agent, writer = runtime(settings, repository, steps)
    events = await collect(agent, executive("What are the leading themes?"))

    facts = event(events, "source_facts")["facts"]
    assert {f["label"]: f["value"] for f in facts}["Responses on ctDNA monitoring (emerging)"] == 72
    cites = event(events, "citations")
    assert cites and all(c["kind"] == "aggregate" and c["record_id"].startswith("agg:") for c in cites)
    assert all(c["dataset"] == "hcp_raw_insights" and c["detail"] for c in cites)
    limits = event(events, "sample_limitations")["items"]
    assert limits and any("Counts below 5" in item for item in limits)
    text = text_of(events)
    assert "\n\nSample limitations: " in text and "Counts below 5" in text
    # Figures in the limitations paragraph come from the tool result, so the number check passes.
    assert event(events, "number_check")["status"] == "verified"
    [turn] = writer.turns
    assert turn.citations and turn.sample_limitations == limits and "Sample limitations:" in turn.assistant_text
    assert names(events)[-1] == "RUN_FINISHED"


@pytest.mark.asyncio
async def test_withheld_counts_never_become_facts_or_numbers_for_the_model(settings, repository) -> None:
    agent, writer = runtime(settings, repository, [("tool", "get_org_themes", {}), "Done."])
    events = await collect(agent, executive())
    labels = [f["label"] for f in event(events, "source_facts")["facts"]]
    assert not any("Pulmonary" in label for label in labels)  # that card's count is a withheld small group
    assert all(isinstance(f.value, int) for f in writer.turns[0].facts)

    from msl_agent.tools import RunContext, build_tools

    ctx = RunContext(identity=executive().identity, repository=repository)
    result = {t.tool_name: t for t in build_tools(ctx)}["get_org_themes"]()
    assert "withheld (small group)" in result and '"suppressed"' not in result


@pytest.mark.asyncio
async def test_matrix_tool_reports_alert_cells_and_cross_region_topics(settings, repository) -> None:
    steps = [("tool", "get_region_topic_matrix", {}), "ctDNA monitoring is rising in two regions."]
    agent, writer = runtime(settings, repository, steps)
    events = await collect(agent, executive())
    facts = {f["label"]: f["value"] for f in event(events, "source_facts")["facts"]}
    assert facts["Responses on ctDNA monitoring (emerging) in Region 1"] == 40
    assert facts["Responses on ctDNA monitoring (emerging) in Region 2"] == 32
    assert not any("Pulmonary" in label for label in facts)
    assert any(c["record_id"].startswith("agg:matrix:") for c in event(events, "citations"))
    assert writer.turns[0].sample_limitations


@pytest.mark.asyncio
async def test_a_model_that_skips_the_tools_still_gets_evidence_and_limitations(settings, repository) -> None:
    agent, writer = runtime(settings, repository, ["I think things are fine."])
    events = await collect(agent, executive("Which topics are emerging across regions?"))
    assert "source_facts" in names(events) and "citations" in names(events)
    assert "Sample limitations:" in text_of(events)
    [turn] = writer.turns
    assert turn.citations and turn.facts
    # The question mentions regions, so the matrix evidence is there too.
    assert any(c.record_id.startswith("agg:matrix:") for c in turn.citations)


@pytest.mark.asyncio
async def test_stub_mode_runs_the_aggregate_tools_up_front(stub_settings, repository) -> None:
    agent, writer = runtime(stub_settings, repository, ["Canned answer."])
    events = await collect(agent, executive("Show the themes by molecule"))
    assert names(events).index("source_facts") < names(events).index("TEXT_MESSAGE_START")
    assert "Sample limitations:" in text_of(events)
    assert names(events).count("visual") == 0


@pytest.mark.asyncio
async def test_an_executive_without_data_gets_no_invented_limitations(settings, repository) -> None:
    agent, writer = runtime(settings, repository, ["Nothing available."])
    events = await collect(agent, make_invocation("exec-1", "Executive"))
    assert "Sample limitations:" not in text_of(events)
    assert "source_facts" not in names(events) and "citations" not in names(events)
    assert writer.turns[0].sample_limitations == []


@pytest.mark.asyncio
async def test_other_personas_cannot_use_the_executive_tools(settings, repository) -> None:
    for user, persona in (("msl-t01-01", "MSL"), ("director-region-01", "Director")):
        agent, writer = runtime(settings, repository, [("tool", "get_org_themes", {}), ("tool", "get_region_topic_matrix", {}), "No."])
        events = await collect(agent, make_invocation(user, persona))
        assert not {"source_facts", "citations", "sample_limitations"} & set(names(events))
        assert "Sample limitations:" not in text_of(events)
        assert writer.turns[0].facts == [] and writer.turns[0].citations == []
    direct = await repository_refuses(repository)
    assert direct == "executive_only"


async def repository_refuses(repository: FixtureScopedRepository) -> str:
    result = repository.executive_themes(
        make_invocation("msl-t01-01", "MSL").identity, period_from=None, period_to=None, facet="PORTFOLIO"
    )
    return result.status


@pytest.mark.asyncio
async def test_executive_record_tools_still_refuse_and_no_chart_fallback_runs(settings, repository) -> None:
    steps = [("tool", "get_activity_summary", {}), "Not available."]
    agent, _ = runtime(settings, repository, steps)
    events = await collect(agent, executive("Compare calls by territory per month"))
    assert "visual" not in names(events)
    facts = event(events, "source_facts")["facts"]
    assert all("calls" not in f["label"].lower() for f in facts)


@pytest.mark.asyncio
async def test_bad_facet_is_refused_by_the_tool(settings, repository) -> None:
    from msl_agent.tools import RunContext, build_tools

    ctx = RunContext(identity=executive().identity, repository=repository)
    tools = {t.tool_name: t for t in build_tools(ctx)}
    assert "facet must be" in tools["get_org_themes"](facet="TERRITORY")
    assert "Dates must be" in tools["get_org_themes"](from_date="soon")
    assert ctx.limitations == [] and not ctx.executive_evidence
