"""Chart tools and the ``visual`` AG-UI event: values equal the deterministic query result, scope holds."""

from __future__ import annotations

import datetime as dt
import json

import pytest
from conftest import make_invocation
from test_runtime import collect, names, runtime

from msl_agent.chart_data import month_starts, week_starts
from msl_agent.intent import infer_chart_request
from msl_agent.repository import FixtureScopedRepository


def visual_events(events):
    return [e["value"] for e in events if e.get("name") == "visual"]


def ready(events):
    return [v for v in visual_events(events) if v["phase"] == "ready"]


# Ground truth, written out by hand from FixtureScopedRepository._CHART_CALLS for T01-01 (last 90 days to 2026-11-03).
T01_CALLS_BY_MONTH = {"2026-08": 0, "2026-09": 2, "2026-10": 2, "2026-11": 2}
T01_CALLS_BY_PRODUCT = {"osimertinib": 4, "pembrolizumab": 2}


@pytest.mark.asyncio
async def test_line_chart_values_equal_ground_truth(settings, repository) -> None:
    steps = [("tool", "show_chart", {"metric": "calls", "group_by": "month"}), "Calls rose in October."]
    agent, writer = runtime(settings, repository, steps)
    events = await collect(agent, make_invocation())

    [visual] = ready(events)
    assert visual["kind"] == "line"
    assert {p["key"]: p["value"] for p in visual["points"]} == T01_CALLS_BY_MONTH
    assert visual["total"] == 6 == sum(T01_CALLS_BY_MONTH.values())
    assert visual["peak_key"] in ("2026-09", "2026-10", "2026-11")
    # A placeholder streams before the values do, under the same id.
    pending = [v for v in visual_events(events) if v["phase"] == "pending"]
    assert pending and pending[0]["visual_id"] == visual["visual_id"]
    order = names(events)
    assert order.index("visual") < order.index("TEXT_MESSAGE_START")
    # Saved with the turn so history can redraw it.
    assert writer.turns[0].visuals[0]["points"][2]["value"] == 2


@pytest.mark.asyncio
async def test_bar_chart_ranks_with_shares_that_come_from_the_query(settings, repository) -> None:
    steps = [("tool", "show_chart", {"metric": "calls", "group_by": "product"}), "Mostly osimertinib."]
    agent, _ = runtime(settings, repository, steps)
    [visual] = ready(await collect(agent, make_invocation()))
    assert visual["kind"] == "bar"
    assert [(p["label"], p["value"]) for p in visual["points"]] == [("osimertinib", 4), ("pembrolizumab", 2)]
    assert [p["share_pct"] for p in visual["points"]] == [66.7, 33.3]


@pytest.mark.asyncio
async def test_engaged_hcps_carry_no_share_because_groups_overlap(settings, repository) -> None:
    steps = [("tool", "show_chart", {"metric": "engaged_hcps", "group_by": "product"}), "Done."]
    agent, _ = runtime(settings, repository, steps)
    [visual] = ready(await collect(agent, make_invocation()))
    assert all("share_pct" not in p for p in visual["points"])
    assert visual["total"] == 4  # H1..H4 counted once each, not the sum of the groups


@pytest.mark.asyncio
async def test_heatmap_table_timeline_and_distribution(settings, repository) -> None:
    steps = [
        ("tool", "show_chart", {"metric": "responses", "group_by": "product", "chart_type": "heatmap"}),
        ("tool", "show_chart", {"metric": "calls", "group_by": "month", "chart_type": "table"}),
        ("tool", "show_chart", {"metric": "calls", "group_by": "week", "chart_type": "timeline"}),
        ("tool", "show_answer_distribution", {"answer_type": "likert_5"}),
        "Here you go.",
    ]
    agent, _ = runtime(settings, repository, steps)
    heat, table, timeline, dist = ready(await collect(agent, make_invocation()))

    assert heat["kind"] == "heatmap" and heat["columns"] == ["Aug 2026", "Sep 2026", "Oct 2026", "Nov 2026"]
    assert {r["label"]: r["values"] for r in heat["rows"]} == {
        "osimertinib": [0, 1, 1, 2],
        "pembrolizumab": [0, 0, 1, 0],
    }
    assert table["kind"] == "table"
    assert table["columns"][1:] == ["Distinct calls", "Engaged HCPs", "Insight responses"]
    assert {r["key"]: r["values"] for r in table["rows"]}["2026-10"] == [2, 2, 2]
    assert timeline["kind"] == "timeline"
    assert sum(p["value"] for p in timeline["points"]) == 6
    assert dist["kind"] == "distribution"
    assert {p["label"]: p["value"] for p in dist["points"]} == {"1": 0, "2": 0, "3": 0, "4": 2, "5": 1}
    assert dist["total"] == 3


@pytest.mark.asyncio
async def test_out_of_scope_territory_never_produces_a_visual(settings, repository) -> None:
    steps = [
        ("tool", "show_chart", {"metric": "calls", "group_by": "month", "territory_id": "T02-01"}),
        "No access.",
    ]
    agent, writer = runtime(settings, repository, steps)
    events = await collect(agent, make_invocation())
    assert ready(events) == []
    assert "T02-01" not in json.dumps([e for e in events if e.get("name") == "visual"])
    assert writer.turns[0].visuals == []


@pytest.mark.asyncio
async def test_a_user_only_ever_sees_their_own_territory_in_a_chart(settings, repository) -> None:
    steps = [("tool", "show_chart", {"metric": "calls", "group_by": "territory"}), "Done."]
    mine, _ = runtime(settings, repository, steps)
    [visual] = ready(await collect(mine, make_invocation("msl-t01-01")))
    assert [p["label"] for p in visual["points"]] == ["T01-01"]
    other, _ = runtime(settings, repository, steps)
    [theirs] = ready(await collect(other, make_invocation("msl-t02-01")))
    assert [(p["label"], p["value"]) for p in theirs["points"]] == [("T02-01", 2)]
    assert "T01-01" not in json.dumps(theirs)


