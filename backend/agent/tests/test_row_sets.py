"""Row sets: the description of the rows behind each computed figure (docs/adr/0015). No database needed."""

from __future__ import annotations

from typing import Any

import pytest
from conftest import make_invocation
from test_runtime import collect, names, runtime

from msl_agent.row_sets import MAX_ROW_SETS


def sets_of(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [s for e in events if e.get("name") == "row_sets" for s in e["value"]["row_sets"]]


@pytest.mark.asyncio
async def test_a_count_answer_describes_the_rows_of_each_key_figure(settings, repository) -> None:
    agent, _ = runtime(settings, repository, [("tool", "get_activity_summary", {}), "You had calls."])
    events = await collect(agent, make_invocation())
    facts = {f["fact_id"]: f for f in next(e for e in events if e.get("name") == "source_facts")["value"]["facts"]}
    rows = sets_of(events)
    # One set per figure, each carrying exactly the number the tile shows and the filters the count used.
    assert [(s["kind"], s["count"], s["source_id"]) for s in rows] == [
        ("calls", facts["f1"]["value"], "f1"),
        ("hcps", facts["f2"]["value"], "f2"),
        ("responses", facts["f3"]["value"], "f3"),
    ]
    assert all(s["period_from"] and s["period_to"] and s["row_set_id"].startswith("rs") for s in rows)
    # The set is announced before the answer text, with the other evidence.
    order = names(events)
    assert order.index("row_sets") < order.index("TEXT_MESSAGE_START")
    assert "rows_unavailable" not in order


@pytest.mark.asyncio
async def test_filters_travel_with_the_set(settings, repository) -> None:
    steps = [("tool", "get_activity_summary", {"territory_id": "T01-01", "product": "osimertinib", "specialty": "oncologists"}), "Done."]
    agent, _ = runtime(settings, repository, steps)
    calls, hcps, responses = sets_of(await collect(agent, make_invocation()))
    assert calls["territory_id"] == hcps["territory_id"] == responses["territory_id"] == "T01-01"
    assert calls["product"] == "osimertinib" and responses["product"] == "osimertinib"
    # Responses are not filtered by specialty, so their set must not be either.
    assert "specialty" not in responses


@pytest.mark.asyncio
async def test_an_out_of_scope_territory_describes_no_rows(settings, repository) -> None:
    agent, _ = runtime(settings, repository, [("tool", "get_activity_summary", {"territory_id": "T09-09"}), "Outside your scope."])
    events = await collect(agent, make_invocation())
    assert sets_of(events) == []


@pytest.mark.asyncio
async def test_a_chart_describes_the_rows_its_total_counted(settings, repository) -> None:
    steps = [("tool", "show_chart", {"metric": "calls", "group_by": "month"}), "Calls rose."]
    agent, _ = runtime(settings, repository, steps)
    events = await collect(agent, make_invocation())
    visual = next(e["value"] for e in events if e.get("name") == "visual" and e["value"]["phase"] == "ready")
    [rows] = sets_of(events)
    assert rows["kind"] == "calls" and rows["count"] == visual["total"] == 6 and rows["source_id"] == visual["visual_id"]


@pytest.mark.asyncio
async def test_the_same_rows_are_described_once(settings, repository) -> None:
    steps = [
        ("tool", "get_activity_summary", {"territory_id": "T01-01"}),
        ("tool", "show_chart", {"metric": "calls", "group_by": "month", "territory_id": "T01-01"}),
        ("tool", "show_chart", {"metric": "calls", "group_by": "product", "territory_id": "T01-01"}),
        "Done.",
    ]
    agent, _ = runtime(settings, repository, steps)
    rows = sets_of(await collect(agent, make_invocation()))
    keys = [(s["kind"], s["period_from"], s["period_to"], s.get("territory_id")) for s in rows]
    assert len(keys) == len(set(keys))
    assert len({s["row_set_id"] for s in rows}) == len(rows)


@pytest.mark.asyncio
async def test_a_searched_topic_describes_its_matching_responses(settings, repository) -> None:
    steps = [("tool", "search_recorded_responses", {"topic": "osimertinib"}), "One response."]
    agent, _ = runtime(settings, repository, steps)
    [rows] = sets_of(await collect(agent, make_invocation()))
    assert rows["kind"] == "responses" and rows["topic"] == "osimertinib" and rows["count"] == 1


@pytest.mark.asyncio
async def test_an_executive_gets_the_unavailable_note_and_never_a_row_set(settings, repository) -> None:
    steps = [("tool", "get_org_themes", {}), "Themes are rising."]
    agent, _ = runtime(settings, repository, steps)
    events = await collect(agent, make_invocation("executive-region-01", "Executive", "What are the leading themes?"))
    assert sets_of(events) == []
    notes = [e["value"] for e in events if e.get("name") == "rows_unavailable"]
    assert notes == [{"reason": "aggregate_only"}]  # once per run


@pytest.mark.asyncio
async def test_an_executive_asking_for_records_gets_the_note_too(settings, repository) -> None:
    steps = [("tool", "get_activity_summary", {}), ("tool", "search_recorded_responses", {"topic": "access"}), "Not available."]
    agent, _ = runtime(settings, repository, steps)
    events = await collect(agent, make_invocation("executive-region-01", "Executive", "How many calls?"))
    assert sets_of(events) == [] and sum(1 for e in events if e.get("name") == "rows_unavailable") == 1


def test_a_run_describes_a_bounded_number_of_sets(repository) -> None:
    import datetime as dt

    from msl_agent.tools import RunContext

    ctx = RunContext(identity=make_invocation().identity, repository=repository)
    day = dt.date(2026, 11, 3)
    for i in range(MAX_ROW_SETS + 5):
        ctx.add_row_set("responses", f"set {i}", 5, day, day, "your scope", topic=f"t{i}")
    assert len(ctx.row_sets) == MAX_ROW_SETS
    assert ctx.add_row_set("calls", "empty", 0, day, day, "your scope") is None
