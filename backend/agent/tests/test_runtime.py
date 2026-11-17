"""Event order, deterministic facts, scope refusals and persistence, with a scripted model."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from conftest import make_invocation

from msl_agent.agent import MslAgent
from msl_agent.app import create_app
from msl_agent.schemas import Message
from msl_agent.tools import RunContext, build_tools
from msl_agent.writes import ConversationTurn


class ScriptedAgent:
    """Stands in for the Strands Agent: calls real tools, then streams a fixed answer."""

    def __init__(self, ctx: RunContext, steps: list[Any]) -> None:
        self.ctx = ctx
        self.steps = steps
        self.tools = {t.tool_name: t for t in build_tools(ctx)}

    async def stream_async(self, prompt: str) -> AsyncIterator[dict[str, Any]]:
        for step in self.steps:
            if isinstance(step, tuple):  # ("tool", name, kwargs)
                _, name, kwargs = step
                yield {"current_tool_use": {"toolUseId": f"t-{name}", "name": name, "input": ""}}
                extra = (
                    {"tool_context": SimpleNamespace(agent=None, tool_use={"toolUseId": f"t-{name}"})}
                    if name in ("suggest_follow_ups", "show_chart", "show_answer_distribution", "get_executive_activity")
                    else {}
                )
                self.tools[name](**kwargs, **extra)
                yield {
                    "message": {
                        "role": "user",
                        "content": [
                            {"toolResult": {"toolUseId": f"t-{name}", "status": "success", "content": []}}
                        ],
                    }
                }
            else:
                yield {"data": step}


class RecordingWriter:
    def __init__(self, ok: bool = True) -> None:
        self.turns: list[ConversationTurn] = []
        self.ok = ok

    def save_turn(self, turn: ConversationTurn) -> bool:
        self.turns.append(turn)
        return self.ok


def runtime(settings, repository, steps, writer=None) -> tuple[MslAgent, RecordingWriter]:
    writer = writer or RecordingWriter()
    agent = MslAgent(settings, repository, writer, agent_factory=lambda ctx, inv: ScriptedAgent(ctx, steps))
    return agent, writer


async def collect(agent: MslAgent, invocation) -> list[dict[str, Any]]:
    return [event async for event in agent.run(invocation)]


def names(events: list[dict[str, Any]]) -> list[str]:
    return [e["name"] if e["type"] == "CUSTOM" else e["type"] for e in events]


def test_non_executive_model_tools_do_not_offer_executive_only_refusals(repository) -> None:
    ordinary = {tool.tool_name for tool in build_tools(RunContext(make_invocation().identity, repository), for_model=True)}
    executive = {
        tool.tool_name
        for tool in build_tools(RunContext(make_invocation("exec-1", "Executive").identity, repository), for_model=True)
    }

    assert {"get_executive_activity", "get_org_themes", "get_region_topic_matrix"}.isdisjoint(ordinary)
    assert {"get_executive_activity", "get_org_themes", "get_region_topic_matrix"} <= executive
    assert "get_activity_summary" in ordinary and "get_activity_summary" in executive


@pytest.mark.asyncio
async def test_streams_facts_then_text_then_suggestions(settings, repository) -> None:
    steps = [
        ("tool", "get_activity_summary", {}),
        "You had ",
        "2 calls.",
        ("tool", "suggest_follow_ups", {"questions": ["Which territories can I see?"]}),
    ]
    agent, writer = runtime(settings, repository, steps)
    events = await collect(agent, make_invocation())

    order = [n for n in names(events) if n != "STATE_SNAPSHOT"]  # progress state is covered in test_page_state.py
    assert order[:2] == ["RUN_STARTED", "model_mode"]
    assert order.index("source_facts") < order.index("TEXT_MESSAGE_START")
    assert order[-1] == "RUN_FINISHED"
    assert order[-5:-1] == ["computed_figures", "number_check", "suggestions", "conversation_saved"]
    assert [e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT"] == ["You had ", "2 calls."]

    facts = next(e for e in events if e.get("name") == "source_facts")["value"]["facts"]
    assert {f["label"]: f["value"] for f in facts}["Distinct calls"] == 2
    cites = next(e for e in events if e.get("name") == "citations")["value"]
    assert {c["record_id"] for c in cites} == {"CALL-00001", "CALL-08761"}
    assert next(e for e in events if e.get("name") == "number_check")["value"]["status"] == "verified"
    assert next(e for e in events if e.get("name") == "suggestions")["value"] == [
        "Which territories can I see?"
    ]

    [turn] = writer.turns
    assert turn.identity.user_id == "msl-t01-01"
    assert turn.assistant_text == "You had 2 calls."
    assert turn.data_through is not None and turn.facts and turn.citations


@pytest.mark.asyncio
async def test_a_number_the_model_invented_is_flagged(settings, repository) -> None:
    agent, writer = runtime(settings, repository, [("tool", "get_activity_summary", {}), "You had 7 calls."])
    events = await collect(agent, make_invocation())
    check = next(e for e in events if e.get("name") == "number_check")["value"]
    assert check == {"status": "unverified", "count": 1, "checked": True}
    assert writer.turns[0].unverified_numbers == ["7"]


@pytest.mark.asyncio
async def test_quantitative_fallback_repairs_a_model_that_skips_an_activity_tool(settings, repository) -> None:
    agent, writer = runtime(settings, repository, ["I could not get that count."])
    events = await collect(
        agent,
        make_invocation(question="How many distinct calls did I have about osimertinib between 2026-10-01 and 2026-10-31?"),
    )

    facts = next(e for e in events if e.get("name") == "source_facts")["value"]["facts"]
    assert {fact["label"]: fact["value"] for fact in facts}["Distinct calls (osimertinib)"] == 2
    assert "The verified count is 2 calls for 2026-10-01 to 2026-10-31." in writer.turns[0].assistant_text
    assert writer.turns[0].unverified_numbers == []


@pytest.mark.asyncio
async def test_quantitative_fallback_repairs_a_model_that_skips_a_question_breakdown(settings, repository) -> None:
    agent, writer = runtime(settings, repository, ["The lookup failed, so I cannot provide that percentage."])
    events = await collect(
        agent,
        make_invocation(
            question='What percentage of the responses to Q-0013 were “Yes”, between 2026-10-01 and 2026-10-31?'
        ),
    )

    assert "visual" in names(events)
    assert "55.2%" in writer.turns[0].assistant_text
    assert '16 "Yes" responses out of 29 responses' in writer.turns[0].assistant_text
    assert writer.turns[0].unverified_numbers == []


@pytest.mark.asyncio
async def test_quantitative_fallback_uses_response_search_for_a_quoted_theme_count(settings, repository) -> None:
    agent, writer = runtime(settings, repository, ["I could not retrieve the matching response count."])
    events = await collect(
        agent,
        make_invocation(
            question="What are HCPs saying about osimertinib between 2026-10-01 and 2026-10-31? Quote one recorded response and say how many matched."
        ),
    )

    facts = next(e for e in events if e.get("name") == "source_facts")["value"]["facts"]
    assert {fact["label"]: fact["value"] for fact in facts}["Responses matching “osimertinib”"] == 1
    assert "The verified count is 1 matching responses about osimertinib" in writer.turns[0].assistant_text
    assert writer.turns[0].citations and writer.turns[0].unverified_numbers == []


@pytest.mark.asyncio
async def test_qualitative_fallback_uses_the_theme_path_not_activity_facts(settings, repository) -> None:
    agent, writer = runtime(settings, repository, ["I could not retrieve the recorded perspectives."])
    events = await collect(agent, make_invocation(question="What are the main concerns of HCPs?"))

    facts = [fact for event in events if event.get("name") == "source_facts" for fact in event["value"]["facts"]]
    labels = {fact["label"] for fact in facts}
    assert "Free-text responses in the latest period" in labels
    assert "Responses matching “concern”" in labels
    assert not any(label.startswith("Distinct calls") for label in labels)
    assert "verified recorded-response themes" in writer.turns[0].assistant_text
    assert writer.turns[0].citations


@pytest.mark.asyncio
async def test_quantitative_fallback_inherits_the_question_window_for_a_percentage_follow_up(settings, repository) -> None:
    agent, writer = runtime(settings, repository, ["The question breakdown was unavailable."])
    invocation = make_invocation(question='And what percent said "No"?').model_copy(
        update={
            "messages": [
                Message(
                    role="user",
                    content='What percentage of Q-0013 responses were “Yes” between 2026-10-01 and 2026-10-31?',
                ),
                Message(role="assistant", content="The earlier answer was unavailable."),
                Message(role="user", content='And what percent said "No"?'),
            ]
        }
    )

    await collect(agent, invocation)

    assert "34.5%" in writer.turns[0].assistant_text
    assert '10 "No" responses out of 29 responses' in writer.turns[0].assistant_text
    assert writer.turns[0].unverified_numbers == []


@pytest.mark.asyncio
async def test_out_of_scope_territory_returns_no_data(settings, repository) -> None:
    steps = [
        ("tool", "get_activity_summary", {"territory_id": "T02-01"}),
        "That territory is outside your scope.",
    ]
    agent, writer = runtime(settings, repository, steps)
    events = await collect(agent, make_invocation())
    assert "source_facts" not in names(events)
    assert "citations" not in names(events)
    assert writer.turns[0].facts == [] and writer.turns[0].citations == []


@pytest.mark.asyncio
async def test_named_foreign_territory_is_refused_before_the_model_can_fall_back_to_local_data(settings, repository) -> None:
    agent, writer = runtime(settings, repository, [("tool", "get_activity_summary", {}), "You had 2 calls."])
    events = await collect(agent, make_invocation(question="How many calls did territory T02-01 have in October?"))
    text = "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")
    assert "outside this user's scope" in text
    assert "source_facts" not in names(events) and "citations" not in names(events)
    assert writer.turns == []


@pytest.mark.asyncio
async def test_aggregate_only_persona_gets_no_record_level_facts(settings, repository) -> None:
    agent, _ = runtime(
        settings, repository, [("tool", "get_activity_summary", {}), "Not available for your role."]
    )
    events = await collect(agent, make_invocation("exec-1", "Executive"))
    assert "source_facts" not in names(events)


@pytest.mark.asyncio
async def test_executive_foreign_territory_is_refused_before_aggregate_data_can_be_misattributed(settings, repository) -> None:
    agent, writer = runtime(
        settings,
        repository,
        [("tool", "get_executive_activity", {"metric": "calls", "group_by": "territory"}), "There were 48 calls."],
    )
    events = await collect(
        agent,
        make_invocation(
            "executive-region-01",
            "Executive",
            "How many calls did territory T02-01 have between 2026-10-01 and 2026-10-31?",
        ),
    )

    text = "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")
    assert "outside this user's scope" in text
    assert "source_facts" not in names(events) and "citations" not in names(events)
    assert writer.turns == []


@pytest.mark.asyncio
async def test_stub_mode_still_attaches_deterministic_facts(stub_settings, repository) -> None:
    agent, writer = runtime(stub_settings, repository, ["Floci stub response for model=m"])
    events = await collect(agent, make_invocation())
    assert next(e for e in events if e.get("name") == "model_mode")["value"] == {"mode": "stub"}
    assert next(e for e in events if e.get("name") == "number_check")["value"]["checked"] is False
    assert writer.turns[0].facts[0].value == 2
    assert next(e for e in events if e.get("name") == "suggestions")["value"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("user_id", "persona"),
    [
        ("msl-t01-01", "MSL"),
        ("director-region-01", "Director"),
        ("executive-region-01", "Executive"),
        ("admin-1", "Administrator"),
    ],
)
@pytest.mark.parametrize(
    "question",
    ["hi", "Hi there", "Thanks, that's helpful", "What can you do today?"],
)
async def test_stub_small_talk_never_attaches_data_or_visuals(stub_settings, repository, user_id, persona, question) -> None:
    agent, writer = runtime(stub_settings, repository, ["Floci stub response for model=m"])

    events = await collect(agent, make_invocation(user_id, persona, question))

    event_names = names(events)
    assert "source_facts" not in event_names
    assert "citations" not in event_names
    assert "row_sets" not in event_names
    assert "visual" not in event_names
    assert writer.turns[0].facts == []
    assert writer.turns[0].citations == []
    assert writer.turns[0].visuals == []
    assert "Floci stub" not in writer.turns[0].assistant_text


@pytest.mark.asyncio
async def test_stub_routes_a_vague_activity_question_but_leaves_other_plain_language_to_the_model(stub_settings, repository) -> None:
    activity_agent, activity_writer = runtime(stub_settings, repository, ["Floci stub response for model=m"])
    activity_events = await collect(activity_agent, make_invocation(question="How am I doing?"))

    assert "source_facts" in names(activity_events)
    assert activity_writer.turns[0].facts

    conversational_agent, conversational_writer = runtime(stub_settings, repository, ["Floci stub response for model=m"])
    conversational_events = await collect(conversational_agent, make_invocation(question="Tell me something interesting."))

    assert "source_facts" not in names(conversational_events)
    assert conversational_writer.turns[0].facts == []

    executive_agent, executive_writer = runtime(stub_settings, repository, ["Floci stub response for model=m"])
    executive_events = await collect(
        executive_agent,
        make_invocation("executive-region-01", "Executive", "Tell me something interesting."),
    )

    assert "source_facts" not in names(executive_events)
    assert executive_writer.turns[0].facts == []


@pytest.mark.asyncio
async def test_stub_routes_a_qualitative_hcp_question_to_scoped_recorded_responses(stub_settings, repository) -> None:
    agent, writer = runtime(stub_settings, repository, ["Floci stub response for model=m"])
    events = await collect(agent, make_invocation(question="What are HCPs saying about osimertinib?"))

    facts = next(event for event in events if event.get("name") == "source_facts")["value"]["facts"]
    assert facts[0]["label"] == "Responses matching “osimertinib”"
    assert writer.turns[0].citations


@pytest.mark.asyncio
async def test_model_failure_ends_with_a_generic_run_error(settings, repository) -> None:
    class Boom:
        async def stream_async(self, prompt: str):
            raise RuntimeError("secret row value 123")
            yield {}

    agent = MslAgent(settings, repository, RecordingWriter(), agent_factory=lambda c, i: Boom())
    events = await collect(agent, make_invocation())
    assert events[-1]["type"] == "RUN_ERROR"
    assert "secret" not in json.dumps(events)


@pytest.mark.asyncio
async def test_http_contract_streams_sse(settings, repository) -> None:
    agent, _ = runtime(settings, repository, [("tool", "get_activity_summary", {}), "Done."])
    app = create_app(settings, runtime=agent)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/ping")).json() == {"status": "ok"}
        resp = await client.post("/invocations", json=make_invocation().model_dump())
        bad = await client.post(
            "/invocations",
            json={**make_invocation().model_dump(), "messages": [{"role": "assistant", "content": "hi"}]},
        )
    assert resp.headers["content-type"].startswith("text/event-stream")
    events = [
        json.loads(line.removeprefix("data: "))
        for line in resp.text.splitlines()
        if line.startswith("data: ")
    ]
    assert events[0]["type"] == "RUN_STARTED" and events[-1]["type"] == "RUN_FINISHED"
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_evaluation_threads_are_not_saved_as_conversation_history(settings, repository) -> None:
    """The eval panel asks as a seeded subject; those turns must not appear in that person's history."""
    agent, writer = runtime(settings, repository, [("tool", "get_activity_summary", {}), "You had 2 calls."])
    invocation = make_invocation().model_copy(update={"thread_id": "eval-20261104120000-ab12cd34-00"})
    events = await collect(agent, invocation)
    assert writer.turns == []
    assert next(e for e in events if e.get("name") == "conversation_saved")["value"] == {"saved": False}
    assert events[-1]["type"] == "RUN_FINISHED"


