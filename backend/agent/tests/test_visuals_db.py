"""Ground truth for chart values against the real database, per persona (skipped without a database).

Set ``A2G_AGENT_DB_URL`` (the non-owner ``app_user`` DSN the agent uses) and ``A2G_OWNER_DB_URL`` (the owner DSN,
used only to compute the expected figures independently: raw rows are pulled for the caller's scope and counted
in Python with sets, never with the SQL the agent runs). The seeded database is deterministic, so any drift
between a plotted value and a recount fails here.
"""

from __future__ import annotations

import datetime as dt
import os
from collections import defaultdict

import psycopg
import pytest

from msl_agent import chart_data
from msl_agent.repository import PostgresScopedRepository
from msl_agent.schemas import Identity

AGENT_URL = os.environ.get("A2G_AGENT_DB_URL")
OWNER_URL = os.environ.get("A2G_OWNER_DB_URL")
pytestmark = pytest.mark.skipif(
    not (AGENT_URL and OWNER_URL), reason="needs A2G_AGENT_DB_URL and A2G_OWNER_DB_URL"
)

USERS = [
    ("msl-t01-01", "MSL"),
    ("msl-t02-03", "MSL"),
    ("director-region-01", "Director"),
    ("admin-region-01", "Administrator"),
]


def identity(user_id: str, persona: str) -> Identity:
    return Identity(user_id=user_id, persona=persona, correlation_id="t-visuals")


@pytest.fixture(scope="module")
def repo() -> PostgresScopedRepository:
    return PostgresScopedRepository(AGENT_URL)


@pytest.fixture(scope="module")
def owner():
    with psycopg.connect(OWNER_URL) as conn:
        yield conn


def scope_of(owner, user_id: str, persona: str) -> set[str] | None:
    """None means unrestricted (administrator)."""
    with owner.transaction(), owner.cursor() as cur:
        cur.execute("SELECT app.set_request_identity(%s, %s, 't')", (user_id, persona))
        cur.execute("SELECT app.has_permission('admin.manage')")
        if cur.fetchone()[0]:
            return None
        cur.execute("SELECT territory_id FROM app.current_scope_territories()")
        return {r[0] for r in cur.fetchall()}


def window(owner) -> tuple[dt.date, dt.date]:
    with owner.cursor() as cur:
        cur.execute(
            "SELECT LEAST((SELECT max(sys_inserted_datetime) FROM call_activity), (SELECT max(sys_inserted_datetime) FROM hcp_raw_insights))"
        )
        end = cur.fetchone()[0].date()
    return end - dt.timedelta(days=89), end


def raw_rows(owner, metric: str, scope: set[str] | None, start: dt.date, end: dt.date):
    """(entity id, date, {group fields}) rows, one per source row, for the caller's scope."""
    with owner.cursor() as cur:
        if metric == "responses":
            cur.execute(
                "SELECT uniq_rspns_id, date_of_interaction, territory_id, molecule_type, qstn_type, survey_type "
                "FROM hcp_raw_insights WHERE date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE",
                (start, end),
            )
            fields = ("territory", "product", "question_type", "program")
            rows = [
                (r[0], r[1], r[2], dict(zip(fields, (r[2], r[3], r[4], r[5]), strict=True)))
                for r in cur.fetchall()
            ]
        else:
            cur.execute(
                "SELECT crm_call_id, cust_mdm_id, call_dt, territory_id, prd_nm, call_type FROM call_activity "
                "WHERE call_dt BETWEEN %s AND %s",
                (start, end),
            )
            rows = [
                (
                    r[0] if metric == "calls" else r[1],
                    r[2],
                    r[3],
                    {"territory": r[3], "product": r[4], "call_type": r[5]},
                )
                for r in cur.fetchall()
            ]
    return [r for r in rows if r[0] is not None and (scope is None or r[2] in scope)]


def key_for(group_by: str, day: dt.date, fields: dict) -> str:
    if group_by == "month":
        return day.strftime("%Y-%m")
    if group_by == "week":
        return (day - dt.timedelta(days=day.weekday())).isoformat()
    if group_by == "day":
        return day.isoformat()
    return fields[group_by] or "Not recorded"


def recount(rows, group_by: str) -> dict[str, int]:
    seen = defaultdict(set)
    for entity, day, _, fields in rows:
        seen[key_for(group_by, day, fields)].add(entity)
    return {k: len(v) for k, v in seen.items()}


