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

    order = names(events)
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
async def test_aggregate_only_persona_gets_no_record_level_facts(settings, repository) -> None:
    agent, _ = runtime(
        settings, repository, [("tool", "get_activity_summary", {}), "Not available for your role."]
    )
    events = await collect(agent, make_invocation("exec-1", "Executive"))
    assert "source_facts" not in names(events)


@pytest.mark.asyncio
async def test_stub_mode_still_attaches_deterministic_facts(stub_settings, repository) -> None:
    agent, writer = runtime(stub_settings, repository, ["Floci stub response for model=m"])
    events = await collect(agent, make_invocation())
    assert next(e for e in events if e.get("name") == "model_mode")["value"] == {"mode": "stub"}
    assert next(e for e in events if e.get("name") == "number_check")["value"]["checked"] is False
    assert writer.turns[0].facts[0].value == 2
    assert next(e for e in events if e.get("name") == "suggestions")["value"]


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
