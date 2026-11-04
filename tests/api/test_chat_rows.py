"""Show rows (ticket #84), proved through the API as seeded personas with live Claude.

The path is AppSync -> BE Lambda -> chat worker -> Strands agent -> floci Bedrock proxy -> LiteLLM -> Claude. The agent
describes the rows behind each figure it computed (a ``row_sets`` event); the table itself is read back with
``chatAnswerRows`` and exported with ``exportChatRows``, both by run id and row-set id, under the caller's RLS session.

What the model says does not matter here: the row sets come from the deterministic tools and the model only chooses
which tool to run. Every expected number is recounted with the owner role (no RLS) from raw rows, independent of the
SQL the agent and the BE Lambda run.
"""

from __future__ import annotations

import csv
import io
import json

import pytest

from ground_truth import region_territories
from harness import Persona, owner_db

ROWS = """
query Rows($runId: ID!, $rowSetId: ID!, $sortBy: String, $sortDir: ChatRowSortDir, $offset: Int, $limit: Int) {
  chatAnswerRows(runId: $runId, rowSetId: $rowSetId, sortBy: $sortBy, sortDir: $sortDir, offset: $offset, limit: $limit) {
    rowSetId kind label scope period definition total answerCount offset limit sortBy sortDir canExport dataThrough
    columns { key label type }
    rows { id cells }
  }
}
"""
EXPORT = """
mutation Export($runId: ID!, $rowSetId: ID!, $sortBy: String, $sortDir: ChatRowSortDir) {
  exportChatRows(runId: $runId, rowSetId: $rowSetId, sortBy: $sortBy, sortDir: $sortDir) {
    rowSetId fileName mimeType content rowCount total truncated exportedAt
  }
}
"""
AUDIT = """
query Audit($filter: AccessAuditFilter) {
  accessAudit(filter: $filter) { eventId actorUserId action resourceType resourceId outcome }
}
"""
OCT = ("2026-10-01", "2026-10-31")
Q = "How many distinct calls did I have between 2026-10-01 and 2026-10-31?"


def row_sets(run) -> list[dict]:
    return [s for value in run.custom("row_sets") for s in value["row_sets"]]


def rows(persona: Persona, run, row_set: dict, **vars):
    return persona.query(ROWS, {"runId": run.run_id, "rowSetId": row_set["row_set_id"], **vars})


def page(persona: Persona, run, row_set: dict, **vars) -> dict:
    res = rows(persona, run, row_set, **vars)
    assert not res.errors, res.errors
    return res.data["chatAnswerRows"]


def by_kind(run, kind: str, period: tuple[str, str] | None = None) -> dict:
    """The row set of one kind. The model may call a tool more than once (a default window and the asked one), so a
    question about a period picks the set for that period."""
    return next(s for s in row_sets(run) if s["kind"] == kind and (period is None or (s["period_from"], s["period_to"]) == period))


@pytest.fixture(scope="module")
def counts_run(msl):
    return msl.chat(Q)


@pytest.fixture(scope="module")
def activity_run(msl):
    return msl.chat("How many distinct calls, engaged HCPs and insight responses did I have between 2026-10-01 and 2026-10-31?")


def test_every_number_the_agent_computed_has_rows_that_add_up_to_it(msl, counts_run, db):
    sets = row_sets(counts_run)
    assert sets, "a counted answer always comes with the rows it counted"
    facts = {f["fact_id"]: f["value"] for f in counts_run.facts}
    sql = {
        "calls": "SELECT count(DISTINCT crm_call_id) FROM call_activity WHERE territory_id = 'T01-01' AND call_dt BETWEEN %s AND %s",
        "hcps": "SELECT count(DISTINCT cust_mdm_id) FROM call_activity WHERE territory_id = 'T01-01' AND call_dt BETWEEN %s AND %s",
        "responses": "SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE territory_id = 'T01-01' AND date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE",
    }
    for s in sets:
        got = page(msl, counts_run, s, limit=100)
        # The set says what the tool counted, the table lists that many rows, and an independent recount agrees.
        frm, to = s["period_from"], s["period_to"]
        assert s["count"] == got["total"] == got["answerCount"] == db.execute(sql[s["kind"]], (frm, to)).fetchone()[0], s
        if s["source_id"] in facts:
            assert facts[s["source_id"]] == s["count"]
        assert len(got["rows"]) == min(got["limit"], got["total"]) and got["kind"] == s["kind"].upper()


