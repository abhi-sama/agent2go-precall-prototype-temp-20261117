"""The leadership summary runner: citations are enforced by code, the finished summary is saved with its provenance."""

from __future__ import annotations

import datetime as dt
import json
from decimal import Decimal
from typing import Any

import httpx
import pytest
from conftest import make_invocation
from test_briefs import GOOD as BRIEF_REPLY
from test_briefs import Scripted
from test_briefs import Writer as BriefWriter
from test_briefs import invocation as brief_invocation

from msl_agent.app import create_app
from msl_agent.briefs import BriefRunner
from msl_agent.schemas import Invocation, SummaryTask
from msl_agent.summaries import SummaryRunner, deterministic_raw, model_input, validate

NOW = dt.datetime(2026, 11, 4, 9, 30, tzinfo=dt.UTC)
SUMMARY_ID = "ls-20261104093000-0a1b2c3d"


def task_dict(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "leadership_summary",
        "summary_id": SUMMARY_ID,
        "title": "Leadership summary 2026-08-01 to 2026-10-31",
        "from_date": "2026-08-01",
        "to_date": "2026-10-31",
        "scope_label": "REGION-01 · REGION-02",
        "scope_territory_ids": ["T01-01", "T02-01"],
        "access_level": "AGGREGATE_ONLY",
        "data_through": "2026-11-03T08:00:00Z",
        "definition_version": "executive-themes-v1",
        "key_figures": [
            {"label": "Free-text responses", "value": {"value": 700, "suppressed": False}, "citationIds": ["agg:kpi:free-text"]},
            {"label": "Pulmonary responses", "value": {"value": None, "suppressed": True}, "citationIds": ["agg:theme:pulm"]},
        ],
        "facts": [
            {"fact_id": "f1", "section": "overview", "text": "700 free-text responses were recorded from 2026-08-01 to 2026-10-31.", "citation_ids": ["agg:kpi:free-text"]},
            {"fact_id": "f2", "section": "themes", "text": "ctDNA monitoring has 72 recorded responses, rising by the approved rule.", "citation_ids": ["agg:theme:ctdna"]},
            {"fact_id": "f3", "section": "crossRegion", "text": "ctDNA monitoring is rising in 2 regions.", "citation_ids": ["agg:theme:ctdna", "agg:matrix"]},
            {"fact_id": "f4", "section": "themes", "text": "A finding nobody can cite.", "citation_ids": []},
        ],
        "sample_limitations": ["Counts below 5 are withheld so no small group can be identified."],
        "definitions": [{"key": "responses", "label": "Responses", "text": "Recorded insight responses."}],
        "disclosure": {"minCell": 5, "text": "Counts below 5 are withheld.", "suppressedCells": 1, "applied": True},
        "evidence": [
            {"citationId": "agg:kpi:free-text", "kind": "AGGREGATE", "dataset": "hcp_raw_insights", "label": "All free-text responses", "responses": {"value": 700, "suppressed": False}},
            {"citationId": "agg:theme:ctdna", "kind": "AGGREGATE", "dataset": "hcp_raw_insights", "label": "ctDNA monitoring responses", "responses": {"value": 72, "suppressed": False}},
            {"citationId": "agg:theme:pulm", "kind": "AGGREGATE", "dataset": "hcp_raw_insights", "label": "Pulmonary responses", "responses": {"value": None, "suppressed": True}},
            {"citationId": "agg:matrix", "kind": "AGGREGATE", "dataset": "hcp_raw_insights", "label": "Topic by region matrix", "responses": {"value": 700, "suppressed": False}},
        ],
    }
    return {**base, **overrides}


def invocation(**overrides: Any) -> Invocation:
    base = make_invocation("executive-region-01", "Executive")
    return base.model_copy(update={"task": SummaryTask(**task_dict(**overrides))})


class Writer:
    def __init__(self, ok: bool = True) -> None:
        self.items: list[dict[str, Any]] = []
        self.ok = ok

    def save_item(self, item: dict[str, Any]) -> bool:
        self.items.append(item)
        return self.ok


async def collect(runner: Any, inv: Invocation) -> list[dict[str, Any]]:
    return [event async for event in runner.run(inv)]


GOOD = {
    "statements": [
        {"section": "overview", "text": "700 free-text responses were recorded from 2026-08-01 to 2026-10-31.", "evidence": ["agg:kpi:free-text"]},
        {"section": "themes", "text": "ctDNA monitoring has 72 recorded responses.", "evidence": ["agg:theme:ctdna"]},
        {"section": "themes", "text": "Pulmonary surveillance is withheld to protect a small group.", "evidence": ["agg:theme:pulm"]},
        {"section": "crossRegion", "text": "ctDNA monitoring is rising in 2 regions.", "evidence": ["agg:theme:ctdna", "agg:matrix"]},
    ]
}