@pytest.mark.asyncio
async def test_computed_figures_list_what_the_tools_returned(settings, repository) -> None:
    agent, _ = runtime(settings, repository, [("tool", "get_activity_summary", {}), "You had 2 calls."])
    events = await collect(agent, make_invocation())
    figures = next(e for e in events if e.get("name") == "computed_figures")["value"]["figures"]
    assert "2" in figures and all(isinstance(f, str) for f in figures)


def _activity_chain_history() -> list[Message]:
    """The golden activity chain up to its last turn: October first, then September, then a Q3 product count."""
    return [
        Message(role="user", content="How many distinct calls did I have between 2026-10-01 and 2026-10-31?"),
        Message(role="assistant", content="You had 2 distinct calls between 2026-10-01 and 2026-10-31."),
        Message(role="user", content="And between 2026-09-01 and 2026-09-30?"),
        Message(role="assistant", content="You had 1 distinct call between 2026-09-01 and 2026-09-30."),
        Message(role="user", content="And for the third quarter, 2026-07-01 to 2026-09-30, the same count?"),
        Message(role="assistant", content="You had 1 distinct call between 2026-07-01 and 2026-09-30."),
        Message(role="user", content="Which month of that quarter had the most such calls?"),
        Message(role="assistant", content="September had the most."),
    ]