def test_the_three_figures_of_an_activity_answer_each_list_their_own_rows(msl, activity_run, db):
    kinds = {s["kind"] for s in row_sets(activity_run)}
    assert kinds == {"calls", "hcps", "responses"}
    calls = page(msl, activity_run, by_kind(activity_run, "calls", OCT), limit=100)
    col = [c["key"] for c in calls["columns"]]
    assert col[:3] == ["id", "date", "type"] and {r["cells"][col.index("territory")] for r in calls["rows"]} == {"T01-01"}
    hcps = page(msl, activity_run, by_kind(activity_run, "hcps", OCT), limit=100)
    assert hcps["total"] == db.execute(
        "SELECT count(DISTINCT cust_mdm_id) FROM call_activity WHERE territory_id='T01-01' AND call_dt BETWEEN %s AND %s", OCT
    ).fetchone()[0]
    assert len({r["id"] for r in hcps["rows"]}) == len(hcps["rows"]), "one row per HCP"


def test_rows_are_sorted_on_the_server_and_paged_without_repeats(msl, counts_run, db):
    s = by_kind(counts_run, "calls", OCT)
    total = page(msl, counts_run, s, limit=1)["total"]
    ids: list[str] = []
    minutes: list[int | None] = []
    for offset in range(0, total, 100):
        got = page(msl, counts_run, s, sortBy="minutes", sortDir="DESC", offset=offset, limit=100)
        idx = [c["key"] for c in got["columns"]].index("minutes")
        ids += [r["id"] for r in got["rows"]]
        minutes += [None if r["cells"][idx] is None else int(r["cells"][idx]) for r in got["rows"]]
    assert len(ids) == len(set(ids)) == total
    present = [m for m in minutes if m is not None]
    assert present == sorted(present, reverse=True) and minutes[: len(present)] == present, "nulls sort last"
    top = db.execute(
        "SELECT max(call_dur) FROM call_activity WHERE territory_id='T01-01' AND call_dt BETWEEN %s AND %s", OCT
    ).fetchone()[0]
    assert present[0] == top
    default = page(msl, counts_run, s)
    assert default["sortBy"] == "date" and default["sortDir"] == "DESC" and default["limit"] == 25


def test_a_share_lists_all_the_responses_and_the_ones_that_chose_the_answer(msl, db):
    run = msl.chat(
        "What percentage of the responses to Q-0145 were Yes between 2025-11-04 and 2026-11-03? Tell me how many responses that is out of."
    )
    sets = row_sets(run)
    everything = next(s for s in sets if s.get("question_id") == "Q-0145" and "answer_label" not in s)
    yes = next(s for s in sets if s.get("question_id") == "Q-0145" and s.get("answer_label") == "Yes")
    base = "FROM hcp_raw_insights WHERE territory_id='T01-01' AND qstn_ext_id='Q-0145' AND date_of_interaction BETWEEN '2025-11-04' AND '2026-11-03' AND excluded_rspns_flag IS NOT TRUE AND uniq_rspns_id IS NOT NULL"
    denominator = db.execute("SELECT count(DISTINCT uniq_rspns_id) " + base).fetchone()[0]
    numerator = db.execute("SELECT count(DISTINCT uniq_rspns_id) " + base + " AND btrim(rspns_txt) = 'Yes'").fetchone()[0]
    assert page(msl, run, everything, limit=100)["total"] == everything["count"] == denominator
    listed = page(msl, run, yes, limit=100)
    assert listed["total"] == yes["count"] == numerator > 0
    answer = [c["key"] for c in listed["columns"]].index("answer")
    assert {r["cells"][answer] for r in listed["rows"]} == {"Yes"}