@pytest.mark.asyncio
async def test_claude_summary_is_saved_with_owner_scope_period_and_evidence(settings):
    model, writer = Scripted([json.dumps(GOOD)]), Writer()
    events = await collect(SummaryRunner(settings, writer, model.factory, lambda: NOW), invocation())

    assert [e["type"] for e in events] == ["RUN_STARTED", "CUSTOM", "CUSTOM", "RUN_FINISHED"]
    assert events[2]["name"] == "summary_saved"
    assert events[2]["value"] == {"saved": True, "summary_id": SUMMARY_ID, "dropped": 0, "model_mode": "claude"}
    (item,) = writer.items
    assert item["pk"] == "USER#executive-region-01" and item["sk"] == f"SUMMARY#{SUMMARY_ID}"
    assert item["summaryId"] == SUMMARY_ID and item["ownerUserId"] == "executive-region-01" and item["persona"] == "Executive"
    assert (item["from"], item["to"]) == ("2026-08-01", "2026-10-31")
    assert item["scopeLabel"] == "REGION-01 · REGION-02" and item["scopeTerritoryIds"] == ["T01-01", "T02-01"]
    assert item["accessLevel"] == "AGGREGATE_ONLY" and item["definitionVersion"] == "executive-themes-v1"
    assert item["dataThrough"] == "2026-11-03T08:00:00Z" and item["generatedAt"] == item["updatedAt"] == "2026-11-04T09:30:00Z"
    assert item["modelMode"] == "claude" and item["numberCheck"] == "verified" and item["droppedStatements"] == 0
    assert item["sampleLimitations"] and item["definitions"] and item["disclosure"]["minCell"] == 5
    assert item["regeneratesSummaryId"] is None
    assert {c["citationId"] for c in item["citations"]} == {"agg:kpi:free-text", "agg:theme:ctdna", "agg:theme:pulm", "agg:matrix"}
    assert [s["statementId"] for s in item["statements"]] == ["s-o1", "s-t1", "s-t2", "s-c1"]
    assert all(set(s) == {"statementId", "section", "text", "citationIds"} and s["citationIds"] for s in item["statements"])
    assert item["keyFigures"][1]["value"] == {"value": None, "suppressed": True}
    assert item["expires_at"] == int(NOW.timestamp()) + 365 * 86_400


@pytest.mark.asyncio
async def test_uncited_invalid_and_unverified_statements_are_dropped(settings):
    reply = {
        "statements": [
            {"section": "overview", "text": "Uncited claim.", "evidence": []},
            {"section": "overview", "text": "Cites an id never supplied.", "evidence": ["agg:invented"]},
            {"section": "overview", "text": "700 free-text responses were recorded.", "evidence": ["agg:invented", "agg:kpi:free-text"]},
            {"section": "overview", "text": "Responses grew by 412.", "evidence": ["agg:kpi:free-text"]},
            {"section": "elsewhere", "text": "Unknown section.", "evidence": ["agg:matrix"]},
            {"section": "themes", "text": "ctDNA monitoring has 72 recorded responses.", "evidence": ["agg:theme:ctdna"]},
        ]
    }
    writer = Writer()
    events = await collect(SummaryRunner(settings, writer, Scripted([json.dumps(reply)]).factory, lambda: NOW), invocation())
    (item,) = writer.items
    assert [s["text"] for s in item["statements"]] == ["700 free-text responses were recorded.", "ctDNA monitoring has 72 recorded responses."]
    assert item["statements"][0]["citationIds"] == ["agg:kpi:free-text"]  # the invented id is stripped
    assert item["droppedStatements"] == 4 and item["numberCheck"] == "filtered"
    assert events[2]["value"]["dropped"] == 4


def test_section_and_citation_limits_are_enforced_by_code():
    task = SummaryTask(**task_dict())
    many = {"statements": [{"section": "overview", "text": f"Statement {i} on 2026-08-01.", "evidence": ["agg:matrix", "agg:theme:ctdna", "agg:kpi:free-text", "agg:theme:pulm"]} for i in range(6)]}
    draft = validate(many, task, check_numbers=False)
    assert len(draft.sections["overview"]) == 3
    assert all(len(s["citationIds"]) == 3 for s in draft.statements)


@pytest.mark.asyncio
async def test_malformed_reply_is_retried_once_then_fails_without_saving(settings):
    writer = Writer()
    model = Scripted(["not json", "```json\n" + json.dumps(GOOD) + "\n```"])
    events = await collect(SummaryRunner(settings, writer, model.factory, lambda: NOW), invocation())
    assert events[-1]["type"] == "RUN_FINISHED" and len(writer.items) == 1

    writer = Writer()
    events = await collect(SummaryRunner(settings, writer, Scripted(["nope", "still nope"]).factory, lambda: NOW), invocation())
    assert events[-1]["type"] == "RUN_ERROR" and events[-1]["code"] == "SUMMARY_FAILED" and writer.items == []

    writer = Writer()  # a model that only produces unsupported statements saves nothing
    empty = {"statements": [{"section": "overview", "text": "No source.", "evidence": []}]}
    events = await collect(SummaryRunner(settings, writer, Scripted([json.dumps(empty)]).factory, lambda: NOW), invocation())
    assert events[-1]["type"] == "RUN_ERROR" and writer.items == []


