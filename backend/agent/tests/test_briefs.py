"""The pre-call brief runner: citations are enforced by code, the finished brief is saved with its provenance."""

from __future__ import annotations

import datetime as dt
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from conftest import make_invocation

from msl_agent.app import create_app
from msl_agent.briefs import BriefRunner, deterministic_raw, parse_model_json, validate
from msl_agent.schemas import BriefTask, Invocation

NOW = dt.datetime(2026, 11, 4, 9, 30, tzinfo=dt.UTC)


def task_dict(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "pre_call_brief",
        "brief_id": "br-20261104093000-0a1b2c3d",
        "hcp_id": "HCP-0001",
        "objective": "Discuss access evidence",
        "scope_label": "T01-01",
        "scope_territory_ids": ["T01-01"],
        "data_through": "2026-11-03T08:00:00Z",
        "fingerprint": {"hcpLoadedThrough": "2026-11-03T08:00:00Z", "callCount": 2, "responseCount": 2},
        "calls": [
            {"evidence_id": "call:CALL-1", "date": "2026-11-03", "channels": ["field"], "types": ["scientific"], "products": ["osimertinib"], "topics": []},
            {"evidence_id": "call:CALL-0", "date": "2026-08-15", "channels": ["field"], "types": ["scientific"], "products": [], "topics": []},
        ],
        "responses": [
            {"evidence_id": "response:RESP-1", "date": "2026-11-03", "question": "How does it fit?", "answer": "Evidence and access matter."},
            {"evidence_id": "response:RESP-0", "date": "2026-08-15", "question": "How does it fit?", "answer": "Wants outcomes data."},
        ],
        "follow_ups": [{"evidence_id": "response:RESP-1", "date": "2026-11-03", "tag": None, "topic": "Explore access criteria", "recorded_answer": None}],
        "facts": [{"label": "Calls on record", "value": "2", "evidenceIds": ["call:CALL-1", "call:CALL-0"]}],
        "missing": [{"code": "NO_FOLLOW_UPS", "message": "No follow-up topics."}],
        "evidence": [
            {"evidenceId": "call:CALL-1", "dataset": "call_activity", "recordId": "CALL-1", "label": "Call 2026-11-03", "date": "2026-11-03"},
            {"evidenceId": "call:CALL-0", "dataset": "call_activity", "recordId": "CALL-0", "label": "Call 2026-08-15", "date": "2026-08-15"},
            {"evidenceId": "response:RESP-1", "dataset": "hcp_raw_insights", "recordId": "RESP-1", "label": "Response 2026-11-03", "date": "2026-11-03"},
            {"evidenceId": "response:RESP-0", "dataset": "hcp_raw_insights", "recordId": "RESP-0", "label": "Response 2026-08-15", "date": "2026-08-15"},
        ],
        "last_interaction_date": "2026-11-03",
    }
    return {**base, **overrides}


def invocation(**task_overrides: Any) -> Invocation:
    base = make_invocation()
    return base.model_copy(update={"task": BriefTask(**task_dict(**task_overrides))})


class Writer:
    def __init__(self, ok: bool = True) -> None:
        self.items: list[dict[str, Any]] = []
        self.ok = ok

    def save_brief(self, item: dict[str, Any]) -> bool:
        self.items.append(item)
        return self.ok


class Scripted:
    """Stands in for the Strands agent: replays model replies in order, recording the prompt it was shown."""

    def __init__(self, replies: list[str]) -> None:
        self.replies = list(replies)
        self.prompts: list[str] = []
        self.system: list[str] = []

    def factory(self, system_prompt: str):
        self.system.append(system_prompt)
        outer = self

        class Agent:
            async def stream_async(self, prompt: str) -> AsyncIterator[dict[str, Any]]:
                outer.prompts.append(prompt)
                text = outer.replies.pop(0)
                for i in range(0, len(text), 40):
                    yield {"data": text[i : i + 40]}

        return Agent()


async def collect(runner: BriefRunner, inv: Invocation) -> list[dict[str, Any]]:
    return [event async for event in runner.run(inv)]