def test_a_chart_has_the_rows_its_total_counted(msl, db):
    run = msl.chat("Show my calls by month over the last 90 days.")
    chart = next(v for v in run.custom("visual") if v.get("phase") == "ready" and v["metric"] == "calls")
    s = next(s for s in row_sets(run) if s["source_id"] == chart["visual_id"] or s["count"] == chart["total"])
    got = page(msl, run, s, limit=100)
    frm, to = chart["period"].split(" to ")
    assert chart["total"] == got["total"] == s["count"] == db.execute(
        "SELECT count(DISTINCT crm_call_id) FROM call_activity WHERE territory_id='T01-01' AND call_dt BETWEEN %s AND %s", (frm, to)
    ).fetchone()[0]


def test_a_director_lists_the_rows_of_the_whole_region(db):
    director = Persona.sign_in("director-region-01")
    run = director.chat("How many distinct calls did my region have between 2026-10-01 and 2026-10-31?")
    s = by_kind(run, "calls", OCT)
    mine = set(region_territories(db, "REGION-01")) - {"NATIONAL-01"}
    got = page(director, run, s, limit=100)
    assert got["total"] == s["count"] == db.execute(
        "SELECT count(DISTINCT crm_call_id) FROM call_activity WHERE territory_id = ANY(%s) AND call_dt BETWEEN %s AND %s", (sorted(mine), *OCT)
    ).fetchone()[0]
    col = [c["key"] for c in got["columns"]].index("territory")
    assert {r["cells"][col] for r in got["rows"]} <= mine


def test_another_users_rows_are_indistinguishable_from_rows_that_do_not_exist(msl, other_msl, counts_run):
    s = by_kind(counts_run, "calls", OCT)
    theirs = rows(other_msl, counts_run, s)
    nothing = rows(msl, counts_run, {"row_set_id": "rs99"})
    assert "NotFound" in theirs.error_types and "NotFound" in nothing.error_types
    assert [e["message"] for e in theirs.errors] == [e["message"] for e in nothing.errors]
    assert "NotFound" in other_msl.query(EXPORT, {"runId": counts_run.run_id, "rowSetId": s["row_set_id"]}).error_types


def test_bad_arguments_are_refused(msl, counts_run):
    s = by_kind(counts_run, "calls", OCT)
    for bad in ({"sortBy": "call_dt; DROP TABLE call_activity"}, {"sortBy": "nope"}, {"limit": 0}, {"limit": 101}, {"offset": -1}):
        assert "BadRequest" in rows(msl, counts_run, s, **bad).error_types, bad
    assert "BadRequest" in msl.query(ROWS, {"runId": "x", "rowSetId": s["row_set_id"]}).error_types
    assert "BadRequest" in msl.query(ROWS, {"runId": counts_run.run_id, "rowSetId": "rs1; --"}).error_types


def test_an_executive_gets_no_rows_and_a_clear_note():
    executive = Persona.sign_in("executive-region-01")
    run = executive.chat("How many distinct calls did my region have between 2026-10-01 and 2026-10-31? Show me the rows.")
    assert row_sets(run) == [], "aggregate-only access never receives a row set"
    assert all(c.get("kind") == "aggregate" for c in run.citations), "an Executive's sources describe groups, never records"
    assert run.custom("rows_unavailable") in ([{"reason": "aggregate_only"}], []), "once per run, only when a tool was called"
    # Whatever the run held, the API refuses rows to an aggregate-only caller, for their own run and for anyone else's.
    assert "Forbidden" in rows(executive, run, {"row_set_id": "rs1"}).error_types
    assert "Forbidden" in executive.query(EXPORT, {"runId": run.run_id, "rowSetId": "rs1"}).error_types