@pytest.mark.asyncio
async def test_quantitative_fallback_resolves_go_back_to_my_first_question_to_that_questions_period(
    settings, repository
) -> None:
    # A model that answers a back-reference from memory, with no tool call, must not have its
    # figure "verified" against the most recent intervening period (the third quarter).
    question = "Go back to my very first question: how many distinct calls was that in October, across all products?"
    agent, writer = runtime(settings, repository, ["That was the October count from earlier."])
    invocation = make_invocation(question=question).model_copy(
        update={"messages": [*_activity_chain_history(), Message(role="user", content=question)]}
    )

    await collect(agent, invocation)

    assert "for 2026-10-01 to 2026-10-31." in writer.turns[0].assistant_text
    assert "2026-07-01" not in writer.turns[0].assistant_text


@pytest.mark.parametrize(
    ("question", "window"),
    [
        # A named month in this turn wins over a more recent turn's dates; the year comes from context.
        ("How many distinct calls was that in October, across all products?", ("2026-10-01", "2026-10-31")),
        # A reference to the first question takes that question's period, not the latest one.
        ("Finally, back to my first question: how many distinct calls was that?", ("2026-10-01", "2026-10-31")),
        ("Back to my original question: how many calls?", ("2026-10-01", "2026-10-31")),
        # Without either, the most recent stated period still applies.
        ("And how many calls was that again?", ("2026-07-01", "2026-09-30")),
        # Explicit dates in this turn always win.
        ("How many calls between 2026-08-01 and 2026-08-31?", ("2026-08-01", "2026-08-31")),
        # "may" as a verb is not the month of May.
        ("How many calls may I count for that quarter?", ("2026-07-01", "2026-09-30")),
    ],
)
def test_conversation_window_resolves_references_to_earlier_turns(question, window) -> None:
    history = [message.content for message in _activity_chain_history()]

    tool, arguments = MslAgent._quantitative_fallback_request(question, history)

    assert tool == "get_activity_summary"
    assert (arguments["from_date"], arguments["to_date"]) == window


