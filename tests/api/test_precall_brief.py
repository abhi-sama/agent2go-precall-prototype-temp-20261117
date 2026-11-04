"""Pre-call brief (ticket 05), proven through AppSync as seeded personas.

Generation takes the full approved route (AppSync -> BE Lambda -> agent -> Bedrock via floci) and the
brief is read back from FE DynamoDB. The owner database connection is used only to arrange state
(reassign territory, simulate a data reload) and to compute ground truth.
"""

from __future__ import annotations

import re
import uuid

import pytest

from harness import Persona, _client, agent_logs, be_lambda_logs

BRIEF_FIELDS = """
  briefId hcpId hcpName { value state } objective ownerUserId scopeLabel scopeTerritoryIds dataThrough
  generatedAt updatedAt modelMode numberCheck droppedStatements stale staleReasons currentDataThrough lastInteractionDate
  facts { label value evidenceIds }
  engagement { statementId text evidenceIds }
  perspectives { statementId text evidenceIds }
  followUps { statementId text evidenceIds }
  prompts { itemId text detail evidenceIds origin edited }
  agenda { itemId text detail evidenceIds origin edited }
  missing { code message }
  evidence { evidenceId dataset recordId label date }
  regeneratesBriefId
"""
GENERATE = "mutation G($hcpId: ID!, $objective: String!, $regen: ID) { generateBrief(hcpId: $hcpId, objective: $objective, regeneratesBriefId: $regen) { %s } }" % BRIEF_FIELDS
OPEN = "query O($briefId: ID!) { preCallBrief(briefId: $briefId) { %s } }" % BRIEF_FIELDS
LIST = "query { myBriefs { briefId hcpId hcpName { value state } objective generatedAt dataThrough accessible stale } }"
EDIT = "mutation E($input: BriefEditInput!) { saveBriefEdits(input: $input) { %s } }" % BRIEF_FIELDS
EXPORT = """
mutation Export($briefId: ID!) {
  exportBrief(briefId: $briefId) {
    briefId hcpName objective scopeLabel dateRangeFrom dateRangeTo dataThrough generatedAt exportedAt
    facts { label value evidenceIds }
    engagement { statementId text evidenceIds }
    perspectives { statementId text evidenceIds }
    followUps { statementId text evidenceIds }
    prompts { itemId text detail evidenceIds origin edited }
    agenda { itemId text detail evidenceIds origin edited }
    missing { code message }
    citations { evidenceId dataset recordId label date }
  }
}
"""
CITATION = "query C($d: String!, $r: ID!) { chatCitation(dataset: $d, recordId: $r) { dataset recordId title fields { label value } } }"
AUDIT = "query Audit($filter: AccessAuditFilter) { accessAudit(filter: $filter) { actorUserId action resourceType resourceId outcome } }"

TABLE = "a2g-precall-briefs"
FE = "111111111111"
OBJECTIVE = "Understand how the care team weighs access evidence before the next scientific exchange"
HCP = "HCP-0001"  # canonical id of an HCP in territory T01-01


def generate(persona: Persona, hcp: str = HCP, objective: str = OBJECTIVE, regen: str | None = None):
    return persona.query(GENERATE, {"hcpId": hcp, "objective": objective, "regen": regen})


def ok(result, key: str):
    assert not result.errors, result.errors
    return result.data[key]


def fe_items(user_id: str) -> list[dict]:
    out = _client("dynamodb", FE).query(
        TableName=TABLE,
        KeyConditionExpression="pk = :pk",
        ExpressionAttributeValues={":pk": {"S": f"USER#{user_id}"}},
    )
    return out["Items"]


def clear(user_id: str) -> None:
    client = _client("dynamodb", FE)
    for item in fe_items(user_id):
        client.delete_item(TableName=TABLE, Key={"pk": item["pk"], "sk": item["sk"]})