def test_an_executive_cannot_read_an_msls_rows_by_naming_the_run(counts_run):
    executive = Persona.sign_in("executive-region-01")
    res = rows(executive, counts_run, by_kind(counts_run, "calls", OCT))
    assert res.data is None and res.error_types and res.error_types[0] in ("Forbidden", "NotFound")


def test_export_rechecks_access_is_audited_and_carries_the_same_rows(msl, counts_run, db):
    s = by_kind(counts_run, "calls", OCT)
    before = db.execute("SELECT count(*) FROM audit_events WHERE action = 'chat_rows.exported' AND actor_user_id = 'msl-t01-01'").fetchone()[0]
    res = msl.query(EXPORT, {"runId": counts_run.run_id, "rowSetId": s["row_set_id"], "sortBy": "date", "sortDir": "ASC"})
    assert not res.errors, res.errors
    file = res.data["exportChatRows"]
    lines = file["content"].splitlines()
    assert lines[0].startswith("# [SOURCE]") and file["mimeType"].startswith("text/csv") and file["fileName"].endswith(".csv")
    body = list(csv.reader(io.StringIO("\n".join(line for line in lines if not line.startswith("#")))))
    assert body[0][:3] == ["Call", "Date", "Type"]
    assert len(body) - 1 == file["rowCount"] == file["total"] == s["count"] and not file["truncated"]
    assert len({r[0] for r in body[1:]}) == s["count"], "each call once"
    dates = [r[1] for r in body[1:]]
    assert dates == sorted(dates)
    # The audit trail has one more event, with ids and counts only.
    after = db.execute("SELECT count(*) FROM audit_events WHERE action = 'chat_rows.exported' AND actor_user_id = 'msl-t01-01'").fetchone()[0]
    assert after == before + 1
    action, rtype, rid, outcome, meta = db.execute(
        "SELECT action, resource_type, resource_id, outcome, metadata FROM audit_events WHERE action = 'chat_rows.exported' AND actor_user_id = 'msl-t01-01' ORDER BY event_id DESC LIMIT 1"
    ).fetchone()
    assert (rtype, rid, outcome) == ("chat_row_set", f"{counts_run.run_id}:{s['row_set_id']}", "allowed")
    assert meta["rows"] == file["rowCount"] and not any(row[0] in json.dumps(meta) for row in body[1:6])
    # An administrator reads the same event through the access audit.
    admin = Persona.sign_in("admin-region-01")
    listed = admin.query(AUDIT, {"filter": {"action": "chat_rows.exported", "actorUserId": "msl-t01-01"}})
    assert any(e["resourceId"] == rid for e in listed.data["accessAudit"])


def test_withdrawing_the_export_permission_keeps_the_rows_but_refuses_and_records_no_export(msl, counts_run):
    s = by_kind(counts_run, "calls", OCT)
    with owner_db() as owner:
        owner.execute("DELETE FROM role_permissions WHERE role_id = 'msl' AND permission_code = 'chat.rows.export'")
        try:
            got = page(msl, counts_run, s, limit=5)
            assert got["canExport"] is False and got["total"] == s["count"]
            before = owner.execute("SELECT count(*) FROM audit_events WHERE action = 'chat_rows.exported'").fetchone()[0]
            res = msl.query(EXPORT, {"runId": counts_run.run_id, "rowSetId": s["row_set_id"]})
            assert "Forbidden" in res.error_types
            assert owner.execute("SELECT count(*) FROM audit_events WHERE action = 'chat_rows.exported'").fetchone()[0] == before
        finally:
            owner.execute("INSERT INTO role_permissions VALUES ('msl', 'chat.rows.export') ON CONFLICT DO NOTHING")
    assert page(msl, counts_run, s, limit=5)["canExport"] is True


def test_out_of_scope_questions_get_no_rows(msl):
    run = msl.chat("How many distinct calls did territory T02-01 have between 2026-10-01 and 2026-10-31? Show me the rows.")
    assert all(s.get("territory_id") != "T02-01" for s in row_sets(run))
    assert all("T02-01" not in json.dumps(s) for s in row_sets(run))