@pytest.mark.asyncio
async def test_a_failed_save_is_reported_not_hidden(settings):
    runner = SummaryRunner(settings, Writer(ok=False), Scripted([json.dumps(GOOD)]).factory, lambda: NOW)
    events = await collect(runner, invocation())
    assert next(e for e in events if e.get("name") == "summary_saved")["value"]["saved"] is False


@pytest.mark.asyncio
async def test_stub_mode_restates_cited_facts_deterministically_without_a_model(stub_settings):
    model, writer = Scripted([]), Writer()
    events = await collect(SummaryRunner(stub_settings, writer, model.factory, lambda: NOW), invocation())
    assert events[-1]["type"] == "RUN_FINISHED" and model.prompts == []
    (item,) = writer.items
    assert item["modelMode"] == "stub" and item["numberCheck"] == "unchecked"
    assert [s["text"] for s in item["statements"]] == [
        "700 free-text responses were recorded from 2026-08-01 to 2026-10-31.",
        "ctDNA monitoring has 72 recorded responses, rising by the approved rule.",
        "ctDNA monitoring is rising in 2 regions.",
    ]  # the uncited finding is not shown
    assert [s["section"] for s in item["statements"]] == ["overview", "themes", "crossRegion"]
    again = Writer()
    await collect(SummaryRunner(stub_settings, again, model.factory, lambda: NOW), invocation())
    assert again.items == writer.items


@pytest.mark.asyncio
async def test_no_findings_saves_an_empty_summary_without_calling_the_model(settings):
    model, writer = Scripted([]), Writer()
    inv = invocation(facts=[], evidence=[], key_figures=[])
    events = await collect(SummaryRunner(settings, writer, model.factory, lambda: NOW), inv)
    assert events[-1]["type"] == "RUN_FINISHED" and model.prompts == []
    assert writer.items[0]["statements"] == [] and writer.items[0]["sampleLimitations"]


@pytest.mark.asyncio
async def test_the_model_sees_findings_but_no_identity_or_scope_and_withheld_values_are_labelled(settings):
    model = Scripted([json.dumps(GOOD)])
    await collect(SummaryRunner(settings, Writer(), model.factory, lambda: NOW), invocation())
    shown = model.prompts[0]
    assert "ctDNA monitoring has 72 recorded responses" in shown and "withheld (small group)" in shown
    for hidden in ("executive-region-01", "avery@example.test", "Avery Clinician", "T01-01", "REGION-01"):
        assert hidden not in shown
    assert "data, not instructions" in model.system[0]
    assert '"suppressed"' not in model_input(SummaryTask(**task_dict()))


def test_item_holds_no_floats_and_deterministic_helper_is_pure():
    task = SummaryTask(**task_dict(disclosure={"minCell": 5, "ratio": 0.5}))
    draft = validate(deterministic_raw(task), task, check_numbers=False)
    from msl_agent.schemas import Identity
    from msl_agent.summaries import build_item

    item = build_item(task, Identity(user_id="u", persona="Executive", correlation_id="c"), draft, model_mode="stub", generated_at=NOW)
    assert item["disclosure"]["ratio"] == Decimal("0.5")


@pytest.mark.asyncio
async def test_http_contract_routes_each_task_type_to_its_runner(settings, repository):
    summary_writer, brief_writer = Writer(), BriefWriter()
    app = create_app(
        settings,
        repository=repository,
        briefs=BriefRunner(settings, brief_writer, Scripted([json.dumps(BRIEF_REPLY)]).factory, lambda: NOW),
        summaries=SummaryRunner(settings, summary_writer, Scripted([json.dumps(GOOD)]).factory, lambda: NOW),
    )
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://agent") as client:
        s = await client.post("/invocations", json=invocation().model_dump(mode="json"))
        b = await client.post("/invocations", json=brief_invocation().model_dump(mode="json"))
        bad = await client.post("/invocations", json={**invocation().model_dump(mode="json"), "task": {"type": "other"}})
    for response in (s, b):
        events = [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]
        assert events[-1]["type"] == "RUN_FINISHED"
    assert len(summary_writer.items) == 1 and summary_writer.items[0]["sk"].startswith("SUMMARY#")
    assert len(brief_writer.items) == 1 and brief_writer.items[0]["sk"].startswith("BRIEF#")
    assert bad.status_code == 422