CASES = [
    ("calls", "month"),
    ("calls", "week"),
    ("calls", "territory"),
    ("calls", "product"),
    ("calls", "call_type"),
    ("engaged_hcps", "month"),
    ("engaged_hcps", "territory"),
    ("engaged_hcps", "product"),
    ("responses", "month"),
    ("responses", "week"),
    ("responses", "territory"),
    ("responses", "product"),
    ("responses", "question_type"),
    ("responses", "program"),
]


@pytest.mark.parametrize("user_id,persona", USERS)
@pytest.mark.parametrize("metric,group_by", CASES)
def test_series_values_equal_a_recount(repo, owner, user_id, persona, metric, group_by) -> None:
    start, end = window(owner)
    scope = scope_of(owner, user_id, persona)
    result = repo.chart(
        identity(user_id, persona),
        shape="series",
        metric=metric,
        group_by=group_by,
        period_from=None,
        period_to=None,
        territory_id=None,
        product=None,
        topic=None,
        answer_type=None,
    )
    assert result.status == "ok"
    rows = raw_rows(owner, metric, scope, start, end)
    expected = recount(rows, group_by)
    assert result.total == len({r[0] for r in rows})
    if group_by in chart_data.TIME_DIMS:
        got = {r.key: r.value for r in result.rows}
        assert got == {k: expected.get(k, 0) for k in chart_data.buckets(group_by, start, end)}
    else:
        top = sorted(expected.items(), key=lambda kv: (-kv[1], kv[0]))[: chart_data.MAX_BARS]
        assert [(r.key, r.value) for r in result.rows] == top
        assert result.left_out == max(0, len(expected) - chart_data.MAX_BARS)


@pytest.mark.parametrize("user_id,persona", USERS)
@pytest.mark.parametrize("metric", ["calls", "responses"])
def test_heatmap_cells_equal_a_recount(repo, owner, user_id, persona, metric) -> None:
    start, end = window(owner)
    scope = scope_of(owner, user_id, persona)
    result = repo.chart(
        identity(user_id, persona),
        shape="matrix",
        metric=metric,
        group_by="territory",
        period_from=None,
        period_to=None,
        territory_id=None,
        product=None,
        topic=None,
        answer_type=None,
    )
    rows = raw_rows(owner, metric, scope, start, end)
    cells = defaultdict(set)
    for entity, day, terr, _ in rows:
        cells[(terr, day.strftime("%Y-%m"))].add(entity)
    months = chart_data.month_starts(start, end)
    assert list(result.matrix.columns) == months
    for label, values in result.matrix.rows:
        assert list(values) == [len(cells.get((label, m), ())) for m in months]


@pytest.mark.parametrize("user_id,persona", USERS)
def test_table_rows_equal_a_recount(repo, owner, user_id, persona) -> None:
    start, end = window(owner)
    scope = scope_of(owner, user_id, persona)
    result = repo.chart(
        identity(user_id, persona),
        shape="table",
        metric="calls",
        group_by="territory",
        period_from=None,
        period_to=None,
        territory_id=None,
        product=None,
        topic=None,
        answer_type=None,
    )
    per = {m: recount(raw_rows(owner, m, scope, start, end), "territory") for m in chart_data.METRICS}
    for row in result.table:
        assert list(row.values) == [per[m].get(row.label, 0) for m in chart_data.METRICS]


@pytest.mark.parametrize("answer_type", ["likert_5", "rating_0_10", "yes_no", "single_choice"])
def test_distribution_equals_a_recount(repo, owner, answer_type) -> None:
    start, end = window(owner)
    result = repo.chart(
        identity("msl-t01-01", "MSL"),
        shape="distribution",
        metric="responses",
        group_by="month",
        period_from=None,
        period_to=None,
        territory_id=None,
        product=None,
        topic=None,
        answer_type=answer_type,
    )
    with owner.cursor() as cur:
        cur.execute(
            "SELECT btrim(rspns_txt), uniq_rspns_id FROM hcp_raw_insights WHERE territory_id = 'T01-01' AND qstn_type = %s "
            "AND date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE AND rspns_txt IS NOT NULL",
            (answer_type, start, end),
        )
        seen = defaultdict(set)
        for answer, rid in cur.fetchall():
            seen[answer].add(rid)
    assert result.total == len(set().union(*seen.values())) if seen else result.total == 0
    for row in result.rows:
        assert row.value == len(seen.get(row.key, ()))


