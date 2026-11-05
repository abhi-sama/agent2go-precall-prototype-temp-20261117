"""Executive organisational analysis: aggregate tools, withheld counts, citations, and the limitations paragraph."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from conftest import make_invocation
from test_runtime import collect, names, runtime

from msl_agent.agent import MslAgent
from msl_agent.repository import FixtureScopedRepository
from msl_agent.tools import RunContext, build_tools

EXEC = "executive-region-01"


def executive(question: str = "Which themes are rising across regions?"):
    return make_invocation(EXEC, "Executive", question)


def event(events: list[dict[str, Any]], name: str) -> Any:
    return next(e for e in events if e.get("name") == name)["value"]


def text_of(events: list[dict[str, Any]]) -> str:
    return "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")


def test_named_executive_territory_uses_the_territory_aggregate_group() -> None:
    assert MslAgent._executive_activity_group(
        "How many distinct calls did territory T01-01 have between 2026-10-01 and 2026-10-31?"
    ) == "territory"


@pytest.mark.parametrize(
    "question",
    [
        "Show me the individual calls, call ids and HCP names for territory T01-01.",
        "What percentage of responses to Q-0145 were Yes?",
        "How many HCPs were engaged about osimertinib?",
        "How many calls did oncologists receive in Q3?",
    ],
)
def test_executive_source_or_unsupported_filters_are_refused_before_tool_selection(question: str) -> None:
    assert MslAgent._executive_request_requires_refusal(question)


@pytest.mark.asyncio
async def test_executive_source_request_refuses_without_aggregate_visual(settings, repository) -> None:
    agent, _ = runtime(settings, repository, [("tool", "get_executive_activity", {"metric": "calls"}), "There were 48 calls."])
    events = await collect(agent, executive("Show me the individual calls and HCP names for territory T01-01."))
    assert "aggregate-only Executive" in text_of(events)
    assert "source_facts" not in names(events) and "visual" not in names(events) and "citations" not in names(events)


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
async def test_executive_activity_tool_returns_suppressed_aggregates_and_a_chart(settings, repository) -> None:
    steps = [
        ("tool", "get_executive_activity", {"metric": "calls", "group_by": "month"}),
        "The displayed aggregates are available; small groups are withheld.",
    ]
    agent, writer = runtime(settings, repository, steps)
    events = await collect(agent, executive("Show call activity by month"))
    facts = event(events, "source_facts")["facts"]
    assert {f["label"]: f["value"] for f in facts}["Distinct calls"] == 48
    assert event(events, "visual")["kind"] == "line"
    assert all(c["kind"] == "aggregate" and c["record_id"].startswith("agg:") for c in event(events, "citations"))
    result = {tool.tool_name: tool for tool in build_tools(RunContext(identity=executive().identity, repository=repository))}["get_executive_activity"]
    # The model gets a human-safe marker, never the raw suppression boolean or hidden count.
    assert '"suppressed"' not in result(metric="calls", group_by="month", tool_context=SimpleNamespace(tool_use={}))
    assert writer.turns[0].citations and all(c.kind == "aggregate" for c in writer.turns[0].citations)


@pytest.mark.asyncio
async def test_executive_visible_total_gets_a_single_safe_aggregate_bar(settings, repository) -> None:
    agent, _ = runtime(
        settings,
        repository,
        [("tool", "get_executive_activity", {"metric": "calls"}), "The displayed total is aggregate-only."],
    )
    events = await collect(agent, executive("How many distinct calls are in my scope?"))
    visual = event(events, "visual")
    assert visual["kind"] == "bar" and visual["points"] == [{"key": "total", "label": "All authorized scope", "value": 48, "partial": False}]


@pytest.mark.asyncio
async def test_executive_record_tools_still_refuse_but_the_runtime_backstops_activity(settings, repository) -> None:
    steps = [("tool", "get_activity_summary", {}), "Not available."]
    agent, _ = runtime(settings, repository, steps)
    events = await collect(agent, executive("Compare calls by territory per month"))
    assert "visual" in names(events)
    facts = event(events, "source_facts")["facts"]
    assert any("calls" in f["label"].lower() for f in facts)
    assert all(c["kind"] == "aggregate" for c in event(events, "citations"))


@pytest.mark.asyncio
async def test_executive_default_total_does_not_satisfy_a_requested_trend_chart(settings, repository) -> None:
    # Claude can select the tool while leaving its default total grouping in place.  A total is useful evidence,
    # but it does not satisfy a by-month request, so the runtime must append the deterministic safe trend chart.
    steps = [("tool", "get_executive_activity", {"metric": "calls"}) for _ in range(5)]
    steps.append("The aggregate total is available.")
    agent, _ = runtime(settings, repository, steps)
    events = await collect(agent, executive("Show distinct calls by month"))
    assert names(events)[-1] == "RUN_FINISHED"
    assert any(e.get("name") == "visual" and e["value"].get("kind") == "line" for e in events)


@pytest.mark.asyncio
async def test_bad_facet_is_refused_by_the_tool(settings, repository) -> None:
    from msl_agent.tools import RunContext, build_tools

    ctx = RunContext(identity=executive().identity, repository=repository)
    tools = {t.tool_name: t for t in build_tools(ctx)}
    assert "facet must be" in tools["get_org_themes"](facet="TERRITORY")
    assert "Dates must be" in tools["get_org_themes"](from_date="soon")
    assert ctx.limitations == [] and not ctx.executive_evidence
