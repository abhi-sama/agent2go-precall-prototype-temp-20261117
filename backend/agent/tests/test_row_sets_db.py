"""Row-set counts against the real database: each set's count is what an independent recount of its rows gives.

Skipped without ``A2G_AGENT_DB_URL`` (the non-owner ``app_user`` DSN) and ``A2G_OWNER_DB_URL`` (owner DSN, used only to
recount the rows independently of the agent's SQL). The BE Lambda lists the rows of a set from the same description
(``a2g_api.chat_rows``, tested in backend/lambdas/api/tests/test_chat_rows_db.py), so a set whose count equals an
independent recount here, and whose rows equal that recount there, is what the table adds up to.
"""

from __future__ import annotations

import datetime as dt
import os

import psycopg
import pytest

from msl_agent.repository import PostgresScopedRepository
from msl_agent.schemas import Identity
from msl_agent.tools import RunContext, build_tools

AGENT_URL = os.environ.get("A2G_AGENT_DB_URL")
OWNER_URL = os.environ.get("A2G_OWNER_DB_URL")
pytestmark = pytest.mark.skipif(not (AGENT_URL and OWNER_URL), reason="needs A2G_AGENT_DB_URL and A2G_OWNER_DB_URL")

FROM, TO = "2026-08-06", "2026-11-03"


@pytest.fixture(scope="module")
def owner():
    with psycopg.connect(OWNER_URL) as conn:
        yield conn


def context(user_id="msl-t01-01", persona="MSL") -> tuple[RunContext, dict]:
    ctx = RunContext(
        identity=Identity(user_id=user_id, persona=persona, correlation_id="t-rows"),
        repository=PostgresScopedRepository(AGENT_URL),
    )
    return ctx, {t.tool_name: t for t in build_tools(ctx)}


def one(owner, sql: str, params: tuple) -> int:
    with owner.cursor() as cur:
        cur.execute(sql, params)
        return int(cur.fetchone()[0])


def by_kind(ctx: RunContext) -> dict[str, object]:
    return {s.kind if not s.answer_label else f"{s.kind}:{s.answer_label}": s for s in ctx.row_sets}


def test_activity_sets_equal_independent_recounts(owner) -> None:
    ctx, tools = context()
    tools["get_activity_summary"](from_date=FROM, to_date=TO, territory_id="T01-01", product="osimertinib")
    sets = by_kind(ctx)
    like = "%osimertinib%"
    assert sets["calls"].count == one(owner, "SELECT count(DISTINCT crm_call_id) FROM call_activity WHERE territory_id='T01-01' AND call_dt BETWEEN %s AND %s AND prd_nm ILIKE %s", (FROM, TO, like)) > 0
    assert sets["hcps"].count == one(owner, "SELECT count(DISTINCT cust_mdm_id) FROM call_activity WHERE territory_id='T01-01' AND call_dt BETWEEN %s AND %s AND prd_nm ILIKE %s", (FROM, TO, like)) > 0
    assert sets["responses"].count == one(owner, "SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE territory_id='T01-01' AND date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE AND molecule_type ILIKE %s", (FROM, TO, like)) > 0
    assert (sets["calls"].product, sets["calls"].territory_id) == ("osimertinib", "T01-01")


def test_specialty_filters_calls_and_hcps_but_not_responses(owner) -> None:
    specialty = one_text(owner, "SELECT cust_sub_typ FROM call_activity WHERE territory_id='T01-01' AND cust_sub_typ IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 1")
    ctx, tools = context()
    tools["get_activity_summary"](from_date=FROM, to_date=TO, specialty=specialty)
    sets = by_kind(ctx)
    assert sets["calls"].specialty == specialty and sets["hcps"].specialty == specialty and sets["responses"].specialty is None


def one_text(owner, sql: str) -> str:
    with owner.cursor() as cur:
        cur.execute(sql)
        return cur.fetchone()[0]


def test_chart_and_distribution_sets_equal_the_chart_totals(owner) -> None:
    ctx, tools = context()
    ctx_tool_context = type("T", (), {"tool_use": {"toolUseId": "v1"}, "agent": None})()
    tools["show_chart"](metric="engaged_hcps", group_by="month", from_date=FROM, to_date=TO, tool_context=ctx_tool_context)
    ctx_tool_context = type("T", (), {"tool_use": {"toolUseId": "v2"}, "agent": None})()
    tools["show_answer_distribution"](answer_type="yes_no", from_date=FROM, to_date=TO, tool_context=ctx_tool_context)
    visuals = {v.visual_id: v for v in ctx.visuals}
    hcps = next(s for s in ctx.row_sets if s.source_id == "v1")
    resp = next(s for s in ctx.row_sets if s.source_id == "v2")
    assert hcps.kind == "hcps" and hcps.count == visuals["v1"].total == one(owner, "SELECT count(DISTINCT cust_mdm_id) FROM call_activity WHERE territory_id='T01-01' AND call_dt BETWEEN %s AND %s", (FROM, TO))
    assert resp.kind == "responses" and resp.answer_type == "yes_no" and resp.count == visuals["v2"].total == one(
        owner,
        "SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE territory_id='T01-01' AND date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE AND qstn_type='yes_no' AND rspns_txt IS NOT NULL",
        (FROM, TO),
    )


def test_a_question_describes_all_responses_and_each_answer(owner) -> None:
    qid = one_text(owner, f"SELECT qstn_ext_id FROM hcp_raw_insights WHERE territory_id='T01-01' AND qstn_type='yes_no' AND date_of_interaction BETWEEN '{FROM}' AND '{TO}' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1")
    ctx, tools = context()
    tools["get_question_breakdown"](question_id=qid, from_date=FROM, to_date=TO)
    sets = by_kind(ctx)
    base = "FROM hcp_raw_insights WHERE territory_id='T01-01' AND qstn_ext_id=%s AND date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE AND uniq_rspns_id IS NOT NULL"
    assert sets["responses"].count == one(owner, "SELECT count(DISTINCT uniq_rspns_id) " + base, (qid, FROM, TO))
    answers = {k.split(":", 1)[1]: s for k, s in sets.items() if ":" in k}
    assert answers
    for label, s in answers.items():
        assert s.count == one(owner, "SELECT count(DISTINCT uniq_rspns_id) " + base + " AND btrim(rspns_txt) = %s", (qid, FROM, TO, label))
    assert sum(s.count for s in answers.values()) <= sets["responses"].count


def test_trends_describe_the_free_text_responses_of_the_latest_period(owner) -> None:
    ctx, tools = context()
    tools["get_topic_trends"](from_date=FROM, to_date=TO)
    [s] = [s for s in ctx.row_sets if s.free_text]
    assert s.kind == "responses" and s.count == one(
        owner,
        "SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE territory_id='T01-01' AND date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE "
        "AND qstn_type='open_text' AND nullif(btrim(rspns_txt), '') IS NOT NULL",
        (FROM, TO),
    )


def test_an_executive_is_told_rows_are_unavailable_and_gets_no_set() -> None:
    ctx, tools = context("executive-region-01", "Executive")
    tools["get_activity_summary"]()
    assert ctx.row_sets == [] and ctx.rows_unavailable_sent is True
    assert any(e.get("name") == "rows_unavailable" for e in ctx.pending)
