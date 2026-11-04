"""Show rows against a real migrated and seeded Postgres: row counts equal independent SQL counts, RLS limits the
rows, sorting and paging are stable, and an export is audited under the real audit policy.

Skipped unless ``A2G_OWNER_DB_URL`` points at one (backend/infra/scripts/test.sh sets it). The same behaviour through
Cognito, AppSync and the live agent is proved in tests/api/test_chat_rows.py.
"""

from __future__ import annotations

import contextlib
import csv
import io
import json
import os
import re
import uuid

import psycopg
import pytest

from a2g_api import chat, chat_rows
from a2g_api.errors import BadRequest, Forbidden, NotFound
from a2g_api.identity import Identity

OWNER_DSN = os.environ.get("A2G_OWNER_DB_URL")
pytestmark = pytest.mark.skipif(not OWNER_DSN, reason="needs a migrated, seeded Postgres (A2G_OWNER_DB_URL)")

FROM, TO = "2026-08-06", "2026-11-03"
ID = Identity("sub", "msl", "MSL", "Msl One", "msl@example.test", "header")
SETS = {
    "calls": {"kind": "calls", "label": "Distinct calls"},
    "hcps": {"kind": "hcps", "label": "Engaged HCPs"},
    "responses": {"kind": "responses", "label": "Insight responses"},
}


def app_dsn() -> str:
    return re.sub(r"//[^@]+@", "//app_user:app_user@", OWNER_DSN or "")


@contextlib.contextmanager
def session(user_id: str, persona: str = "MSL"):
    with psycopg.connect(app_dsn()) as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("SELECT app.set_request_identity(%s, %s, %s)", (user_id, persona, "test-corr"))
        yield cur


@pytest.fixture
def owner():
    with psycopg.connect(OWNER_DSN, autocommit=True) as conn:
        yield conn


def make_run(owner, user_id: str, *sets: dict) -> str:
    run_id = str(uuid.uuid4())
    owner.execute("INSERT INTO chat_runs(run_id, owner_user_id, thread_id) VALUES (%s, %s, 'thread-test')", (run_id, user_id))
    described = [
        {"row_set_id": f"rs{i + 1}", "unit": "x", "count": 1, "period_from": FROM, "period_to": TO, "scope": "your scope", **s}
        for i, s in enumerate(sets)
    ]
    event = {"type": "CUSTOM", "name": "row_sets", "value": {"row_sets": described}}
    owner.execute(
        "INSERT INTO chat_run_events(run_id, seq, owner_user_id, event) VALUES (%s, 1, %s, %s::jsonb)", (run_id, user_id, json.dumps(event))
    )
    return run_id


def rows_total(user_id: str, run_id: str, row_set: str = "rs1", persona: str = "MSL") -> dict:
    with session(user_id, persona) as cur:
        return chat_rows.chat_answer_rows(cur, ID, user_id, {"runId": run_id, "rowSetId": row_set, "limit": 100})


def independent(owner, sql: str, params: tuple) -> int:
    return int(owner.execute(sql, params).fetchone()[0])


@pytest.mark.parametrize(
    "spec, sql, extra",
    [
        ({**SETS["calls"]}, "SELECT count(DISTINCT crm_call_id) FROM call_activity WHERE territory_id = ANY(%s) AND call_dt BETWEEN %s AND %s", ()),
        ({**SETS["hcps"]}, "SELECT count(DISTINCT cust_mdm_id) FROM call_activity WHERE territory_id = ANY(%s) AND call_dt BETWEEN %s AND %s", ()),
        ({**SETS["responses"]}, "SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE territory_id = ANY(%s) AND date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE", ()),
    ],
)
def test_the_rows_of_each_kind_add_up_to_an_independent_count(owner, spec, sql, extra) -> None:
    run = make_run(owner, "msl-t01-01", spec)
    page = rows_total("msl-t01-01", run)
    assert page["total"] == independent(owner, sql, (["T01-01"], FROM, TO)) > 0
    # Every row belongs to the caller's territory (RLS), whatever the description said.
    territory = [c["key"] for c in page["columns"]].index("territory")
    assert {r["cells"][territory] for r in page["rows"]} == {"T01-01"}


