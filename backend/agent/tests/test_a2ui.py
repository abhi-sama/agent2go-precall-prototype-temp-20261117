"""A2UI surfaces in chat answers (docs/adr/0017): emission, the catalog contract, the number guard, and actions."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

import pytest
from conftest import make_invocation
from test_runtime import RecordingWriter, ScriptedAgent, collect, names, runtime

from msl_agent import a2ui
from msl_agent.agent import REFINE_REFUSAL, MslAgent
from msl_agent.repository import FixtureScopedRepository
from msl_agent.schemas import A2uiAction, Invocation
from msl_agent.tools import RunContext, build_tools
from msl_agent.writes import item_for

CATALOG = json.loads(
    (Path(__file__).resolve().parents[3] / "docs" / "a2ui" / "answer-catalog.json").read_text()
)
EXECUTIVE = FixtureScopedRepository.EXECUTIVE_USER


def surfaces(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each A2UI surface streamed in a run, as its ``createSurface`` body."""
    out = []
    for event in events:
        if event["type"] == "ACTIVITY_SNAPSHOT" and event["activityType"] == "a2ui-surface":
            [operation] = event["content"]["a2ui_operations"]
            assert operation["version"] == "1.0"
            out.append(operation["createSurface"])
    return out


def by_slot(events: list[dict[str, Any]], slot: str) -> list[dict[str, Any]]:
    return [s for s in surfaces(events) if s["metadata"]["extensions"][a2ui.SLOT_EXTENSION] == slot]


def component(surface: dict[str, Any], cid: str) -> dict[str, Any]:
    return next(c for c in surface["components"] if c["id"] == cid)


def action_invocation(
    context: dict[str, Any], *, user_id: str = "msl-t01-01", persona: str = "MSL", name: str = "refine_answer"
) -> Invocation:
    invocation = make_invocation(user_id, persona, "Update this answer: Engaged HCPs, by month")
    action = A2uiAction(
        name=name,
        surface_id="refine_1_run-1",
        source_component_id="submit",
        timestamp="2026-11-12T10:00:00Z",
        context=context,
    )
    return invocation.model_copy(update={"a2ui_action": action})


def assert_fits_catalog(surface: dict[str, Any]) -> None:
    """Every component, property and function on the surface is declared in docs/a2ui/answer-catalog.json."""
    assert surface["catalogId"] == CATALOG["catalogId"]
    for c in surface["components"]:
        spec = CATALOG["components"][c["component"]]
        declared = set(spec["properties"]) | ({"@checks"} if "allOf" in spec else set())
        assert set(c) - {"id"} <= declared, (c["component"], set(c) - {"id"} - declared)
    assert set(a2ui._calls(surface)) <= set(CATALOG["functions"])


def test_the_runtime_contract_mirrors_the_catalog_document() -> None:
    assert CATALOG["catalogId"] == a2ui.CATALOG_ID and CATALOG["protocolVersion"] == a2ui.PROTOCOL_VERSION
    assert set(CATALOG["components"]) == set(a2ui.COMPONENT_PROPERTIES)
    for name, props in a2ui.COMPONENT_PROPERTIES.items():
        spec = CATALOG["components"][name]
        assert props - {"@checks"} == set(spec["properties"]) - {"component"}
        assert ("@checks" in props) == ("allOf" in spec)
    assert set(CATALOG["functions"]) == a2ui.FUNCTIONS
    # v1.0 rules: the reserved name, and UAX #31 identifiers for every component and function.
    assert "Surface" not in CATALOG["components"]
    assert all(a2ui._IDENT.match(n) for n in [*CATALOG["components"], *CATALOG["functions"]])