def assert_valid_ag_ui(events: list[dict[str, Any]]) -> None:
    """The rules the AG-UI client verifier applies before CopilotKit sees a run (docs/adr/0018)."""
    assert events[0]["type"] == "RUN_STARTED"
    assert events[-1]["type"] in ("RUN_FINISHED", "RUN_ERROR")
    assert all(e["type"] not in ("RUN_FINISHED", "RUN_ERROR") for e in events[:-1])
    texts: set[str] = set()
    tools: set[str] = set()
    ended: set[str] = set()
    for e in events:
        kind = e["type"]
        if kind == "TEXT_MESSAGE_START":
            assert e["messageId"] not in texts
            texts.add(e["messageId"])
        elif kind in ("TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"):
            assert e["messageId"] in texts
            if kind == "TEXT_MESSAGE_END":
                texts.discard(e["messageId"])
        elif kind == "TOOL_CALL_START":
            assert e["toolCallId"] not in tools and e["toolCallId"] not in ended
            tools.add(e["toolCallId"])
        elif kind == "TOOL_CALL_END":
            assert e["toolCallId"] in tools
            tools.discard(e["toolCallId"])
            ended.add(e["toolCallId"])
        elif kind == "TOOL_CALL_RESULT":
            assert e["toolCallId"] in ended and e["role"] == "tool" and isinstance(e["content"], str)
    assert not texts and not tools, "the run ended with a text message or a tool call still open"


