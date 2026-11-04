"""Executive themes, the topic-by-region matrix and leadership summaries, proven through the AppSync API as seeded
personas (ticket 13, #14).

Expectations are computed with the owner role (no RLS) straight from the source rows, so a scoping, counting or
suppression bug in the Lambda cannot also hide in the expected value. Rows a test plants live in a quiet window
before the seed's data, so they are the only responses there.
"""

from __future__ import annotations

import contextlib
import json
import re
import uuid

import pytest

from harness import Persona, be_lambda_logs, fe_dynamodb, seeded_user, state

FROM, TO = "2026-08-01", "2026-10-31"
QUIET_FROM, QUIET_TO = "2024-12-01", "2024-12-31"  # before the seed's data; the prior window is quiet too
COUNT = "{ value suppressed }"
CITATION = f"citationId kind dataset label responses {COUNT} recordId excerpt interactionDate"
DISCLOSURE = "minCell text suppressedCells applied"

THEMES = f"""
query Themes($from: AWSDate, $to: AWSDate, $facet: ExecutiveThemeFacet) {{
  executiveThemes(from: $from, to: $to, facet: $facet) {{
    from to priorFrom priorTo dataThrough scopeLabel accessLevel facet facetLabel definitionVersion
    disclosure {{ {DISCLOSURE} }} groupsLeftOut sampleLimitations note
    groups {{ facetValue freeTextResponses {COUNT} priorFreeTextResponses {COUNT} regionCount
      cards {{ cardId facetValue topic responses {COUNT} priorResponses {COUNT} distinctHcps {COUNT} share regionCount trend
               citations {{ {CITATION} }} }} }}
  }}
}}
"""
MATRIX = f"""
query Matrix($from: AWSDate, $to: AWSDate, $facet: ExecutiveThemeFacet, $facetValue: String) {{
  executiveTopicMatrix(from: $from, to: $to, facet: $facet, facetValue: $facetValue) {{
    from to priorFrom priorTo dataThrough scopeLabel accessLevel facet facetValue definitionVersion
    disclosure {{ {DISCLOSURE} }} sampleLimitations note
    thresholds {{ minWindowResponses minTopicResponses minRelativeIncrease minSharePoints minCell rule approved definitionId version approvedAt }}
    regions {{ regionId regionName territoriesInScope freeTextResponses {COUNT} priorFreeTextResponses {COUNT} sampleSufficient }}
    rows {{ topic isOther regionsRising regionsFalling crossRegion
            cells {{ regionId responses {COUNT} priorResponses {COUNT} share priorShare sharePointChange trend alert }} }}
  }}
}}
"""
SUMMARY_FIELDS = f"""
  summaryId title from to dataThrough generatedAt scopeLabel scopeTerritoryIds accessLevel definitionVersion modelMode numberCheck
  droppedStatements stale staleReasons currentDataThrough regeneratesSummaryId
  keyFigures {{ label value {COUNT} citationIds }}
  statements {{ statementId section text citationIds }}
  sampleLimitations
  definitions {{ key label text }}
  citations {{ {CITATION} }}
  disclosure {{ {DISCLOSURE} }}
"""
GENERATE = f"mutation Gen($from: AWSDate, $to: AWSDate) {{ generateLeadershipSummary(from: $from, to: $to) {{ {SUMMARY_FIELDS} }} }}"
OPEN = f"query Open($id: ID!) {{ leadershipSummary(summaryId: $id) {{ {SUMMARY_FIELDS} }} }}"
LIST = "query List { myLeadershipSummaries { summaryId title from to generatedAt dataThrough accessible stale } }"
EXPORT = f"""
mutation Export($id: ID!) {{
  exportLeadershipSummary(summaryId: $id) {{
    summaryId title scopeLabel from to dataThrough generatedAt exportedAt accessLevel definitionVersion disclosureText
    keyFigures {{ label value {COUNT} citationIds }}
    statements {{ statementId section text citationIds }}
    sampleLimitations definitions {{ key label text }} citations {{ {CITATION} }}
  }}
}}
"""


@pytest.fixture(scope="module")
def executive() -> Persona:
    return Persona.sign_in("executive-region-01")


def themes(persona: Persona, facet: str = "PORTFOLIO", frm: str = FROM, to: str = TO) -> dict:
    res = persona.query(THEMES, {"from": frm, "to": to, "facet": facet})
    assert not res.errors, res.errors
    return res.data["executiveThemes"]