@pytest.mark.asyncio
async def test_a_count_answer_offers_the_adjust_form_prefilled_from_its_own_query(
    settings, repository
) -> None:
    steps = [("tool", "get_activity_summary", {}), "You made 2 calls with 2 HCPs."]
    agent, writer = runtime(settings, repository, steps)
    events = await collect(agent, make_invocation())

    [form] = by_slot(events, "follow_up")
    assert_fits_catalog(form)
    assert form["surfaceId"].startswith("refine_1_")
    assert form["dataModel"] == {
        "measure": ["calls"],
        "group": ["total"],
        "from": "2026-08-06",
        "to": "2026-11-03",
        "territory": ["all"],
    }
    # Territories come from the caller's own scope (RLS), nothing else.
    assert [o["value"] for o in component(form, "territory")["options"]] == ["all", "T01-01"]
    assert component(form, "to")["max"] == "2026-11-03"
    submit = component(form, "submit")["action"]["event"]
    assert submit["name"] == "refine_answer"
    assert set(submit["context"]) == {"measure", "group", "territory", "from", "to"}
    # The form follows the answer text and comes before the suggestions; it is saved with the turn.
    order = names(events)
    assert order.index("TEXT_MESSAGE_END") < order.index("ACTIVITY_SNAPSHOT") < order.index("suggestions")
    assert writer.turns[0].surfaces[0][0]["createSurface"]["surfaceId"] == form["surfaceId"]


@pytest.mark.asyncio
async def test_a_chart_answer_offers_its_own_measure_and_grouping(settings, repository) -> None:
    steps = [
        ("tool", "get_activity_summary", {}),
        ("tool", "show_chart", {"metric": "engaged_hcps", "group_by": "product"}),
        "Mostly osimertinib.",
    ]
    agent, _ = runtime(settings, repository, steps)
    [form] = by_slot(await collect(agent, make_invocation()), "follow_up")
    assert form["dataModel"]["measure"] == ["engaged_hcps"] and form["dataModel"]["group"] == ["product"]


@pytest.mark.asyncio
async def test_a_theme_answer_streams_a_table_with_the_rule_flags_from_the_database(
    settings, repository
) -> None:
    steps = [("tool", "get_topic_trends", {}), "ctDNA monitoring was flagged EMERGING by the rule."]
    agent, _ = runtime(settings, repository, steps)
    events = await collect(agent, make_invocation(question="What themes are emerging?"))

    [table] = by_slot(events, "evidence")
    assert_fits_catalog(table)
    assert component(table, "table")["rows"] == {"@path": "/rows"}
    # Hand-written ground truth from FixtureScopedRepository.topic_trends.
    assert table["dataModel"]["rows"] == [
        {"theme": "ctDNA monitoring (emerging)", "latest": 72, "earlier": 21, "flag": "Emerging"},
        {"theme": "Access and reimbursement", "latest": 99, "earlier": 104, "flag": "No change flagged"},
    ]
    order = names(events)
    assert order.index("ACTIVITY_SNAPSHOT") < order.index("TEXT_MESSAGE_START")
    # A theme answer has no adjustable count, so there is no form.
    assert by_slot(events, "follow_up") == []


@pytest.mark.asyncio
async def test_aggregate_only_executives_get_withheld_words_and_no_record_level_ui(
    settings, repository
) -> None:
    steps = [("tool", "get_org_themes", {}), "ctDNA monitoring is rising."]
    agent, _ = runtime(settings, repository, steps)
    events = await collect(agent, make_invocation(EXECUTIVE, "Executive", "Which themes are rising?"))

    [table] = by_slot(events, "evidence")
    assert_fits_catalog(table)
    rows = {r["theme"]: r for r in table["dataModel"]["rows"]}
    assert rows["Pulmonary surveillance (emerging)"]["latest"] == "Withheld"  # never 0, never a number
    assert rows["ctDNA monitoring (emerging)"]["trend"] == "Rising"
    text = json.dumps(surfaces(events))
    for record_marker in ("RESP-", "CALL-", "HCP-", "agg:", "Show rows", "territory"):
        assert record_marker not in text


@pytest.mark.asyncio
async def test_an_executive_adjust_form_has_no_territory_picker(settings, repository) -> None:
    steps = [("tool", "get_executive_activity", {"metric": "calls", "group_by": "month"}), "Calls by month."]
    agent, _ = runtime(settings, repository, steps)
    [form] = by_slot(
        await collect(agent, make_invocation(EXECUTIVE, "Executive", "Show calls by month")), "follow_up"
    )
    assert_fits_catalog(form)
    assert "territory" not in form["dataModel"]
    assert all(c["id"] != "territory" for c in form["components"])
    assert [o["value"] for o in component(form, "group")["options"]] == [
        "total",
        "month",
        "region",
        "territory",
    ]