def test_filters_narrow_the_rows_the_way_the_counts_do(owner) -> None:
    product = owner.execute("SELECT prd_nm FROM call_activity WHERE territory_id='T01-01' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1").fetchone()[0]
    specialty = owner.execute("SELECT cust_sub_typ FROM call_activity WHERE territory_id='T01-01' AND cust_sub_typ IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 1").fetchone()[0]
    run = make_run(owner, "msl-t01-01", {**SETS["calls"], "product": product}, {**SETS["hcps"], "specialty": specialty}, {**SETS["responses"], "topic": "access"})
    like = lambda t: "%" + t.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    assert rows_total("msl-t01-01", run, "rs1")["total"] == independent(
        owner, "SELECT count(DISTINCT crm_call_id) FROM call_activity WHERE territory_id='T01-01' AND call_dt BETWEEN %s AND %s AND prd_nm ILIKE %s ESCAPE '\\'", (FROM, TO, like(product)))
    assert rows_total("msl-t01-01", run, "rs2")["total"] == independent(
        owner, "SELECT count(DISTINCT cust_mdm_id) FROM call_activity WHERE territory_id='T01-01' AND call_dt BETWEEN %s AND %s AND cust_sub_typ ILIKE %s ESCAPE '\\'", (FROM, TO, like(specialty)))
    topic = like("access")
    assert rows_total("msl-t01-01", run, "rs3")["total"] == independent(
        owner,
        "SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE territory_id='T01-01' AND date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE "
        "AND (qstn_txt ILIKE %s ESCAPE '\\' OR rspns_txt ILIKE %s ESCAPE '\\' OR molecule_type ILIKE %s ESCAPE '\\' OR landscape_type ILIKE %s ESCAPE '\\' OR study_name ILIKE %s ESCAPE '\\' OR survey_type ILIKE %s ESCAPE '\\')",
        (FROM, TO, *[topic] * 6),
    )


def test_a_question_and_one_of_its_answers_list_the_responses_they_counted(owner) -> None:
    qid = owner.execute(
        "SELECT qstn_ext_id FROM hcp_raw_insights WHERE territory_id='T01-01' AND qstn_type='yes_no' AND date_of_interaction BETWEEN %s AND %s GROUP BY 1 ORDER BY count(*) DESC LIMIT 1",
        (FROM, TO),
    ).fetchone()[0]
    run = make_run(owner, "msl-t01-01", {**SETS["responses"], "question_id": qid}, {**SETS["responses"], "question_id": qid, "answer_label": "Yes"})
    base = "FROM hcp_raw_insights WHERE territory_id='T01-01' AND qstn_ext_id=%s AND date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE AND uniq_rspns_id IS NOT NULL"
    assert rows_total("msl-t01-01", run, "rs1")["total"] == independent(owner, "SELECT count(DISTINCT uniq_rspns_id) " + base, (qid, FROM, TO))
    yes = rows_total("msl-t01-01", run, "rs2")
    assert yes["total"] == independent(owner, "SELECT count(DISTINCT uniq_rspns_id) " + base + " AND btrim(rspns_txt) = 'Yes'", (qid, FROM, TO)) > 0
    assert {r["cells"][-1] for r in yes["rows"]} == {"Yes"}


def test_a_territory_outside_the_callers_scope_lists_nothing(owner) -> None:
    run = make_run(owner, "msl-t01-01", {**SETS["calls"], "territory_id": "T02-01"})
    page = rows_total("msl-t01-01", run)
    assert page["total"] == 0 and page["rows"] == []


def test_a_director_sees_the_rows_of_their_whole_region(owner) -> None:
    run = make_run(owner, "director-region-01", {**SETS["calls"]})
    page = rows_total("director-region-01", run, persona="Director")
    region = [r[0] for r in owner.execute("SELECT child_territory_id FROM territory_scope_relationships WHERE parent_territory_id = 'REGION-01'").fetchall()]
    assert page["total"] == independent(owner, "SELECT count(DISTINCT crm_call_id) FROM call_activity WHERE territory_id = ANY(%s) AND call_dt BETWEEN %s AND %s", (region, FROM, TO))


def test_an_aggregate_only_executive_is_refused_and_another_users_run_is_unknown(owner) -> None:
    run = make_run(owner, "msl-t01-01", {**SETS["calls"]})
    with session("executive-region-01", "Executive") as cur, pytest.raises(Forbidden):
        chat_rows.chat_answer_rows(cur, ID, "executive-region-01", {"runId": run, "rowSetId": "rs1"})
    with session("msl-t02-01") as cur, pytest.raises(NotFound):
        chat_rows.chat_answer_rows(cur, ID, "msl-t02-01", {"runId": run, "rowSetId": "rs1"})
    with session("msl-t02-01") as cur, pytest.raises(NotFound):
        chat_rows.export_chat_rows(cur, ID, "msl-t02-01", {"runId": run, "rowSetId": "rs1"})


def test_sorting_and_paging_cover_every_row_once_in_order(owner) -> None:
    run = make_run(owner, "msl-t01-01", {**SETS["calls"]})
    seen: list[str] = []
    dates: list[str] = []
    offset = 0
    while True:
        with session("msl-t01-01") as cur:
            page = chat_rows.chat_answer_rows(cur, ID, "msl-t01-01", {"runId": run, "rowSetId": "rs1", "sortBy": "date", "sortDir": "ASC", "offset": offset, "limit": 100})
        if not page["rows"]:
            break
        seen += [r["id"] for r in page["rows"]]
        dates += [r["cells"][1] for r in page["rows"]]
        offset += 100
    assert len(seen) == len(set(seen)) == page["total"]
    assert dates == sorted(dates)