def matrix(persona: Persona, facet: str = "PORTFOLIO", value: str | None = None, frm: str = FROM, to: str = TO) -> dict:
    res = persona.query(MATRIX, {"from": frm, "to": to, "facet": facet, "facetValue": value})
    assert not res.errors, res.errors
    return res.data["executiveTopicMatrix"]


def all_counts(node) -> list[dict]:
    found = []
    if isinstance(node, dict):
        if set(node) == {"value", "suppressed"}:
            found.append(node)
        for v in node.values():
            found.extend(all_counts(v))
    elif isinstance(node, list):
        for v in node:
            found.extend(all_counts(v))
    return found


def assert_no_small_group(response: dict) -> None:
    counts = all_counts(response)
    assert counts, "the response carried counts to check"
    for c in counts:
        if c["suppressed"]:
            assert c["value"] is None, c
        else:
            assert c["value"] is None or not 1 <= c["value"] < 5, c


def theme_truth(db, territories: list[str], frm: str, to: str) -> dict[str, int]:
    """Free-text responses per theme, from the owner role, using the database's own theme function."""
    rows = db.execute(
        """SELECT app.theme_of(rspns_txt), count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights
           WHERE qstn_type = 'open_text' AND nullif(btrim(rspns_txt), '') IS NOT NULL AND excluded_rspns_flag IS NOT TRUE
             AND uniq_rspns_id IS NOT NULL AND territory_id = ANY(%s) AND date_of_interaction BETWEEN %s AND %s GROUP BY 1""",
        (territories, frm, to),
    ).fetchall()
    return dict(rows)


def region_territories(db, region: str) -> list[str]:
    return sorted(r[0] for r in db.execute("SELECT DISTINCT child_territory_id FROM territory_scope_relationships WHERE parent_territory_id = %s", (region,)))


@contextlib.contextmanager
def planted_responses(db, rows):
    """Arrange free-text responses (territory, date, text, molecule), then remove them."""
    ids = []
    try:
        for territory, day, text, molecule in rows:
            key = f"T13-{uuid.uuid4().hex[:12]}"
            db.execute(
                """INSERT INTO hcp_raw_insights (uniq_rspns_id, territory_id, date_of_interaction, qstn_type, qstn_txt, rspns_txt,
                       cust_mdm_id, qstn_ext_id, molecule_type, study_name, excluded_rspns_flag, sys_inserted_datetime)
                   VALUES (%s, %s, %s, 'open_text', 'Planted question', %s, %s, 'Q-PLANTED', %s, 'PLANTED-STUDY', false, '2026-11-03T12:00:00Z')""",
                (key, territory, day, text, f"PLANTED-HCP-{key}", molecule),
            )
            ids.append(key)
        yield
    finally:
        db.execute("DELETE FROM hcp_raw_insights WHERE uniq_rspns_id = ANY(%s)", (ids,))


ACCESS = "payer prior auth denial and reimbursement appeals"
BIOMARKER = "ngs turnaround and biomarker testing"
OTHERISH = "no particular view to share today"


@contextlib.contextmanager
def extra_regions(db, user_id: str, regions: list[str]):
    for region in regions:
        db.execute(
            "INSERT INTO user_scope_assignments(user_id, territory_id, assignment_type, effective_from) VALUES (%s, %s, 'executive', '2024-01-01T00:00:00Z')",
            (user_id, region),
        )
    try:
        yield
    finally:
        db.execute("DELETE FROM user_scope_assignments WHERE user_id = %s AND territory_id = ANY(%s)", (user_id, regions))


@contextlib.contextmanager
def record_level_permission(db, user_id: str):
    db.execute("INSERT INTO roles VALUES ('test-t13-records', 'Executive with record-level drill-down')")
    db.execute("INSERT INTO role_permissions VALUES ('test-t13-records', 'source.records.read')")
    db.execute(
        "INSERT INTO user_role_assignments(user_id, role_id, effective_from) VALUES (%s, 'test-t13-records', now() - interval '1 minute')",
        (user_id,),
    )
    try:
        yield
    finally:
        db.execute("DELETE FROM user_role_assignments WHERE role_id = 'test-t13-records'")
        db.execute("DELETE FROM role_permissions WHERE role_id = 'test-t13-records'")
        db.execute("DELETE FROM roles WHERE role_id = 'test-t13-records'")


# --- themes ----------------------------------------------------------------------------------------