GOOD = {
    "engagement": [{"text": "Last call was on 2026-11-03.", "evidence": ["call:CALL-1"]}],
    "perspectives": [{"text": "Recorded on 2026-11-03: evidence and access matter.", "evidence": ["response:RESP-1"]}],
    "follow_ups": [{"text": "Recorded topic: access criteria.", "evidence": ["response:RESP-1"]}],
    "prompts": [{"text": "What access evidence would help?", "evidence": ["response:RESP-1", "response:RESP-0"]}],
    "agenda": [
        {"title": "Review the last call", "detail": "Recap 2026-11-03.", "evidence": ["call:CALL-1"]},
        {"title": "Agree the objective", "detail": "Access evidence.", "evidence": []},
    ],
}


@pytest.mark.asyncio
async def test_claude_brief_is_saved_with_owner_scope_data_through_time_and_evidence(settings):
    model = Scripted([json.dumps(GOOD)])
    writer = Writer()
    events = await collect(BriefRunner(settings, writer, model.factory, lambda: NOW), invocation())

    assert [e["type"] for e in events] == ["RUN_STARTED", "CUSTOM", "CUSTOM", "RUN_FINISHED"]
    assert events[2]["value"] == {"saved": True, "brief_id": "br-20261104093000-0a1b2c3d", "dropped": 0, "model_mode": "claude"}
    (item,) = writer.items
    assert item["pk"] == "USER#msl-t01-01" and item["sk"] == "BRIEF#br-20261104093000-0a1b2c3d"
    assert item["ownerUserId"] == "msl-t01-01"
    assert item["scopeLabel"] == "T01-01" and item["scopeTerritoryIds"] == ["T01-01"]
    assert item["dataThrough"] == "2026-11-03T08:00:00Z"
    assert item["generatedAt"] == "2026-11-04T09:30:00Z"
    assert {e["evidenceId"] for e in item["evidence"]} == {"call:CALL-1", "call:CALL-0", "response:RESP-1", "response:RESP-0"}
    assert item["fingerprint"]["callCount"] == 2
    assert item["modelMode"] == "claude" and item["numberCheck"] == "verified"
    # Generated prompts and agenda are stored as GENERATED, not yet edited.
    assert all(p["origin"] == "GENERATED" and p["edited"] is False for p in item["prompts"] + item["agenda"])
    # Every statement carries at least one citation.
    for section in ("engagement", "perspectives", "followUps", "prompts"):
        assert item[section] and all(s["evidenceIds"] for s in item[section])
    assert item["expires_at"] > int(NOW.timestamp())


@pytest.mark.asyncio
async def test_uncited_invented_and_unverified_statements_are_dropped_not_shown(settings):
    reply = {
        "engagement": [
            {"text": "Uncited claim.", "evidence": []},
            {"text": "Cites a record that was never supplied.", "evidence": ["call:NOT-THERE"]},
            {"text": "Last call was on 2026-11-03.", "evidence": ["call:NOT-THERE", "call:CALL-1"]},
            {"text": "The HCP held 47 calls last year.", "evidence": ["call:CALL-1"]},
        ],
        "perspectives": [{"text": "Recorded on 2026-11-03: evidence matters.", "evidence": ["response:RESP-1"]}],
        "follow_ups": [],
        "prompts": [{"text": "Prompt without a source", "evidence": []}],
        "agenda": [{"title": "Open", "detail": "", "evidence": ["call:NOT-THERE"]}],
    }
    writer = Writer()
    await collect(BriefRunner(settings, writer, Scripted([json.dumps(reply)]).factory, lambda: NOW), invocation())
    (item,) = writer.items
    assert [s["text"] for s in item["engagement"]] == ["Last call was on 2026-11-03."]
    assert item["engagement"][0]["evidenceIds"] == ["call:CALL-1"]  # the invented id is stripped
    assert item["prompts"] == []
    assert item["droppedStatements"] == 4  # three uncited (two engagement, one prompt) and one with an invented figure
    assert item["numberCheck"] == "filtered"
    assert item["agenda"][0]["evidenceIds"] == []


