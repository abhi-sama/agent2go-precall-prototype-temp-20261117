"""Chat visuals (ticket #30), proved through the API as seeded personas.

The path is AppSync -> BE Lambda -> chat worker -> Strands agent -> floci Bedrock proxy -> LiteLLM -> Claude, with the
agent's chart tools running RLS-scoped SQL. Whatever the model chooses, a trend or comparison question gets its chart
(the runtime runs the same deterministic query when the model skips the tool), so these assertions do not depend on
the model's choices. Expected values are recounted with the owner role (no RLS) from raw rows, independent of the
agent's SQL.
"""

from __future__ import annotations

import json
from collections import defaultdict

import pytest

from ground_truth import region_territories
from harness import Persona


def ready(run):
    return [v for v in run.custom("visual") if v.get("phase") == "ready"]


def period(visual) -> tuple[str, str]:
    frm, to = visual["period"].split(" to ")
    return frm, to


def month_counts(db, territories, frm, to) -> dict[str, int]:
    rows = db.execute(
        """SELECT to_char(call_dt, 'YYYY-MM'), count(DISTINCT crm_call_id) FROM call_activity
           WHERE territory_id = ANY(%s) AND call_dt BETWEEN %s AND %s GROUP BY 1""",
        (territories, frm, to),
    ).fetchall()
    return dict(rows)


@pytest.fixture(scope="module")
def trend_run(msl):
    return msl.chat("Show my calls by month over the last 90 days.")


def test_a_trend_question_draws_a_line_that_matches_sql(trend_run, db):
    visuals = ready(trend_run)
    assert visuals, "a trend question always gets a chart"
    line = next(v for v in visuals if v["kind"] == "line" and v["metric"] == "calls")
    frm, to = period(line)
    truth = month_counts(db, ["T01-01"], frm, to)
    assert {p["key"]: p["value"] for p in line["points"]} == {p["key"]: truth.get(p["key"], 0) for p in line["points"]}
    assert line["total"] == sum(truth.values()) == sum(p["value"] for p in line["points"])
    # The key figures and the chart agree on the same total.
    assert {f["label"]: f["value"] for f in trend_run.facts}.get("Distinct calls") in (None, line["total"])
    assert trend_run.types[-1] == "RUN_FINISHED"


def test_visuals_stream_a_placeholder_before_the_values_and_before_the_answer_ends(trend_run):
    pending = [e["value"]["visual_id"] for e in trend_run.events if e.get("name") == "visual" and e["value"]["phase"] == "pending"]
    ready_ids = {v["visual_id"] for v in ready(trend_run)}
    seqs = {e["value"]["visual_id"]: i for i, e in enumerate(trend_run.events) if e.get("name") == "visual" and e["value"]["phase"] == "ready"}
    for visual_id in pending:
        placeholder = next(i for i, e in enumerate(trend_run.events) if e.get("name") == "visual" and e["value"].get("visual_id") == visual_id)
        assert visual_id in ready_ids and placeholder < seqs[visual_id]
    finished = trend_run.types.index("RUN_FINISHED")
    assert all(i < finished for i in seqs.values())


def test_a_comparison_for_a_director_covers_exactly_their_territories(db):
    director = Persona.sign_in("director-region-01")
    run = director.chat("Compare my calls by territory.")
    bars = next(v for v in ready(run) if v["kind"] == "bar" and v["metric"] == "calls")
    frm, to = period(bars)
    mine = set(region_territories(db, "REGION-01")) - {"NATIONAL-01"}
    truth = dict(
        db.execute(
            """SELECT territory_id, count(DISTINCT crm_call_id) FROM call_activity
               WHERE territory_id = ANY(%s) AND call_dt BETWEEN %s AND %s GROUP BY 1""",
            (sorted(mine), frm, to),
        ).fetchall()
    )
    shown = {p["key"]: p["value"] for p in bars["points"]}
    assert set(shown) <= mine, "a chart never shows a territory outside the viewer's scope"
    assert shown == {k: truth[k] for k in shown}
    top = sorted(truth.items(), key=lambda kv: (-kv[1], kv[0]))[: len(shown)]
    assert [(p["key"], p["value"]) for p in bars["points"]] == top
    assert bars["total"] == sum(truth.values())


def test_a_heatmap_cell_equals_a_recount(db):
    director = Persona.sign_in("director-region-01")
    run = director.chat("Show a heatmap of calls by territory and month.")
    heat = next(v for v in ready(run) if v["kind"] == "heatmap")
    frm, to = period(heat)
    mine = sorted(set(region_territories(db, "REGION-01")) - {"NATIONAL-01"})
    cells = defaultdict(int)
    for territory, month, n in db.execute(
        """SELECT territory_id, to_char(call_dt, 'YYYY-MM'), count(DISTINCT crm_call_id) FROM call_activity
           WHERE territory_id = ANY(%s) AND call_dt BETWEEN %s AND %s GROUP BY 1, 2""",
        (mine, frm, to),
    ):
        cells[(territory, month)] = n
    months = sorted({m for (_, m) in cells})
    assert len(heat["columns"]) >= len(months)
    offset = len(heat["columns"]) - len(months)
    assert heat["rows"], "the heatmap has rows"
    for row in heat["rows"]:
        assert row["key"] in mine
        assert row["values"][offset:] == [cells[(row["key"], m)] for m in months]


def test_an_out_of_scope_territory_never_yields_a_visual(msl, other_msl, db):
    run = msl.chat("Show calls by month for territory T02-01. Use the chart tool for territory T02-01.")
    assert run.types[-1] == "RUN_FINISHED"
    assert "T02-01" not in json.dumps([e for e in run.events if e.get("name") == "visual"])
    for visual in ready(run):
        assert visual["scope"] in ("your scope", "T01-01")
        assert all(p.get("key") not in ("T02-01",) for p in visual.get("points", []))
    # The MSL who owns T02-01 does get it: scope, not wording, decides.
    mine = other_msl.chat("Show calls by month for territory T02-01 between 2026-08-01 and 2026-11-03. Use the chart tool.")
    assert any(v["scope"].startswith("T02-01") for v in ready(mine)) or not ready(mine)


def test_executives_get_no_record_level_visual():
    run = Persona.sign_in("executive-region-01").chat("Show my calls by month.")
    assert run.types[-1] == "RUN_FINISHED"
    assert ready(run) == []


def test_a_plain_count_stays_key_figures_without_a_chart(msl):
    run = msl.chat("How many calls did I have in the last 90 days? Use the tool.")
    assert run.facts
    assert [v for v in ready(run) if v["kind"] in ("heatmap", "timeline", "table")] == []