@pytest.fixture(autouse=True)
def clean_briefs():
    users = ("msl-t01-01", "msl-t02-01")
    for user in users:
        clear(user)
    yield
    for user in users:
        clear(user)


def statements(brief: dict) -> list[dict]:
    return [*brief["engagement"], *brief["perspectives"], *brief["followUps"], *brief["prompts"]]


def test_export_rechecks_access_returns_print_data_and_writes_the_access_audit(msl, db):
    brief = ok(generate(msl), "generateBrief")
    exported = ok(msl.query(EXPORT, {"briefId": brief["briefId"]}), "exportBrief")
    assert exported["scopeLabel"] == brief["scopeLabel"]
    assert exported["generatedAt"] == brief["generatedAt"] and exported["exportedAt"]
    assert exported["dateRangeFrom"] <= exported["dateRangeTo"]
    assert exported["citations"] == brief["evidence"]
    assert exported["engagement"] == brief["engagement"]
    audit = ok(
        Persona.sign_in("admin-region-01").query(
            AUDIT,
            {"filter": {"actorUserId": "msl-t01-01", "action": "brief.exported", "resourceType": "pre_call_brief", "outcome": "allowed"}},
        ),
        "accessAudit",
    )
    assert any(event["resourceId"] == brief["briefId"] for event in audit)

    (moved_id,) = db.execute(
        """INSERT INTO user_scope_assignments(user_id, territory_id, assignment_type, effective_from)
           VALUES ('msl-t01-01', 'T02-01', 'temporary', now() - interval '1 minute') RETURNING assignment_id"""
    ).fetchone()
    try:
        db.execute("UPDATE user_scope_assignments SET effective_to = now() WHERE user_id='msl-t01-01' AND territory_id='T01-01' AND effective_to IS NULL")
        denied = msl.query(EXPORT, {"briefId": brief["briefId"]})
        assert "Forbidden" in denied.error_types
    finally:
        db.execute("DELETE FROM user_scope_assignments WHERE assignment_id = %s", (moved_id,))
        db.execute("UPDATE user_scope_assignments SET effective_to = NULL WHERE user_id='msl-t01-01' AND territory_id='T01-01'")


def test_every_statement_links_to_a_source_call_or_response_record(msl, db):
    brief = ok(generate(msl), "generateBrief")
    assert brief["hcpId"] == HCP and brief["hcpName"]["state"] == "PRESENT"
    assert brief["engagement"] and brief["perspectives"] and brief["prompts"] and brief["agenda"]

    evidence = {e["evidenceId"]: e for e in brief["evidence"]}
    for statement in statements(brief):
        assert statement["evidenceIds"], statement
        assert set(statement["evidenceIds"]) <= set(evidence), "citation to a record that is not in the evidence list"
    for fact in brief["facts"]:
        assert fact["evidenceIds"] and set(fact["evidenceIds"]) <= set(evidence)

    # Ground truth: every cited record really is one of this HCP's calls or responses.
    calls = {r[0] for r in db.execute(
        "SELECT DISTINCT c.crm_call_id FROM call_activity c JOIN hcp_identifier_crosswalk x ON x.source_system='call_activity.cust_mdm_id' AND x.source_identifier=c.cust_mdm_id WHERE x.hcp_id=%s", (HCP,))}
    responses = {r[0] for r in db.execute(
        "SELECT DISTINCT i.uniq_rspns_id FROM hcp_raw_insights i JOIN hcp_identifier_crosswalk x ON x.source_system='hcp_raw_insights.cust_mdm_id' AND x.source_identifier=i.cust_mdm_id WHERE x.hcp_id=%s", (HCP,))}
    for item in evidence.values():
        pool = calls if item["dataset"] == "call_activity" else responses
        assert item["recordId"] in pool, item

    # ...and each opens as a source record for the person who wrote the brief.
    for item in list(evidence.values())[:4]:
        record = msl.query(CITATION, {"d": item["dataset"], "r": item["recordId"]})
        assert ok(record, "chatCitation")["recordId"] == item["recordId"]