@pytest.mark.asyncio
async def test_plain_text_answers_still_work_without_surfaces(settings, repository) -> None:
    agent, _ = runtime(settings, repository, ["Hello."])
    events = await collect(agent, make_invocation(question="hello"))
    assert surfaces(events) == []
    assert "TEXT_MESSAGE_CONTENT" in names(events) and names(events)[-1] == "RUN_FINISHED"


def test_a_surface_with_a_figure_no_tool_returned_is_dropped(repository) -> None:
    ctx = RunContext(make_invocation().identity, repository, run_id="run-1")
    columns = [a2ui.TableColumn("theme", "Theme"), a2ui.TableColumn("n", "Responses", numeric=True)]
    ctx.tool_results.append(json.dumps({"responses": 72}))

    ok = ctx.add_surface(
        "themes",
        lambda sid: a2ui.table_surface(
            sid, title="T", caption="c", columns=columns, rows=[{"theme": "a", "n": 72}]
        ),
    )
    invented = ctx.add_surface(
        "themes",
        lambda sid: a2ui.table_surface(
            sid, title="T", caption="c", columns=columns, rows=[{"theme": "a", "n": 73}]
        ),
    )
    in_text = ctx.add_surface(
        "themes",
        lambda sid: a2ui.table_surface(
            sid, title="About 500 responses", caption="c", columns=columns, rows=[]
        ),
    )

    assert (ok, invented, in_text) == (True, False, False)
    assert len(ctx.surfaces) == 1 and len(ctx.pending) == 1


def test_contract_errors_reject_anything_outside_the_catalog() -> None:
    def surface(components: list[dict[str, Any]], **extra: Any) -> list[dict[str, Any]]:
        return [
            {
                "version": "1.0",
                "createSurface": {
                    "surfaceId": "s_1",
                    "catalogId": a2ui.CATALOG_ID,
                    "components": components,
                    **extra,
                },
            }
        ]

    root = {"id": "root", "component": "Text", "text": "Hi"}
    assert a2ui.contract_errors(surface([root])) == []
    assert a2ui.contract_errors(surface([{"id": "root", "component": "Image", "url": "x"}]))
    assert a2ui.contract_errors(surface([{**root, "html": "<b>x</b>"}]))
    assert a2ui.contract_errors(surface([{**root, "text": "see https://example.test"}]))
    assert a2ui.contract_errors(surface([{**root, "text": "<img src=x onerror=alert(1)>"}]))
    assert a2ui.contract_errors(surface([{**root, "text": {"@call": "openUrl", "args": {"url": "x"}}}]))
    assert a2ui.contract_errors(surface([{**root, "id": "bad-id"}]))
    assert a2ui.contract_errors(surface([{"id": "other", "component": "Text", "text": "no root"}]))
    assert a2ui.contract_errors(surface([root], sendDataModel=True))
    assert a2ui.contract_errors(
        [
            {
                "version": "1.0",
                "createSurface": {
                    "surfaceId": "s_1",
                    "catalogId": "https://evil.test/c",
                    "components": [root],
                },
            }
        ]
    )
    assert a2ui.contract_errors(
        [
            {
                "version": "0.9",
                "createSurface": {"surfaceId": "s_1", "catalogId": a2ui.CATALOG_ID, "components": [root]},
            }
        ]
    )


# -- actions ----------------------------------------------------------------------------------------------
REFINE = {
    "measure": ["engaged_hcps"],
    "group": ["month"],
    "territory": ["T01-01"],
    "from": "2026-08-06",
    "to": "2026-11-03",
}