def test_topic_filter_matches_a_recount(repo, owner) -> None:
    start, end = window(owner)
    result = repo.chart(
        identity("msl-t01-01", "MSL"),
        shape="series",
        metric="responses",
        group_by="month",
        period_from=None,
        period_to=None,
        territory_id=None,
        product=None,
        topic="osimertinib",
        answer_type=None,
    )
    with owner.cursor() as cur:
        cur.execute(
            "SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE territory_id = 'T01-01' "
            "AND date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE "
            "AND (qstn_txt ILIKE '%%osimertinib%%' OR rspns_txt ILIKE '%%osimertinib%%' OR molecule_type ILIKE '%%osimertinib%%' "
            "OR landscape_type ILIKE '%%osimertinib%%' OR study_name ILIKE '%%osimertinib%%' OR survey_type ILIKE '%%osimertinib%%')",
            (start, end),
        )
        assert result.total == cur.fetchone()[0] > 0


@pytest.mark.parametrize(
    "user_id,persona,foreign", [("msl-t01-01", "MSL", "T02-03"), ("msl-t02-03", "MSL", "T01-01")]
)
def test_out_of_scope_probes_leak_nothing(repo, user_id, persona, foreign) -> None:
    me = identity(user_id, persona)
    for shape in ("series", "matrix", "table"):
        res = repo.chart(
            me,
            shape=shape,
            metric="calls",
            group_by="territory" if shape != "table" else "month",
            period_from=None,
            period_to=None,
            territory_id=foreign,
            product=None,
            topic=None,
            answer_type=None,
        )
        assert (
            res.territory_in_scope is False
            and not res.rows
            and not res.table
            and res.matrix is None
            and res.total == 0
        )
    every = repo.chart(
        me,
        shape="series",
        metric="responses",
        group_by="territory",
        period_from=None,
        period_to=None,
        territory_id=None,
        product=None,
        topic=None,
        answer_type=None,
    )
    assert foreign not in {r.key for r in every.rows}


def test_aggregate_only_persona_has_no_chart(repo) -> None:
    res = repo.chart(
        identity("executive-region-01", "Executive"),
        shape="series",
        metric="calls",
        group_by="month",
        period_from=None,
        period_to=None,
        territory_id=None,
        product=None,
        topic=None,
        answer_type=None,
    )
    assert res.status == "aggregate_only" and not res.rows


def test_hostile_text_is_only_ever_a_bound_parameter(repo) -> None:
    res = repo.chart(
        identity("msl-t01-01", "MSL"),
        shape="series",
        metric="responses",
        group_by="month",
        period_from=None,
        period_to=None,
        territory_id=None,
        product="x'; DROP TABLE call_activity; --",
        topic="%' OR 1=1 --",
        answer_type=None,
    )
    assert res.status == "ok" and res.total == 0


# -- shares of one question and the specialty filter (ticket #32) -------------------------------------------------------


@pytest.mark.parametrize("user_id,persona", USERS)
def test_question_shares_equal_a_recount(repo, owner, user_id, persona) -> None:
    scope = scope_of(owner, user_id, persona)
    start, end = dt.date(2025, 11, 4), dt.date(2026, 11, 3)
    result = repo.question_breakdown(
        identity(user_id, persona), question_id="Q-0145", period_from=start, period_to=end, territory_id=None
    )
    assert result.status == "ok" and result.responses > 0
    rows = owner.execute(
        """SELECT DISTINCT uniq_rspns_id, btrim(rspns_txt) FROM hcp_raw_insights
           WHERE qstn_ext_id = 'Q-0145' AND date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE
             AND uniq_rspns_id IS NOT NULL AND (%s::text[] IS NULL OR territory_id = ANY(%s))""",
        (start, end, None if scope is None else sorted(scope), None if scope is None else sorted(scope)),
    ).fetchall()
    assert result.responses == len(rows)
    by_answer: dict[str, int] = defaultdict(int)
    for _, answer in rows:
        by_answer[answer] += 1
    assert {b.label: b.responses for b in result.bars} == dict(by_answer)


def test_the_specialty_filter_narrows_calls_and_hcps_only(repo, owner) -> None:
    start, end = dt.date(2026, 7, 1), dt.date(2026, 9, 30)
    me = identity("msl-t01-01", "MSL")
    everyone = repo.activity_summary(me, period_from=start, period_to=end, territory_id=None, product=None)
    onc = repo.activity_summary(me, period_from=start, period_to=end, territory_id=None, product=None, specialty="oncologist")
    nobody = repo.activity_summary(me, period_from=start, period_to=end, territory_id=None, product=None, specialty="cardiologist")
    assert onc.calls == everyone.calls > 0 and onc.engaged_hcps == everyone.engaged_hcps  # every seeded HCP is an oncologist
    assert (nobody.calls, nobody.engaged_hcps) == (0, 0)
    assert nobody.responses == everyone.responses, "responses carry no specialty filter"