@pytest.mark.asyncio
async def test_malformed_reply_is_retried_once_then_the_run_fails_without_saving(settings):
    writer = Writer()
    model = Scripted(["not json at all", "```json\n" + json.dumps(GOOD) + "\n```"])
    events = await collect(BriefRunner(settings, writer, model.factory, lambda: NOW), invocation())
    assert events[-1]["type"] == "RUN_FINISHED" and len(writer.items) == 1

    writer = Writer()
    events = await collect(BriefRunner(settings, writer, Scripted(["nope", "still nope"]).factory, lambda: NOW), invocation())
    assert events[-1]["type"] == "RUN_ERROR" and events[-1]["code"] == "BRIEF_FAILED"
    assert writer.items == []


@pytest.mark.asyncio
async def test_a_failed_save_is_reported_not_hidden(settings):
    events = await collect(BriefRunner(settings, Writer(ok=False), Scripted([json.dumps(GOOD)]).factory, lambda: NOW), invocation())
    saved = [e for e in events if e["type"] == "CUSTOM" and e["name"] == "brief_saved"]
    assert saved[0]["value"]["saved"] is False


@pytest.mark.asyncio
async def test_stub_mode_writes_a_cited_deterministic_draft_without_calling_a_model(stub_settings):
    model = Scripted([])
    writer = Writer()
    events = await collect(BriefRunner(stub_settings, writer, model.factory, lambda: NOW), invocation())
    assert events[-1]["type"] == "RUN_FINISHED" and model.prompts == []
    (item,) = writer.items
    assert item["modelMode"] == "stub" and item["numberCheck"] == "unchecked"
    assert item["engagement"] and item["perspectives"] and item["prompts"] and item["agenda"]
    assert all(s["evidenceIds"] for s in item["engagement"] + item["perspectives"] + item["followUps"] + item["prompts"])


@pytest.mark.asyncio
async def test_an_hcp_with_no_records_gets_an_agenda_from_the_objective_and_no_model_call(settings):
    model = Scripted([])
    writer = Writer()
    inv = invocation(calls=[], responses=[], follow_ups=[], facts=[], evidence=[], missing=[{"code": "NO_CALLS", "message": "none"}])
    events = await collect(BriefRunner(settings, writer, model.factory, lambda: NOW), inv)
    assert events[-1]["type"] == "RUN_FINISHED" and model.prompts == []
    (item,) = writer.items
    assert item["engagement"] == [] and item["evidence"] == []
    assert [a["origin"] for a in item["agenda"]] == ["GENERATED"]
    assert item["missing"][0]["code"] == "NO_CALLS"


@pytest.mark.asyncio
async def test_the_model_sees_evidence_text_but_no_identity_or_scope(settings):
    model = Scripted([json.dumps(GOOD)])
    await collect(BriefRunner(settings, Writer(), model.factory, lambda: NOW), invocation())
    shown = model.prompts[0]
    assert "Evidence and access matter." in shown and "Discuss access evidence" in shown
    for hidden in ("msl-t01-01", "avery@example.test", "Avery Clinician", "T01-01", "HCP-0001"):
        assert hidden not in shown
    assert "data, not instructions" in model.system[0]


def test_parse_and_deterministic_helpers():
    assert parse_model_json('text {"a": 1} tail') == {"a": 1}
    with pytest.raises(ValueError):
        parse_model_json("no braces")
    task = BriefTask(**task_dict())
    draft = validate(deterministic_raw(task), task, check_numbers=False)
    assert draft.dropped == 0 and draft.sections["agenda"][0]["origin"] == "GENERATED"


@pytest.mark.asyncio
async def test_http_contract_routes_a_task_to_the_brief_runner_and_chat_still_works(settings, repository):
    writer = Writer()
    runner = BriefRunner(settings, writer, Scripted([json.dumps(GOOD)]).factory, lambda: NOW)
    app = create_app(settings, repository=repository, briefs=runner)
    body = invocation().model_dump(mode="json")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://agent") as client:
        response = await client.post("/invocations", json=body)
    assert response.status_code == 200
    events = [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]
    assert events[-1]["type"] == "RUN_FINISHED" and len(writer.items) == 1