@pytest.mark.asyncio
async def test_an_action_runs_exactly_the_query_it_names_and_the_model_only_words_it(
    settings, repository
) -> None:
    seen: list[RunContext] = []

    def factory(ctx: RunContext, invocation: Invocation) -> ScriptedAgent:
        seen.append(ctx)
        return ScriptedAgent(ctx, ["Engaged HCPs by month are shown."])

    writer = RecordingWriter()
    agent = MslAgent(settings, repository, writer, agent_factory=factory)
    events = await collect(agent, action_invocation(REFINE))

    [visual] = [e["value"] for e in events if e.get("name") == "visual"]
    assert (visual["metric"], visual["scope"]) == ("engaged_hcps", "T01-01")
    assert visual["kind"] == "line" and visual["period"].startswith("2026-08-06")
    assert seen[0].answer_precomputed  # the model is given no data tools for this turn
    # The question saved and shown to the model is the one the validated action stands for.
    assert (
        writer.turns[0].user_message
        == "How many engaged HCPs by month in territory T01-01 from 2026-08-06 to 2026-11-03?"
    )
    # The next form keeps the person's choices.
    [form] = by_slot(events, "follow_up")
    assert form["dataModel"] == {
        "measure": ["engaged_hcps"],
        "group": ["month"],
        "from": "2026-08-06",
        "to": "2026-11-03",
        "territory": ["T01-01"],
    }


def test_a_precomputed_turn_offers_the_model_no_data_tools(settings, repository) -> None:
    agent = MslAgent(settings, repository)
    ctx = RunContext(make_invocation().identity, repository, run_id="run-1")
    ctx.answer_precomputed = True
    ctx.tool_results.append('{"status":"ok","distinct_calls":2}')
    model_agent = agent._bedrock_agent(ctx, make_invocation())
    assert model_agent.tool_names == ["suggest_follow_ups"]
    assert '"distinct_calls":2' in model_agent.system_prompt