def test_theme_cards_are_the_executives_explicit_region_and_match_the_source_rows(executive, db):
    data = themes(executive)
    assert data["accessLevel"] == "AGGREGATE_ONLY" and data["facet"] == "PORTFOLIO" and data["scopeLabel"] == "REGION-01 · 6 territories"
    assert (data["from"], data["to"], data["priorFrom"], data["priorTo"]) == (FROM, TO, "2026-05-01", "2026-07-31")
    truth = theme_truth(db, region_territories(db, "REGION-01"), FROM, TO)
    (group,) = data["groups"]
    assert group["facetValue"] == "Portfolio" and group["freeTextResponses"]["value"] == sum(truth.values())
    assert group["cards"], "the leading themes come back as cards"
    for card in group["cards"]:
        if not card["responses"]["suppressed"]:
            assert card["responses"]["value"] == truth[card["topic"]]
            assert card["share"] == round(100.0 * truth[card["topic"]] / sum(truth.values()), 1)
    assert group["cards"][0]["responses"]["value"] == max(v for k, v in truth.items() if k != "Other perspectives")
    assert_no_small_group(data)
    assert data["disclosure"]["applied"] is True and "Counts below 5" in data["disclosure"]["text"]


def test_cards_cite_the_responses_they_rest_on_without_opening_any_record(executive):
    for card in themes(executive)["groups"][0]["cards"]:
        assert card["trend"] in {"RISING", "FALLING", "STEADY", "WITHHELD", "INSUFFICIENT_SAMPLE"}
        (citation,) = card["citations"]
        assert citation["kind"] == "AGGREGATE" and citation["recordId"] is None and citation["excerpt"] is None
        assert citation["dataset"] == "hcp_raw_insights" and card["topic"] in citation["label"] and FROM in citation["label"]
        assert citation["responses"] == card["responses"]


def test_facets_group_by_molecule_disease_area_and_study(executive, db):
    for facet, column in (("MOLECULE", "molecule_type"), ("STUDY", "study_name")):
        data = themes(executive, facet)
        truth = dict(
            db.execute(
                f"""SELECT {column}, count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE qstn_type = 'open_text' AND excluded_rspns_flag IS NOT TRUE
                    AND uniq_rspns_id IS NOT NULL AND nullif(btrim(rspns_txt), '') IS NOT NULL AND territory_id = ANY(%s)
                    AND date_of_interaction BETWEEN %s AND %s GROUP BY 1""",
                (region_territories(db, "REGION-01"), FROM, TO),
            ).fetchall()
        )
        assert {g["facetValue"]: g["freeTextResponses"]["value"] for g in data["groups"]} == truth
        assert data["facet"] == facet and data["facetLabel"] in {"Molecule", "Study"}
        assert_no_small_group(data)
    areas = themes(executive, "DISEASE_AREA")
    assert {g["facetValue"] for g in areas["groups"]} == {"breast cancer", "gastric cancer", "non-small cell lung cancer", "urothelial cancer"}


def test_the_approved_rule_flags_the_planted_emerging_topic_as_rising(executive):
    (group,) = themes(executive)["groups"]
    ctdna = next(c for c in group["cards"] if c["topic"].startswith("ctDNA"))
    assert ctdna["trend"] == "RISING"
    assert ctdna["responses"]["value"] > ctdna["priorResponses"]["value"]


# --- the topic-by-region matrix --------------------------------------------------------------------


def test_matrix_across_the_regions_an_executive_is_explicitly_granted(executive, db):
    with extra_regions(db, "executive-region-01", ["REGION-02", "REGION-03"]):
        data = matrix(executive)
    assert [r["regionId"] for r in data["regions"]] == ["REGION-01", "REGION-02", "REGION-03"]
    assert data["scopeLabel"].startswith("REGION-01, REGION-02, REGION-03")
    t = data["thresholds"]
    assert (t["minWindowResponses"], t["minTopicResponses"], t["minSharePoints"], t["minCell"]) == (30, 10, 2.0, 5)
    assert t["approved"] is True and t["definitionId"] == "emerging-topic-rule" and t["version"] == 1 and t["approvedAt"]
    assert "rising" in t["rule"].lower()
    ctdna = next(r for r in data["rows"] if r["topic"].startswith("ctDNA"))
    assert ctdna["crossRegion"] is True and ctdna["regionsRising"] >= 2
    assert {c["trend"] for c in ctdna["cells"]} <= {"RISING", "FALLING", "STEADY", "WITHHELD", "INSUFFICIENT_SAMPLE"}
    assert all(c["alert"] == (c["trend"] == "RISING") for row in data["rows"] for c in row["cells"])
    # Counts match the source rows per region.
    for r in data["regions"]:
        truth = theme_truth(db, region_territories(db, r["regionId"]), FROM, TO)
        assert r["freeTextResponses"]["value"] == sum(truth.values())
        for row in data["rows"]:
            cell = next(c for c in row["cells"] if c["regionId"] == r["regionId"])
            if not cell["responses"]["suppressed"]:
                assert cell["responses"]["value"] == truth.get(row["topic"], 0)
    assert_no_small_group(data)