def test_counts_are_deterministic_distinct_calls_not_call_product_rows(msl, db):
    brief = ok(generate(msl), "generateBrief")
    distinct = db.execute(
        "SELECT count(DISTINCT c.crm_call_id) FROM call_activity c JOIN hcp_identifier_crosswalk x ON x.source_system='call_activity.cust_mdm_id' AND x.source_identifier=c.cust_mdm_id WHERE x.hcp_id=%s",
        (HCP,),
    ).fetchone()[0]
    rows = db.execute("SELECT count(*) FROM call_activity WHERE cust_mdm_id=%s", (HCP,)).fetchone()[0]
    assert rows > distinct, "the seed repeats a call once per product"
    facts = {f["label"]: f["value"] for f in brief["facts"]}
    assert facts["Calls on record"] == str(distinct)


def test_agenda_and_prompts_are_generated_and_stay_editable(msl):
    brief = ok(generate(msl), "generateBrief")
    assert all(i["origin"] == "GENERATED" and i["edited"] is False for i in brief["prompts"] + brief["agenda"])

    prompts = [{"itemId": brief["prompts"][0]["itemId"], "text": "My reworded discussion question?"}]
    prompts += [{"itemId": p["itemId"], "text": p["text"]} for p in brief["prompts"][1:]]
    prompts.append({"text": "A question I added myself"})
    agenda = [{"itemId": a["itemId"], "text": a["text"], "detail": a["detail"]} for a in brief["agenda"][1:]]  # removed the first item
    edited = ok(msl.query(EDIT, {"input": {"briefId": brief["briefId"], "objective": "A sharper objective", "prompts": prompts, "agenda": agenda}}), "saveBriefEdits")

    assert edited["objective"] == "A sharper objective"
    first = edited["prompts"][0]
    assert first["text"] == "My reworded discussion question?" and first["origin"] == "GENERATED" and first["edited"] is True
    assert first["evidenceIds"] == brief["prompts"][0]["evidenceIds"], "an edit cannot change what the prompt cites"
    added = edited["prompts"][-1]
    assert added["origin"] == "USER" and added["edited"] is False and added["evidenceIds"] == []
    assert len(edited["agenda"]) == len(brief["agenda"]) - 1

    # Edits persist: a fresh open returns them, and the generated/user labels survive.
    reopened = ok(msl.query(OPEN, {"briefId": brief["briefId"]}), "preCallBrief")
    assert reopened["prompts"] == edited["prompts"] and reopened["agenda"] == edited["agenda"]
    assert reopened["updatedAt"] >= reopened["generatedAt"]

    # A client cannot mint a "generated" item or cite records through an edit.
    forged = msl.query(EDIT, {"input": {"briefId": brief["briefId"], "agenda": [{"itemId": "g-a99", "text": "forged"}]}})
    assert "BadRequest" in forged.error_types