@pytest.mark.asyncio
async def test_an_action_for_a_territory_outside_scope_reads_nothing(settings, repository) -> None:
    agent, writer = runtime(settings, repository, ["unused"])
    events = await collect(agent, action_invocation({**REFINE, "territory": ["T02-01"]}))
    text = "".join(e.get("delta", "") for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")
    assert "outside this user's scope" in text
    assert not [e for e in events if e.get("name") in ("visual", "source_facts")] and surfaces(events) == []
    assert writer.turns == []


@pytest.mark.parametrize(
    "context",
    [
        {**REFINE, "measure": ["revenue"]},
        {**REFINE, "group": ["call_type"]},
        {**REFINE, "territory": ["T01-01'; DROP TABLE x;--"]},
        {**REFINE, "from": "2026-11-04", "to": "2026-11-03"},
        {**REFINE, "from": "2020-01-01", "to": "2026-11-03"},
        {**REFINE, "from": "yesterday"},
        {**REFINE, "measure": ["calls", "responses"]},
        {**REFINE, "extra": "x"},
    ],
)
@pytest.mark.asyncio
async def test_an_action_outside_the_closed_lists_is_refused_before_any_query(
    settings, repository, context
) -> None:
    agent, _ = runtime(settings, repository, ["unused"])
    events = await collect(agent, action_invocation(context))
    text = "".join(e.get("delta", "") for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")
    assert text == REFINE_REFUSAL
    assert not [e for e in events if e.get("name") in ("visual", "source_facts")] and surfaces(events) == []


@pytest.mark.asyncio
async def test_an_unknown_action_name_is_refused(settings, repository) -> None:
    agent, _ = runtime(settings, repository, ["unused"])
    events = await collect(agent, action_invocation(REFINE, name="delete_everything"))
    assert REFINE_REFUSAL in "".join(
        e.get("delta", "") for e in events if e["type"] == "TEXT_MESSAGE_CONTENT"
    )


@pytest.mark.asyncio
async def test_an_executive_action_stays_aggregate_and_cannot_name_a_territory(settings, repository) -> None:
    agent, _ = runtime(settings, repository, ["Calls by region are shown."])
    context = {"measure": ["calls"], "group": ["region"], "from": "2026-08-06", "to": "2026-11-03"}
    events = await collect(agent, action_invocation(context, user_id=EXECUTIVE, persona="Executive"))
    [visual] = [e["value"] for e in events if e.get("name") == "visual"]
    assert visual["visual_id"].startswith("refine-")
    assert "Sample limitations" in "".join(
        e.get("delta", "") for e in events if e["type"] == "TEXT_MESSAGE_CONTENT"
    )

    refused = await collect(
        agent, action_invocation({**context, "territory": ["T01-01"]}, user_id=EXECUTIVE, persona="Executive")
    )
    assert REFINE_REFUSAL in "".join(
        e.get("delta", "") for e in refused if e["type"] == "TEXT_MESSAGE_CONTENT"
    )


@pytest.mark.asyncio
async def test_an_action_works_with_the_local_stub_model(stub_settings, repository) -> None:
    agent = MslAgent(
        stub_settings, repository, agent_factory=lambda ctx, inv: ScriptedAgent(ctx, ["Stub text."])
    )
    events = await collect(agent, action_invocation({**REFINE, "group": ["total"]}))
    facts = [e["value"] for e in events if e.get("name") == "source_facts"]
    assert facts and facts[0]["facts"][1]["label"] == "Engaged HCPs"
    [form] = by_slot(events, "follow_up")
    assert form["dataModel"]["measure"] == ["engaged_hcps"] and form["dataModel"]["group"] == ["total"]


def test_surfaces_are_saved_with_the_turn_as_dynamodb_safe_values(repository) -> None:
    ctx = RunContext(make_invocation().identity, repository, run_id="run-1")
    tools = {t.tool_name: t for t in build_tools(ctx)}
    tools["get_topic_trends"]()
    from msl_agent.writes import ConversationTurn

    item = item_for(
        ConversationTurn(
            identity=ctx.identity,
            thread_id="t",
            run_id="run-1",
            user_message="q",
            assistant_text="a",
            surfaces=ctx.surfaces,
        )
    )
    assert item["surfaces"][0][0]["createSurface"]["dataModel"]["rows"][0]["latest"] == 72


@pytest.mark.asyncio
async def test_an_executive_action_for_a_single_day_is_refused_as_the_typed_question_is(
    settings, repository
) -> None:
    agent, _ = runtime(settings, repository, ["unused"])
    context = {"measure": ["calls"], "group": ["territory"], "from": "2026-10-05", "to": "2026-10-05"}
    events = await collect(agent, action_invocation(context, user_id=EXECUTIVE, persona="Executive"))
    assert REFINE_REFUSAL in "".join(
        e.get("delta", "") for e in events if e["type"] == "TEXT_MESSAGE_CONTENT"
    )
    assert not [e for e in events if e.get("name") in ("visual", "source_facts")]


def test_the_territory_picker_never_exceeds_the_catalogs_option_limit() -> None:
    many = [f"T{i // 10 + 1:02d}-{i % 10 + 1:02d}" for i in range(40)]
    request = a2ui.RefineRequest("calls", "total", "2026-08-06", "2026-11-03", territory_id="T04-10")
    [operation] = a2ui.refine_surface("refine_1_r", request, territories=many, data_through=None)
    picker = component(operation["createSurface"], "territory")
    values = [o["value"] for o in picker["options"]]
    assert (
        len(values)
        <= CATALOG["components"]["ChoicePicker"]["properties"]["options"]["maxItems"]
        == a2ui.MAX_OPTIONS
    )
    assert "T04-10" in values and a2ui.contract_errors([operation]) == []
    picker["options"].append({"label": "x", "value": "x"})
    assert a2ui.contract_errors([operation])


def test_the_period_limit_is_the_read_queries_own() -> None:
    from msl_agent.repository import MAX_RANGE_DAYS

    longest = {"measure": ["calls"], "group": ["total"], "from": "2023-11-01", "to": "2026-11-03"}
    assert (a2ui.parse_refine_action("refine_answer", longest, executive=False) is not None) == (
        (dt.date(2026, 11, 3) - dt.date(2023, 11, 1)).days <= MAX_RANGE_DAYS
    )


def test_the_pre_1_0_call_spelling_counts_as_a_function_call() -> None:
    op = [
        {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "s_1",
                "catalogId": a2ui.CATALOG_ID,
                "components": [{"id": "root", "component": "Text", "text": {"call": "openUrl", "args": {}}}],
            },
        }
    ]
    assert a2ui.contract_errors(op)