def test_matrix_withholds_a_small_cell_and_the_cell_that_would_reveal_it(executive, db):
    # The same shape in both windows, so the equal period before also holds enough responses to judge a trend.
    rows = []
    for day in ("2024-12-10", "2024-11-10"):
        rows += [("T01-01", day, ACCESS, "m1")] * 40 + [("T01-02", day, BIOMARKER, "m1")] * 3 + [("T01-03", day, OTHERISH, "m1")] * 20
    with planted_responses(db, rows):
        data = matrix(executive, frm=QUIET_FROM, to=QUIET_TO)
    cells = {r["topic"]: r["cells"][0] for r in data["rows"]}
    assert cells["Access and reimbursement"]["responses"] == {"value": 40, "suppressed": False}
    # 3 is a small group; showing the column total (63) beside 40 and 20 would reveal it, so 20 goes too.
    assert cells["Biomarker testing"]["responses"] == {"value": None, "suppressed": True}
    assert cells["Other perspectives"]["responses"] == {"value": None, "suppressed": True}
    assert cells["Biomarker testing"]["trend"] == "WITHHELD" and cells["Biomarker testing"]["share"] is None and cells["Biomarker testing"]["alert"] is False
    assert data["regions"][0]["freeTextResponses"] == {"value": 63, "suppressed": False}
    assert data["disclosure"]["suppressedCells"] >= 2
    assert_no_small_group(data)


def test_a_region_with_too_few_responses_gets_no_trend_and_says_so(executive, db):
    with planted_responses(db, [("T01-01", "2024-12-10", ACCESS, "m1")] * 12):
        data = matrix(executive, frm=QUIET_FROM, to=QUIET_TO)
    (region,) = data["regions"]
    assert region["sampleSufficient"] is False
    assert all(c["trend"] == "INSUFFICIENT_SAMPLE" for row in data["rows"] for c in row["cells"])
    assert any("fewer than 30" in text for text in data["sampleLimitations"])


def test_matrix_for_one_facet_value_and_bad_facets_are_refused(executive):
    data = matrix(executive, "MOLECULE", "osimertinib")
    assert data["facet"] == "MOLECULE" and data["facetValue"] == "osimertinib"
    assert_no_small_group(data)
    for facet, value in (("MOLECULE", "not-a-molecule"), ("PORTFOLIO", "osimertinib")):
        res = executive.query(MATRIX, {"from": FROM, "to": TO, "facet": facet, "facetValue": value})
        assert "BadRequest" in res.error_types, res.errors
    res = executive.query(MATRIX, {"from": TO, "to": FROM})
    assert "BadRequest" in res.error_types


def test_with_record_level_permission_nothing_is_withheld_and_citations_open_responses(db):
    executive = Persona.sign_in("executive-region-01")
    with record_level_permission(db, "executive-region-01"):
        data = themes(executive, "STUDY")
        m = matrix(executive, "STUDY", "FLAURA2")
    assert data["accessLevel"] == "RECORD_DRILLDOWN" and data["disclosure"]["applied"] is False and data["disclosure"]["suppressedCells"] == 0
    assert m["disclosure"]["applied"] is False
    kinds = {c["kind"] for g in data["groups"] for card in g["cards"] for c in card["citations"]}
    assert kinds == {"AGGREGATE", "RECORD"}
    records = [c for g in data["groups"] for card in g["cards"] for c in card["citations"] if c["kind"] == "RECORD"]
    assert all(c["recordId"] and c["excerpt"] for c in records)
    ids = [c["recordId"] for c in records]
    owners = {r[0] for r in db.execute("SELECT DISTINCT territory_id FROM hcp_raw_insights WHERE uniq_rspns_id = ANY(%s)", (ids,))}
    assert owners <= set(region_territories(db, "REGION-01"))


# --- who may ask -----------------------------------------------------------------------------------