@pytest.mark.asyncio
async def test_aggregate_only_persona_gets_no_visual(settings, repository) -> None:
    agent, _ = runtime(
        settings, repository, [("tool", "show_chart", {"metric": "calls", "group_by": "month"}), "n/a"]
    )
    events = await collect(agent, make_invocation("exec-1", "Executive"))
    assert ready(events) == []


@pytest.mark.asyncio
async def test_bad_arguments_are_refused_without_a_visual(settings, repository) -> None:
    steps = [
        ("tool", "show_chart", {"metric": "calls", "group_by": "question_type"}),  # responses-only grouping
        ("tool", "show_chart", {"metric": "calls; DROP TABLE x", "group_by": "month"}),
        ("tool", "show_chart", {"metric": "calls", "group_by": "month", "chart_type": "heatmap"}),
        "Sorry.",
    ]
    agent, _ = runtime(settings, repository, steps)
    assert ready(await collect(agent, make_invocation())) == []


@pytest.mark.asyncio
async def test_chart_figures_the_model_quotes_are_verified(settings, repository) -> None:
    steps = [
        ("tool", "show_chart", {"metric": "calls", "group_by": "product"}),
        "Osimertinib had 4 calls and pembrolizumab 2.",
    ]
    agent, _ = runtime(settings, repository, steps)
    events = await collect(agent, make_invocation())
    assert next(e for e in events if e.get("name") == "number_check")["value"]["status"] == "verified"
    wrong = [("tool", "show_chart", {"metric": "calls", "group_by": "product"}), "Osimertinib had 5 calls."]
    agent, _ = runtime(settings, repository, wrong)
    events = await collect(agent, make_invocation())
    assert next(e for e in events if e.get("name") == "number_check")["value"]["status"] == "unverified"


@pytest.mark.asyncio
async def test_the_floor_draws_a_chart_when_the_model_skips_the_tool(settings, repository) -> None:
    agent, _ = runtime(settings, repository, [("tool", "get_activity_summary", {}), "You had 2 calls."])
    events = await collect(agent, make_invocation(question="Compare my calls by product"))
    [visual] = ready(events)
    assert visual["kind"] == "bar" and visual["points"][0]["label"] == "osimertinib"
    # A plain count question stays plain: key figures only.
    agent, _ = runtime(settings, repository, [("tool", "get_activity_summary", {}), "You had 2 calls."])
    assert ready(await collect(agent, make_invocation(question="How many calls did I have?"))) == []


@pytest.mark.asyncio
async def test_stub_mode_draws_a_comparison_chart_too(stub_settings, repository) -> None:
    agent, _ = runtime(stub_settings, repository, ["Floci stub response"])
    events = await collect(agent, make_invocation(question="Show my calls by month"))
    [visual] = ready(events)
    assert visual["kind"] == "line"


def test_intent_vocabulary() -> None:
    assert infer_chart_request("How many calls did I have?") is None
    assert infer_chart_request("What have HCPs recorded about osimertinib?") is None
    assert infer_chart_request("Calls per month please").group_by == "month"
    assert infer_chart_request("Compare territories").chart_type == "bar"
    assert infer_chart_request("heatmap of responses by product").chart_type == "heatmap"
    assert infer_chart_request("trend of engaged HCPs").metric == "engaged_hcps"
    assert infer_chart_request("weekly responses").group_by == "week"


def test_bucket_helpers_cover_the_period() -> None:
    assert month_starts(dt.date(2026, 8, 6), dt.date(2026, 11, 3)) == [
        "2026-08",
        "2026-09",
        "2026-10",
        "2026-11",
    ]
    assert month_starts(dt.date(2025, 12, 1), dt.date(2026, 1, 31)) == ["2025-12", "2026-01"]
    assert week_starts(dt.date(2026, 11, 3), dt.date(2026, 11, 3)) == ["2026-11-02"]
    assert isinstance(FixtureScopedRepository(), FixtureScopedRepository)


def test_fits_limits_heatmaps_and_tables() -> None:
    from msl_agent.chart_data import fits

    assert fits("matrix", "territory", dt.date(2025, 11, 4), dt.date(2026, 11, 3))
    assert not fits("matrix", "territory", dt.date(2023, 11, 4), dt.date(2026, 11, 3))
    assert not fits("series", "day", dt.date(2026, 1, 1), dt.date(2026, 11, 3))
    assert fits("series", "week", dt.date(2025, 11, 4), dt.date(2026, 11, 3))
    assert not fits("table", "month", dt.date(2023, 11, 4), dt.date(2026, 11, 3))


@pytest.mark.asyncio
async def test_follow_ups_cannot_replace_the_answer(settings, repository) -> None:
    """A model that jumps from the data tool straight to suggest_follow_ups must not end the run with no answer."""
    steps = [
        ("tool", "get_activity_summary", {}),
        ("tool", "suggest_follow_ups", {"questions": ["Which territories can I see?"]}),
        "You had 2 calls.",
        ("tool", "suggest_follow_ups", {"questions": ["Which territories can I see?"]}),
    ]
    agent, writer = runtime(settings, repository, steps)
    events = await collect(agent, make_invocation())
    assert "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT") == "You had 2 calls."
    assert next(e for e in events if e.get("name") == "suggestions")["value"] == ["Which territories can I see?"]
    assert writer.turns[0].assistant_text == "You had 2 calls."