def test_saved_brief_carries_owner_scope_data_through_generation_time_and_evidence(msl, db):
    brief = ok(generate(msl), "generateBrief")
    assert brief["ownerUserId"] == "msl-t01-01"
    assert brief["scopeLabel"].startswith("T01-01") and "T01-01" in brief["scopeTerritoryIds"]
    assert brief["dataThrough"] and brief["generatedAt"]

    (item,) = fe_items("msl-t01-01")
    assert item["pk"]["S"] == "USER#msl-t01-01" and item["sk"]["S"] == f"BRIEF#{brief['briefId']}"
    assert item["ownerUserId"]["S"] == "msl-t01-01"
    assert item["scopeLabel"]["S"] == brief["scopeLabel"]
    assert item["dataThrough"]["S"] == brief["dataThrough"]
    assert item["generatedAt"]["S"] == brief["generatedAt"]
    assert len(item["evidence"]["L"]) == len(brief["evidence"]) > 0
    # Data-through is a load date from the source data, not "now".
    loaded = db.execute("SELECT LEAST((SELECT max(sys_inserted_datetime) FROM call_activity),(SELECT max(sys_inserted_datetime) FROM hcp_raw_insights))").fetchone()[0]
    assert brief["dataThrough"].startswith(loaded.astimezone(__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M"))
    assert brief["modelMode"] in ("claude", "stub")


def test_briefs_are_private_to_their_owner(msl, other_msl):
    brief = ok(generate(msl), "generateBrief")
    denied = other_msl.query(OPEN, {"briefId": brief["briefId"]})
    assert denied.data is None or denied.data.get("preCallBrief") is None
    assert "NotFound" in denied.error_types
    assert ok(other_msl.query(LIST), "myBriefs") == []
    assert [b["briefId"] for b in ok(msl.query(LIST), "myBriefs")] == [brief["briefId"]]
    assert fe_items("msl-t02-01") == []


def test_an_hcp_outside_scope_is_refused_and_nothing_is_saved(msl, other_msl):
    res = generate(other_msl)  # HCP-0001 belongs to T01-01
    assert res.data is None or res.data.get("generateBrief") is None
    assert "Forbidden" in res.error_types
    assert fe_items("msl-t02-01") == []
    missing = generate(msl, hcp="HCP-DOES-NOT-EXIST")
    assert "Forbidden" in missing.error_types, "absent and out-of-scope look the same"


def test_aggregate_only_persona_cannot_generate_a_brief():
    res = generate(Persona.sign_in("executive-region-01"))
    assert "Forbidden" in res.error_types


@pytest.mark.parametrize("objective", ["", "  ", "ab", "x" * 501])
def test_a_missing_or_oversized_objective_is_a_bad_request(msl, objective):
    assert "BadRequest" in generate(msl, objective=objective).error_types
    assert fe_items("msl-t01-01") == []


def test_reopening_after_territory_reassignment_is_denied(msl, db):
    brief = ok(generate(msl), "generateBrief")
    assert ok(msl.query(OPEN, {"briefId": brief["briefId"]}), "preCallBrief")["briefId"] == brief["briefId"]

    (moved_id,) = db.execute(
        """INSERT INTO user_scope_assignments(user_id, territory_id, assignment_type, effective_from)
           VALUES ('msl-t01-01', 'T02-01', 'temporary', now() - interval '1 minute') RETURNING assignment_id"""
    ).fetchone()
    try:
        # Transfer: the T01-01 assignment ends, so HCP-0001 (T01-01) is no longer authorized.
        db.execute("UPDATE user_scope_assignments SET effective_to = now() WHERE user_id='msl-t01-01' AND territory_id='T01-01' AND effective_to IS NULL")
        denied = msl.query(OPEN, {"briefId": brief["briefId"]})
        assert denied.data is None or denied.data.get("preCallBrief") is None
        assert "Forbidden" in denied.error_types

        listed = ok(msl.query(LIST), "myBriefs")
        assert [(b["briefId"], b["accessible"]) for b in listed] == [(brief["briefId"], False)]
        assert listed[0]["hcpId"] is None and listed[0]["hcpName"] is None and listed[0]["objective"] is None

        edit = msl.query(EDIT, {"input": {"briefId": brief["briefId"], "objective": "should not be saved"}})
        assert "Forbidden" in edit.error_types
        regenerate = generate(msl, regen=brief["briefId"])
        assert "Forbidden" in regenerate.error_types
    finally:
        db.execute("DELETE FROM user_scope_assignments WHERE assignment_id = %s", (moved_id,))
        db.execute("UPDATE user_scope_assignments SET effective_to = NULL WHERE user_id='msl-t01-01' AND territory_id='T01-01'")
    # Access returned, so the brief opens again with nothing lost.
    assert ok(msl.query(OPEN, {"briefId": brief["briefId"]}), "preCallBrief")["objective"] == OBJECTIVE
    assert ok(msl.query(LIST), "myBriefs")[0]["accessible"] is True


def _reload_hcp_data(db, tag: str) -> dict[str, str]:
    """Simulate a data reload: new call and response rows for the HCP, loaded now."""
    call_id, resp_id = f"CALL-{tag}", f"RESP-{tag}"
    db.execute(
        """INSERT INTO call_activity (crm_call_id, call_dt, call_chnl, call_type, call_sta, prd_nm, reason_for_visit,
             territory_id, territory_name, cust_mdm_id, sys_inserted_datetime)
           VALUES (%s, current_date, 'field', 'scientific', 'completed', 'osimertinib', 'post-reload follow-up',
             'T01-01', 'Territory 01-01', %s, now())""",
        (call_id, HCP),
    )
    db.execute(
        """INSERT INTO hcp_raw_insights (insight_intrctn_dtl_sfdc_id, date_of_interaction, territory_id, territory_name,
             cust_mdm_id, qstn_ext_id, qstn_txt, rspns_txt, uniq_rspns_id, sys_inserted_datetime)
           VALUES (%s, current_date, 'T01-01', 'Territory 01-01', 'LEGACY-HCP-0001', 'Q-RELOAD',
             'What changed after the reload?', 'Reloaded recorded perspective about access', %s, now())""",
        (f"INT-{tag}", resp_id),
    )
    return {"call": call_id, "response": resp_id}


def _undo_reload(db, tag: str) -> None:
    db.execute("DELETE FROM call_activity WHERE crm_call_id = %s", (f"CALL-{tag}",))
    db.execute("DELETE FROM hcp_raw_insights WHERE uniq_rspns_id = %s", (f"RESP-{tag}",))


def test_after_a_data_reload_the_stale_badge_appears_and_regenerate_works(msl, db):
    first = ok(generate(msl), "generateBrief")
    assert first["stale"] is False and first["staleReasons"] == []
    assert ok(msl.query(OPEN, {"briefId": first["briefId"]}), "preCallBrief")["stale"] is False
    assert ok(msl.query(LIST), "myBriefs")[0]["stale"] is False

    tag = uuid.uuid4().hex[:8].upper()
    ids = _reload_hcp_data(db, tag)
    try:
        reopened = ok(msl.query(OPEN, {"briefId": first["briefId"]}), "preCallBrief")
        assert reopened["stale"] is True
        assert "HCP_DATA_CHANGED" in reopened["staleReasons"]
        assert reopened["dataThrough"] == first["dataThrough"], "the saved brief keeps the date it was generated against"
        assert reopened["currentDataThrough"] > reopened["dataThrough"]
        assert ok(msl.query(LIST), "myBriefs")[0]["stale"] is True
        # The old brief still opens: stale is a badge, not a denial. Its evidence is unchanged.
        assert {e["recordId"] for e in reopened["evidence"]} == {e["recordId"] for e in first["evidence"]}

        regenerated = ok(generate(msl, objective=first["objective"], regen=first["briefId"]), "generateBrief")
        assert regenerated["briefId"] != first["briefId"] and regenerated["regeneratesBriefId"] == first["briefId"]
        assert regenerated["stale"] is False
        record_ids = {e["recordId"] for e in regenerated["evidence"]}
        assert ids["call"] in record_ids and ids["response"] in record_ids, "the regenerated brief covers the reloaded data"
        assert regenerated["dataThrough"] > first["dataThrough"]
        assert ok(msl.query(OPEN, {"briefId": regenerated["briefId"]}), "preCallBrief")["stale"] is False
        assert len(ok(msl.query(LIST), "myBriefs")) == 2
    finally:
        _undo_reload(db, tag)


def test_a_newer_load_elsewhere_marks_briefs_stale_with_its_own_reason(msl, db):
    brief = ok(generate(msl), "generateBrief")
    tag = uuid.uuid4().hex[:8].upper()
    # Another HCP in scope is reloaded; this HCP's own records are unchanged.
    db.execute(
        """INSERT INTO call_activity (crm_call_id, call_dt, call_chnl, territory_id, cust_mdm_id, sys_inserted_datetime)
           VALUES (%s, current_date, 'field', 'T01-01', 'HCP-0002', now())""",
        (f"CALL-{tag}",),
    )
    db.execute(
        """INSERT INTO hcp_raw_insights (insight_intrctn_dtl_sfdc_id, date_of_interaction, territory_id, cust_mdm_id,
             qstn_ext_id, qstn_txt, rspns_txt, uniq_rspns_id, sys_inserted_datetime)
           VALUES (%s, current_date, 'T01-01', 'LEGACY-HCP-0002', 'Q-RELOAD', 'q', 'a', %s, now())""",
        (f"INT-{tag}", f"RESP-{tag}"),
    )
    try:
        reopened = ok(msl.query(OPEN, {"briefId": brief["briefId"]}), "preCallBrief")
        assert reopened["stale"] is True and reopened["staleReasons"] == ["NEWER_DATA_LOADED"]
    finally:
        _undo_reload(db, tag)
    assert ok(msl.query(OPEN, {"briefId": brief["briefId"]}), "preCallBrief")["stale"] is False


def test_missing_information_is_stated_not_filled_in(msl, db):
    tag = uuid.uuid4().hex[:8].upper()
    hcp = f"HCP-T05-{tag}"
    db.execute("INSERT INTO hcp_entities(hcp_id) VALUES (%s)", (hcp,))
    db.execute("INSERT INTO hcp_identifier_crosswalk(source_system, source_identifier, hcp_id) VALUES ('call_activity.cust_mdm_id', %s, %s)", (hcp, hcp))
    db.execute(
        """INSERT INTO call_activity (crm_call_id, call_dt, call_chnl, call_type, territory_id, territory_name, cust_mdm_id, cust_full_nm, sys_inserted_datetime)
           VALUES (%s, current_date - 400, 'field', 'scientific', 'T01-01', 'Territory 01-01', %s, 'Call only HCP', now())""",
        (f"CALL-{tag}", hcp),
    )
    try:
        brief = ok(generate(msl, hcp=hcp), "generateBrief")
        codes = {m["code"] for m in brief["missing"]}
        assert {"NO_RESPONSES", "PROFILE_SPECIALTY_MISSING", "NO_RECENT_INTERACTION"} <= codes
        assert brief["perspectives"] == [] and brief["followUps"] == []
        assert all(e["dataset"] == "call_activity" for e in brief["evidence"])
        for statement in statements(brief):
            assert statement["evidenceIds"]
    finally:
        db.execute("DELETE FROM call_activity WHERE cust_mdm_id = %s", (hcp,))
        db.execute("DELETE FROM hcp_identifier_crosswalk WHERE hcp_id = %s", (hcp,))
        db.execute("DELETE FROM hcp_entities WHERE hcp_id = %s", (hcp,))


def test_logs_carry_ids_and_counts_never_objectives_names_or_recorded_answers(msl, db):
    secret = "Zebra-quartz objective phrase 7731"
    brief = ok(generate(msl, objective=secret), "generateBrief")
    sample_answer = db.execute(
        "SELECT rspns_txt FROM hcp_raw_insights WHERE uniq_rspns_id = %s",
        (next(e["recordId"] for e in brief["evidence"] if e["dataset"] == "hcp_raw_insights"),),
    ).fetchone()[0]
    name = db.execute("SELECT min(cust_full_nm) FROM call_activity WHERE cust_mdm_id = %s", (HCP,)).fetchone()[0]
    logs = be_lambda_logs("5m") + agent_logs("5m")
    assert brief["briefId"] in logs, "the brief id is how a run is traced"
    for sensitive in (secret, "7731", sample_answer, name, "msl.t01-01@example.test"):
        assert sensitive and sensitive not in logs
    assert not re.search(r"eyJ[A-Za-z0-9_-]{10,}", logs), "no token in any log"