@pytest.mark.parametrize("user_id", ["msl-t01-01", "director-region-01", "admin-region-01"])
def test_other_personas_get_nothing(user_id):
    persona = Persona.sign_in(user_id)
    for query, variables in ((THEMES, {"from": FROM, "to": TO}), (MATRIX, {"from": FROM, "to": TO}), (GENERATE, {"from": FROM, "to": TO}), (LIST, {})):
        res = persona.query(query, variables)
        assert res.errors and "Forbidden" in res.error_types, (user_id, res.errors)


def test_an_executive_whose_assignment_expired_has_no_scope(db):
    other = Persona.sign_in("executive-region-02")
    db.execute("UPDATE user_scope_assignments SET effective_to = now() - interval '1 day' WHERE user_id = 'executive-region-02'")
    try:
        res = other.query(THEMES, {"from": FROM, "to": TO})
        assert "NoScope" in res.error_types, res.errors
    finally:
        db.execute("UPDATE user_scope_assignments SET effective_to = NULL WHERE user_id = 'executive-region-02'")


# --- leadership summaries --------------------------------------------------------------------------


@pytest.fixture(scope="module")
def summary(executive):
    res = executive.query(GENERATE, {"from": FROM, "to": TO})
    assert not res.errors, res.errors
    return res.data["generateLeadershipSummary"]


def test_a_summary_is_source_linked_dated_defined_and_saved(executive, summary, db):
    s = summary
    assert (s["from"], s["to"]) == (FROM, TO) and s["accessLevel"] == "AGGREGATE_ONLY" and s["stale"] is False
    assert s["scopeLabel"] == "REGION-01 · 6 territories" and len(s["scopeTerritoryIds"]) == 6
    assert s["modelMode"] in {"claude", "stub"} and s["numberCheck"] in {"verified", "filtered", "unchecked"}
    assert s["statements"], "the summary says something"
    cited = {c["citationId"] for c in s["citations"]}
    for statement in s["statements"]:
        assert statement["citationIds"] and set(statement["citationIds"]) <= cited, statement
    assert {d["key"] for d in s["definitions"]} >= {"calls", "responses", "engagedHcps", "theme", "trend"}
    assert s["sampleLimitations"] and s["disclosure"]["applied"] is True
    labels = [k["label"] for k in s["keyFigures"]]
    assert labels[:3] == ["Distinct calls", "Responses", "Engaged HCPs"]
    calls = next(k for k in s["keyFigures"] if k["label"] == "Distinct calls")
    (truth,) = db.execute(
        "SELECT count(DISTINCT crm_call_id) FROM call_activity WHERE territory_id = ANY(%s) AND call_dt BETWEEN %s AND %s",
        (region_territories(db, "REGION-01"), FROM, TO),
    ).fetchone()
    assert calls["value"] == {"value": truth, "suppressed": False}
    assert all(c["kind"] == "AGGREGATE" for c in s["citations"])
    assert_no_small_group({"keyFigures": s["keyFigures"], "citations": s["citations"]})
    text = " ".join(st["text"] for st in s["statements"])
    assert not re.search(r"(?<![\w.%-])[1-4]\s+(?:of\b|responses?\b|free-text\b)", text), text


def test_a_saved_summary_is_listed_reopened_and_stored_for_its_owner_only(executive, summary):
    listed = executive.query(LIST)
    assert not listed.errors, listed.errors
    assert summary["summaryId"] in {i["summaryId"] for i in listed.data["myLeadershipSummaries"]}
    reopened = executive.query(OPEN, {"id": summary["summaryId"]})
    assert not reopened.errors and reopened.data["leadershipSummary"]["summaryId"] == summary["summaryId"]
    user = seeded_user("executive-region-01")["user_id"]
    item = fe_dynamodb().get_item(
        TableName="a2g-precall-briefs", Key={"pk": {"S": f"USER#{user}"}, "sk": {"S": f"SUMMARY#{summary['summaryId']}"}}
    ).get("Item")
    assert item is not None and item["ownerUserId"]["S"] == user and item["accessLevel"]["S"] == "AGGREGATE_ONLY"
    other = Persona.sign_in("executive-region-02").query(OPEN, {"id": summary["summaryId"]})
    assert "NotFound" in other.error_types, other.errors