def test_hcp_rows_count_each_hcp_once_with_their_calls(owner) -> None:
    run = make_run(owner, "msl-t01-01", {**SETS["hcps"]})
    page = rows_total("msl-t01-01", run)
    calls = [c["key"] for c in page["columns"]].index("calls")
    assert sum(int(r["cells"][calls]) for r in page["rows"]) <= independent(
        owner, "SELECT count(*) FROM (SELECT DISTINCT cust_mdm_id, crm_call_id FROM call_activity WHERE territory_id='T01-01' AND call_dt BETWEEN %s AND %s) t", (FROM, TO)
    )
    assert len({r["id"] for r in page["rows"]}) == len(page["rows"])


def test_an_export_is_audited_by_the_exporting_msl_under_the_real_policy(owner) -> None:
    run = make_run(owner, "msl-t01-01", {**SETS["responses"]})
    before = independent(owner, "SELECT count(*) FROM audit_events WHERE action='chat_rows.exported' AND actor_user_id='msl-t01-01'", ())
    with session("msl-t01-01") as cur:
        result = chat_rows.export_chat_rows(cur, ID, "msl-t01-01", {"runId": run, "rowSetId": "rs1", "sortBy": "date", "sortDir": "ASC"})
    body = [line for line in result["content"].splitlines() if not line.startswith("#")]
    parsed = list(csv.reader(io.StringIO("\n".join(body))))
    assert parsed[0][0] == "Response" and len(parsed) - 1 == result["rowCount"] == min(result["total"], chat_rows.EXPORT_MAX_ROWS)
    row = owner.execute(
        "SELECT resource_type, resource_id, outcome, metadata FROM audit_events WHERE action='chat_rows.exported' AND actor_user_id='msl-t01-01' ORDER BY event_id DESC LIMIT 1"
    ).fetchone()
    assert row[:3] == ("chat_row_set", f"{run}:rs1", "allowed")
    assert row[3]["rows"] == result["rowCount"] and "Response" not in json.dumps(row[3])
    assert independent(owner, "SELECT count(*) FROM audit_events WHERE action='chat_rows.exported' AND actor_user_id='msl-t01-01'", ()) == before + 1


def test_withdrawing_the_export_permission_refuses_the_export_but_not_the_rows(owner) -> None:
    run = make_run(owner, "msl-t01-01", {**SETS["calls"]})
    owner.execute("DELETE FROM role_permissions WHERE role_id='msl' AND permission_code='chat.rows.export'")
    try:
        assert rows_total("msl-t01-01", run)["canExport"] is False
        before = independent(owner, "SELECT count(*) FROM audit_events WHERE action='chat_rows.exported'", ())
        with session("msl-t01-01") as cur, pytest.raises(Forbidden):
            chat_rows.export_chat_rows(cur, ID, "msl-t01-01", {"runId": run, "rowSetId": "rs1"})
        assert independent(owner, "SELECT count(*) FROM audit_events WHERE action='chat_rows.exported'", ()) == before
    finally:
        owner.execute("INSERT INTO role_permissions VALUES ('msl','chat.rows.export') ON CONFLICT DO NOTHING")


def test_the_evidence_drawer_export_is_audited_too(owner) -> None:
    call = owner.execute("SELECT crm_call_id FROM call_activity WHERE territory_id='T01-01' LIMIT 1").fetchone()[0]
    with session("msl-t01-01") as cur:
        chat.chat_citation(cur, ID, "msl-t01-01", {"dataset": "call_activity", "recordId": call, "auditExport": True})
    assert owner.execute("SELECT resource_type FROM audit_events WHERE action='chat_rows.exported' AND resource_id=%s", (call,)).fetchone() == ("call_activity",)


def test_the_audit_policy_refuses_other_users_and_other_actions(owner) -> None:
    with session("msl-t01-01") as cur, pytest.raises(psycopg.errors.InsufficientPrivilege):
        cur.execute("INSERT INTO audit_events(actor_user_id, action, resource_type, resource_id, outcome) VALUES ('someone-else','chat_rows.exported','chat_row_set','x','allowed')")
    with session("msl-t01-01") as cur, pytest.raises(psycopg.errors.InsufficientPrivilege):
        cur.execute("INSERT INTO audit_events(actor_user_id, action, resource_type, resource_id, outcome) VALUES ('msl-t01-01','admin.anything','chat_row_set','x','allowed')")


def test_a_bad_sort_is_refused_by_the_database_layer_too(owner) -> None:
    run = make_run(owner, "msl-t01-01", {**SETS["calls"]})
    with session("msl-t01-01") as cur, pytest.raises(BadRequest):
        chat_rows.chat_answer_rows(cur, ID, "msl-t01-01", {"runId": run, "rowSetId": "rs1", "sortBy": "call_dt; DROP TABLE call_activity"})
