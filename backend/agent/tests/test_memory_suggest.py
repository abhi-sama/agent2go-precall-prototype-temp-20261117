"""Suggested preferences (docs/adr/0023): the detectors, the filters, the rate limit and the run's events."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import make_invocation
from test_runtime import collect, runtime

from msl_agent.agent import MslAgent
from msl_agent.memory import check_preference
from msl_agent.memory_suggest import (
    ASK_NONE,
    ASK_REPLY,
    MIN_COUNT,
    is_suggestion_request,
    noticed,
    suggest_preferences,
    suggestion_key,
)
from msl_agent.schemas import Invocation

CASES = json.loads((Path(__file__).resolve().parents[2] / "agent_memory_suggestion_cases.json").read_text())
STEPS = ["The answer."]
DATE_ASKS = [{"role": "user", "content": "calls in the last 90 days"}, {"role": "assistant", "content": "ok"}, {"role": "user", "content": "HCPs in the last 90 days"}, {"role": "assistant", "content": "ok"}]


@pytest.mark.parametrize("case", CASES["noticed"], ids=lambda c: c["name"])
def test_what_the_person_keeps_asking_for_is_noticed(case) -> None:
    assert [[s.text, s.category, s.reason] for s in noticed(case["messages"])] == case["expect"]


def test_every_noticed_text_passes_the_memory_guard() -> None:
    for case in CASES["noticed"]:
        for suggestion in noticed(case["messages"]):
            assert check_preference(suggestion.text) is None


@pytest.mark.parametrize("entry", CASES["keys"])
def test_a_dismissal_key_ignores_case_and_spacing(entry) -> None:
    assert suggestion_key(entry["text"]) == entry["key"] and len(entry["key"]) == 16


@pytest.mark.parametrize("question", CASES["asks"]["yes"])
def test_asking_what_the_agent_noticed_is_recognised(question: str) -> None:
    assert is_suggestion_request(question)


@pytest.mark.parametrize("question", CASES["asks"]["no"])
def test_ordinary_questions_are_not_a_request_to_suggest(question: str) -> None:
    assert not is_suggestion_request(question)


def test_what_is_remembered_or_dismissed_is_not_offered_again() -> None:
    messages = ["last 90 days"] * MIN_COUNT
    assert [s.text for s in suggest_preferences(messages, [], [])] == ["Default to the last 90 days"]
    assert suggest_preferences(messages, [{"text": "default to the LAST 90 days", "category": "DATE_RANGE"}], []) == []
    assert suggest_preferences(messages, [], [suggestion_key("Default to the last 90 days")]) == []
    # Junk in either list is ignored, never an error.
    assert len(suggest_preferences(messages, ["x", None, {"text": 4}], [None, 7])) == 1


# The agent's runs.


def _invocation(question: str, **extra) -> Invocation:
    """A conversation that has asked for the last 90 days twice, then asks ``question``."""
    messages = [*DATE_ASKS, {"role": "user", "content": question}]
    return Invocation.model_validate({**make_invocation(question=question).model_dump(), "messages": messages, **extra})


def _suggestions(events: list[dict]) -> list[dict]:
    return [e["value"] for e in events if e["type"] == "CUSTOM" and e["name"] == "memory_suggestion"]


@pytest.mark.asyncio
async def test_a_third_ask_ends_the_answer_with_one_suggestion_before_the_run_finishes(settings, repository) -> None:
    agent, writer = runtime(settings, repository, STEPS)
    events = await collect(agent, _invocation("calls in the last 90 days again"))
    assert _suggestions(events) == [{"text": "Default to the last 90 days", "category": "DATE_RANGE", "reason": "You asked for the last 90 days 3 times."}]
    assert events[-1]["type"] == "RUN_FINISHED"
    assert events.index(next(e for e in events if e.get("name") == "memory_suggestion")) > events.index(next(e for e in events if e.get("name") == "conversation_saved"))
    assert len(writer.turns) == 1  # the answer is saved; the suggestion saves nothing


@pytest.mark.asyncio
async def test_two_asks_are_not_a_habit(settings, repository) -> None:
    agent, _ = runtime(settings, repository, STEPS)
    assert _suggestions(await collect(agent, _invocation("calls this month"))) == []


@pytest.mark.asyncio
async def test_at_most_one_suggestion_per_conversation(settings, repository) -> None:
    agent, _ = runtime(settings, repository, STEPS)
    assert _suggestions(await collect(agent, _invocation("calls in the last 90 days", memory_offered=True))) == []


@pytest.mark.asyncio
async def test_a_dismissed_or_remembered_suggestion_is_not_offered(settings, repository) -> None:
    agent, _ = runtime(settings, repository, STEPS)
    key = suggestion_key("Default to the last 90 days")
    assert _suggestions(await collect(agent, _invocation("calls in the last 90 days", memory_dismissed=[key]))) == []
    remembered = [{"text": "Default to the last 90 days", "category": "DATE_RANGE"}]
    assert _suggestions(await collect(agent, _invocation("calls in the last 90 days", memory=remembered))) == []


@pytest.mark.asyncio
async def test_no_suggestion_on_a_direct_reply_a_form_action_or_an_evaluation_run(settings, repository) -> None:
    agent, _ = runtime(settings, repository, STEPS)
    assert _suggestions(await collect(agent, _invocation("hello"))) == []
    evaluation = _invocation("calls in the last 90 days").model_copy(update={"thread_id": "eval-1"})
    assert _suggestions(await collect(agent, evaluation)) == []


@pytest.mark.asyncio
async def test_asking_outright_ignores_the_one_per_conversation_limit_and_never_calls_the_model(settings, repository) -> None:
    def boom(*_a):
        raise AssertionError("the model must not run for a request to suggest preferences")

    agent = MslAgent(settings, repository, runtime(settings, repository, [])[1], agent_factory=boom)
    three_asks = _invocation("Responses for the last 90 days").messages[:-1] + [{"role": "user", "content": "Responses for the last 90 days"}, {"role": "assistant", "content": "ok"}]
    asking = Invocation.model_validate({**make_invocation().model_dump(), "memory_offered": True, "messages": [*three_asks, {"role": "user", "content": "What have you noticed about how I work?"}]})
    events = await collect(agent, asking)
    text = "".join(e.get("delta", "") for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")
    assert text == ASK_REPLY and [s["text"] for s in _suggestions(events)] == ["Default to the last 90 days"]
    assert events[-1]["type"] == "RUN_FINISHED" and events[-1]["outcome"] == {"type": "success"}


@pytest.mark.asyncio
async def test_asking_with_nothing_noticed_says_so(settings, repository) -> None:
    agent = MslAgent(settings, repository, runtime(settings, repository, [])[1], agent_factory=lambda *_a: pytest.fail("no model"))
    events = await collect(agent, make_invocation(question="suggest preferences"))
    assert "".join(e.get("delta", "") for e in events if e["type"] == "TEXT_MESSAGE_CONTENT") == ASK_NONE
    assert _suggestions(events) == []


def test_the_invocation_bounds_the_dismissed_keys() -> None:
    base = make_invocation().model_dump()
    assert Invocation.model_validate({**base, "memory_dismissed": ["0123456789abcdef"], "memory_offered": True}).memory_offered is True
    for bad in (["not-a-key"], ["0123456789abcdef"] * 51):
        with pytest.raises(ValueError):
            Invocation.model_validate({**base, "memory_dismissed": bad})