def test_export_rechecks_access_and_leaves_an_audit_row(executive, summary, db):
    res = executive.query(EXPORT, {"id": summary["summaryId"]})
    assert not res.errors, res.errors
    doc = res.data["exportLeadershipSummary"]
    assert (doc["from"], doc["to"]) == (FROM, TO) and doc["exportedAt"] and doc["generatedAt"] and doc["dataThrough"]
    assert doc["definitions"] and doc["citations"] and doc["statements"] and doc["sampleLimitations"]
    assert "Counts below 5" in doc["disclosureText"]
    (n,) = db.execute(
        "SELECT count(*) FROM audit_events WHERE action = 'leadership_summary.exported' AND resource_id = %s AND actor_user_id = 'executive-region-01'",
        (summary["summaryId"],),
    ).fetchone()
    assert n >= 1


def test_export_is_refused_after_a_territory_leaves_the_scope(db):
    executive = Persona.sign_in("executive-region-01")
    with extra_regions(db, "executive-region-01", ["REGION-02"]):
        created = executive.query(GENERATE, {"from": FROM, "to": TO})
        assert not created.errors, created.errors
        sid = created.data["generateLeadershipSummary"]["summaryId"]
        assert "REGION-02" in created.data["generateLeadershipSummary"]["scopeLabel"]
        assert not executive.query(OPEN, {"id": sid}).errors
    # REGION-02 left the explicit scope: opening and exporting are refused, and no audit row is written.
    for query in (OPEN, EXPORT):
        res = executive.query(query, {"id": sid})
        assert "Forbidden" in res.error_types, res.errors
    listed = executive.query(LIST).data["myLeadershipSummaries"]
    gone = next(i for i in listed if i["summaryId"] == sid)
    assert gone["accessible"] is False and gone["title"] is None and gone["from"] is None
    (n,) = db.execute("SELECT count(*) FROM audit_events WHERE action = 'leadership_summary.exported' AND resource_id = %s", (sid,)).fetchone()
    assert n == 0


def test_a_summary_with_record_level_material_is_refused_after_the_permission_is_withdrawn(db):
    executive = Persona.sign_in("executive-region-01")
    with record_level_permission(db, "executive-region-01"):
        created = executive.query(GENERATE, {"from": FROM, "to": TO})
        assert not created.errors, created.errors
        made = created.data["generateLeadershipSummary"]
        assert made["accessLevel"] == "RECORD_DRILLDOWN" and made["disclosure"]["applied"] is False
    res = executive.query(EXPORT, {"id": made["summaryId"]})
    assert "Forbidden" in res.error_types, res.errors


# --- natural-language organisational analysis ------------------------------------------------------


def test_nl_analysis_states_sample_limitations_and_cites_evidence(executive):
    run = executive.chat("Which themes are rising across my regions, and how sure can we be?")
    assert run.types[0] == "RUN_STARTED" and run.types[-1] == "RUN_FINISHED"
    limitations = [item for value in run.custom("sample_limitations") for item in value["items"]]
    assert limitations, "sample limitations are always sent"
    assert any("free-text responses" in item for item in limitations)
    assert "Sample limitations:" in run.text, "and they are part of the answer text itself"
    citations = run.citations
    assert citations and all(c.get("kind") == "aggregate" and c["record_id"].startswith("agg:") for c in citations)
    assert all(c["dataset"] == "hcp_raw_insights" for c in citations)
    assert not any(f["value"] in range(1, 5) for f in run.facts), "a withheld small group is never a fact"
    [check] = run.custom("number_check")
    assert check["status"] in {"verified", "unverified"}


def test_an_aggregate_citation_opens_no_record(executive):
    run = executive.chat("What are HCPs recording about access and reimbursement?")
    cite = next(c for c in run.citations if c["record_id"].startswith("agg:"))
    from harness import CHAT_CITATION

    res = executive.query(CHAT_CITATION, {"dataset": cite["dataset"], "recordId": cite["record_id"]})
    assert res.errors and ("Forbidden" in res.error_types or "BadRequest" in res.error_types), res.errors


# --- logging ---------------------------------------------------------------------------------------


def test_logs_for_these_fields_carry_ids_and_counts_never_themes_or_text(executive, summary):
    themes(executive)
    matrix(executive)
    logs = be_lambda_logs("20m")
    assert "executive themes served" in logs and "executive topic matrix served" in logs and "leadership summary generated" in logs
    for needle in ("Access and reimbursement", "ctDNA", "Biomarker testing", "executive.region-01@example.test"):
        assert needle not in logs, needle
    token = executive.id_token
    assert token not in logs and json.dumps(state().get("local_password", "x")) not in logs