@pytest.mark.asyncio
async def test_every_tool_call_ends_with_a_result_that_carries_no_tool_output(settings, repository) -> None:
    steps = [("tool", "get_activity_summary", {}), "You had 2 calls.", ("tool", "suggest_follow_ups", {"questions": ["Which territories can I see?"]})]
    agent, _ = runtime(settings, repository, steps)
    events = await collect(agent, make_invocation())
    assert_valid_ag_ui(events)
    results = [e for e in events if e["type"] == "TOOL_CALL_RESULT"]
    assert [r["toolCallId"] for r in results] == ["t-get_activity_summary", "t-suggest_follow_ups"]
    assert {r["content"] for r in results} == {"complete"}
    order = [e["type"] for e in events]
    assert order.index("TOOL_CALL_RESULT") == order.index("TOOL_CALL_END") + 1


class _Abandoned:
    """A model that starts a tool call and never returns from it, then ends normally or fails."""

    def __init__(self, fail: bool) -> None:
        self.fail = fail

    async def stream_async(self, prompt: str):
        yield {"current_tool_use": {"toolUseId": "t-left-open", "name": "show_chart", "input": ""}}
        yield {"data": "Partial answer."}
        if self.fail:
            raise RuntimeError("secret row value 123")


@pytest.mark.asyncio
@pytest.mark.parametrize(("fail", "outcome"), [(False, "complete"), (True, "failed")])
async def test_a_tool_call_left_open_is_closed_before_the_run_ends(settings, repository, fail, outcome) -> None:
    agent = MslAgent(settings, repository, RecordingWriter(), agent_factory=lambda c, i: _Abandoned(fail))
    events = await collect(agent, make_invocation())
    assert_valid_ag_ui(events)
    assert events[-1]["type"] == ("RUN_ERROR" if fail else "RUN_FINISHED")
    [result] = [e for e in events if e["type"] == "TOOL_CALL_RESULT"]
    assert result["toolCallId"] == "t-left-open" and result["content"] == outcome
    assert "secret" not in json.dumps(events)
