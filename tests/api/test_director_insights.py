"""Director insights, proven through the AppSync API as seeded personas (ticket 11, #12).

Expected values are computed with the owner role (no RLS) straight from the source rows, so a scoping or counting
bug in the Lambda cannot also hide in the expectation. The emerging-topic rule is restated here in plain Python and
compared with what the API returns for the same counts.
"""

from __future__ import annotations

import contextlib
import json
import uuid

import pytest

from ground_truth import region_territories
from harness import CHAT_EVENTS, Persona, be_lambda_logs

FROM, TO = "2026-08-06", "2026-11-03"
REGION1 = ["T01-01", "T01-02", "T01-03", "T01-04", "T01-05", "T01-06"]

HEATMAP = """
query Heatmap($from: AWSDate, $to: AWSDate, $filters: InsightFiltersInput, $facet: ThemeFacet) {
  topicHeatmap(from: $from, to: $to, filters: $filters, facet: $facet) {
    from to dataThrough scopeLabel definitionVersion facet facetLabel freeTextResponses note
    territories { territoryId name regionId regionName freeTextResponses }
    topics { topic responses distinctHcps isOther }
    cells { territoryId topic responses distinctHcps share territoryResponses }
    themeCards { cardId facetValue topic responses distinctHcps territoryCount share facetResponses
                 evidence { recordId excerpt questionText interactionDate territoryId } }
  }
}
"""
EMERGING = """
query Emerging($from: AWSDate, $to: AWSDate, $filters: InsightFiltersInput) {
  emergingTopics(from: $from, to: $to, filters: $filters) {
    scopeLabel definitionVersion dataThrough sampleSufficient statement
    current { from to freeTextResponses } prior { from to freeTextResponses }
    thresholds { minWindowResponses minTopicResponses minRelativeIncrease minSharePoints rule }
    topics { territoryId topic currentResponses priorResponses currentTotal priorTotal currentShare priorShare
             sharePointChange status weeks { weekStart responses } evidence { recordId excerpt territoryId } }
  }
}
"""
QUESTION = """
query Question($from: AWSDate, $to: AWSDate, $filters: InsightFiltersInput, $questionId: ID) {
  questionAnalytics(from: $from, to: $to, filters: $filters, questionId: $questionId) {
    scopeLabel from to dataThrough
    options { questionId questionText questionType parentQuestionId responses distinctHcps }
    selected { questionId questionText questionType parentQuestionId responses distinctHcps denominator barNote
               bars { label responses distinctHcps percentage }
               territories { territoryId responses distinctHcps }
               numericSummary { min median max answered }
               parent { questionId questionText questionType inCatalog note answerBreakdown { answer responses } }
               followUps { questionId questionText responses } catalog { status tumorType survey study } }
  }
}
"""
DRILL = """
query Drill($level: DrilldownLevel, $id: ID, $from: AWSDate, $to: AWSDate) {
  directorDrilldown(level: $level, id: $id, from: $from, to: $to) {
    level id scopeLabel from to dataThrough totalChildren truncated note
    breadcrumb { level id label }
    children { id label level childLabel childCount distinctCalls distinctEngagedHcps responses lastInteractionDate }
  }
}
"""
EXCEPTIONS = """
query Exceptions($from: AWSDate, $to: AWSDate) {
  directorExceptions(from: $from, to: $to) {
    scopeLabel from to dataThrough note
    categories { category label rule count }
    exceptions { exceptionId category categoryLabel severity title detail territoryId affectedCount sourceTable sampleRecordIds rule }
  }
}
"""
SUMMARY_EVIDENCE = """
query Summaries($from: AWSDate, $to: AWSDate) {
  territorySummaryEvidence(from: $from, to: $to) {
    scopeLabel definitionVersion from to priorFrom priorTo dataThrough note
    territories { territoryId name regionId distinctCalls distinctEngagedHcps responses freeTextResponses priorFreeTextResponses
                  flagged { topic status currentResponses priorResponses }
                  topThemes { topic currentResponses priorResponses currentTotal priorTotal status evidence { recordId excerpt territoryId } } }
  }
}
"""
START_CHAT_WITH_CONTEXT = """
mutation StartChat($threadId: ID!, $runId: ID!, $message: String!, $context: ChatContextInput) {
  startChatRun(threadId: $threadId, runId: $runId, message: $message, context: $context) { runId status }
}
"""
CITATION = """
query Cite($dataset: String!, $recordId: ID!) { chatCitation(dataset: $dataset, recordId: $recordId) { recordId title fields { label value } } }
"""
HCP_TIMELINE = "query T($hcpId: ID!) { hcpTimeline(hcpId: $hcpId) { hcpId interactions { callId } responses { responseId } } }"


@pytest.fixture(scope="module")
def director() -> Persona:
    return Persona.sign_in("director-region-01")


def data(res, field):
    assert not res.errors, res.errors
    return res.data[field]


def heatmap(persona, **vars_):
    return data(persona.query(HEATMAP, {"from": FROM, "to": TO, **vars_}), "topicHeatmap")


def emerging(persona, frm=FROM, to=TO, **vars_):
    return data(persona.query(EMERGING, {"from": frm, "to": to, **vars_}), "emergingTopics")


def drill(persona, level="ROOT", id_=None, frm=FROM, to=TO):
    return persona.query(DRILL, {"level": level, "id": id_, "from": frm, "to": to})


# --- ground truth ----------------------------------------------------------------------------------

FREE = "qstn_type = 'open_text' AND nullif(btrim(rspns_txt), '') IS NOT NULL AND excluded_rspns_flag IS NOT TRUE"


def theme_counts(db, tids, frm, to, extra="", params=()):
    rows = db.execute(
        f"""SELECT territory_id, app.theme_of(rspns_txt), count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights
            WHERE {FREE} AND territory_id = ANY(%s) AND date_of_interaction BETWEEN %s AND %s {extra} GROUP BY 1, 2""",
        (tids, frm, to, *params),
    ).fetchall()
    return {(t, topic): n for t, topic, n in rows}


def reference_status(cur_n, prior_n, cur_total, prior_total):
    """The documented rule, restated independently of the database function."""
    if cur_total < 30 or prior_total < 30:
        return "INSUFFICIENT_SAMPLE"
    cur_share, prior_share = cur_n / cur_total, prior_n / prior_total
    if cur_n >= 10 and (cur_share - prior_share) * 100 >= 2.0 and (prior_n == 0 or cur_share >= prior_share * 1.5):
        return "EMERGING"
    if prior_n >= 10 and (prior_share - cur_share) * 100 >= 2.0 and cur_share <= prior_share * 0.5:
        return "DECLINING"
    return "STABLE"


def prior_window(frm, to):
    import datetime as dt

    a, b = dt.date.fromisoformat(frm), dt.date.fromisoformat(to)
    days = (b - a).days + 1
    return (a - dt.timedelta(days=days)).isoformat(), (a - dt.timedelta(days=1)).isoformat()


@contextlib.contextmanager
def extra_responses(db, territory, day, text, n):
    """Arrange n extra free-text responses (one HCP each), then remove them."""
    ids = []
    try:
        for i in range(n):
            (row_id,) = db.execute(
                """INSERT INTO hcp_raw_insights (insight_intrctn_dtl_sfdc_id, date_of_interaction, territory_id, territory_name, cust_mdm_id,
                       cust_nm, qstn_txt, rspns_txt, qstn_ext_id, qstn_type, molecule_type, study_name, survey_type, uniq_rspns_id,
                       sys_inserted_datetime, excluded_rspns_flag)
                   VALUES (%s, %s, %s, %s, %s, %s, 'Test question?', %s, 'Q-TEST', 'open_text', 'osimertinib', 'FLAURA2', 'MSL pulse', %s,
                           '2026-11-03T12:00:00Z', false) RETURNING source_row_id""",
                (f"INT-TEST-{uuid.uuid4()}", day, territory, f"{territory} Oncology", f"HCP-TEST-{i}", f"Synthetic HCP TEST-{i}", text, f"RESP-TEST-{uuid.uuid4()}"),
            ).fetchone()
            ids.append(row_id)
        yield
    finally:
        db.execute("DELETE FROM hcp_raw_insights WHERE source_row_id = ANY(%s)", (ids,))


# --- topic-by-territory heatmap and theme cards -------------------------------------------------------


def test_heatmap_counts_match_the_source_rows_for_exactly_the_directors_territories(director, db):
    h = heatmap(director)
    assert sorted(t["territoryId"] for t in h["territories"]) == REGION1
    truth = theme_counts(db, REGION1, FROM, TO)
    cells = {(c["territoryId"], c["topic"]): c for c in h["cells"]}
    assert {k: c["responses"] for k, c in cells.items()} == truth
    for (tid, topic), cell in cells.items():
        total = sum(n for (t, _), n in truth.items() if t == tid)
        assert cell["territoryResponses"] == total
        assert cell["share"] == round(100.0 * cell["responses"] / total, 1)
    assert h["freeTextResponses"] == sum(truth.values())
    assert h["dataThrough"] and h["definitionVersion"].startswith("director-insights")
    assert "derived" in h["note"].lower()
    assert not {t for t, _ in cells} - set(REGION1), "no cell outside the approved territories"


def test_heatmap_distinct_hcps_count_each_hcp_once_per_cell(director, db):
    h = heatmap(director)
    cell = max(h["cells"], key=lambda c: c["responses"])
    (n,) = db.execute(
        f"""SELECT count(DISTINCT cust_mdm_id) FROM hcp_raw_insights WHERE {FREE} AND territory_id = %s
            AND app.theme_of(rspns_txt) = %s AND date_of_interaction BETWEEN %s AND %s""",
        (cell["territoryId"], cell["topic"], FROM, TO),
    ).fetchone()
    assert cell["distinctHcps"] == n and n <= cell["responses"]


def test_planted_regional_and_territory_themes_show_in_the_heatmap():
    """docs/synthetic-insight-data.md: access is the T02-03 spike; the heatmap must surface it."""
    h = heatmap(Persona.sign_in("director-region-02"))
    share = {(c["territoryId"], c["topic"]): c["share"] for c in h["cells"]}
    spike = share[("T02-03", "Access and reimbursement")]
    others = [share.get((t["territoryId"], "Access and reimbursement"), 0) for t in h["territories"] if t["territoryId"] != "T02-03"]
    assert spike > sum(others) / len(others)


def test_theme_cards_cite_real_in_scope_responses_and_are_marked_derived(director, db):
    h = heatmap(director)
    assert h["themeCards"], "a Director with activity gets theme cards"
    for card in h["themeCards"]:
        assert card["evidence"], card["topic"]
        for ev in card["evidence"]:
            assert ev["territoryId"] in REGION1
            row = db.execute(
                "SELECT territory_id, rspns_txt FROM hcp_raw_insights WHERE uniq_rspns_id = %s LIMIT 1", (ev["recordId"],)
            ).fetchone()
            assert row and row[0] in REGION1 and ev["excerpt"].rstrip("…") in " ".join(row[1].split())
    cited = director.query(CITATION, {"dataset": "hcp_raw_insights", "recordId": h["themeCards"][0]["evidence"][0]["recordId"]})
    assert not cited.errors, "an evidence chip opens as a citation"


@pytest.mark.parametrize("facet,column", [("MOLECULE", "molecule_type"), ("STUDY", "study_name"), ("SURVEY", "survey_type")])
def test_theme_cards_can_be_grouped_by_molecule_study_or_survey(director, db, facet, column):
    h = heatmap(director, facet=facet)
    assert h["facet"] == facet and h["facetLabel"]
    values = {c["facetValue"] for c in h["themeCards"]}
    assert values and None not in values
    for card in h["themeCards"][:6]:
        (n,) = db.execute(
            f"""SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE {FREE} AND territory_id = ANY(%s)
                AND {column} = %s AND app.theme_of(rspns_txt) = %s AND date_of_interaction BETWEEN %s AND %s""",
            (REGION1, card["facetValue"], card["topic"], FROM, TO),
        ).fetchone()
        assert card["responses"] == n


def test_theme_cards_can_be_grouped_by_tumor_type(director):
    h = heatmap(director, facet="TUMOR_TYPE")
    assert {c["facetValue"] for c in h["themeCards"]} <= {"non-small cell lung cancer", "breast cancer", "urothelial cancer", "gastric cancer", "Unspecified"}


def test_heatmap_respects_the_shared_filters(director, db):
    h = heatmap(director, filters={"molecule": "osimertinib"})
    truth = theme_counts(db, REGION1, FROM, TO, "AND molecule_type = %s", ("osimertinib",))
    assert {(c["territoryId"], c["topic"]): c["responses"] for c in h["cells"]} == truth


def test_heatmap_is_scoped_by_the_database_not_by_the_filter(director):
    """Asking for another region's territory returns nothing: row-level security removes the rows."""
    h = heatmap(director, filters={"territoryId": "T02-01"})
    assert h["cells"] == [] and h["themeCards"] == [] and h["freeTextResponses"] == 0


def test_only_the_director_and_administrator_may_open_the_insight_views(db):
    for user in ("msl-t01-01", "executive-region-01"):
        persona = Persona.sign_in(user)
        for query, vars_ in (
            (HEATMAP, {}), (EMERGING, {}), (QUESTION, {}), (DRILL, {}), (EXCEPTIONS, {}), (SUMMARY_EVIDENCE, {}),
        ):
            res = persona.query(query, {"from": FROM, "to": TO, **vars_})
            assert "Forbidden" in res.error_types, (user, query.split("(")[0])
    admin = heatmap(Persona.sign_in("admin-region-01"))
    assert admin["territories"] and {c["territoryId"] for c in admin["cells"]} <= {t["territoryId"] for t in admin["territories"]}


def test_a_director_in_another_region_sees_a_disjoint_heatmap(db):
    mine = {c["territoryId"] for c in heatmap(Persona.sign_in("director-region-01"))["cells"]}
    theirs = {c["territoryId"] for c in heatmap(Persona.sign_in("director-region-02"))["cells"]}
    assert mine and theirs and not mine & theirs


# --- emerging topics: thresholds evaluated by deterministic code -------------------------------------------


def test_emerging_topics_return_the_explicit_rule_and_both_windows(director):
    e = emerging(director)
    t = e["thresholds"]
    assert (t["minWindowResponses"], t["minTopicResponses"], t["minRelativeIncrease"], t["minSharePoints"]) == (30, 10, 0.5, 2.0)
    assert "EMERGING" in t["rule"] and "percentage points" in t["rule"]
    assert (e["current"]["from"], e["current"]["to"]) == (FROM, TO)
    assert (e["prior"]["from"], e["prior"]["to"]) == prior_window(FROM, TO)
    assert e["current"]["freeTextResponses"] >= 30 and e["sampleSufficient"] is True


def test_every_status_equals_the_documented_rule_applied_to_the_source_counts(director, db):
    e = emerging(director)
    pfrom, pto = prior_window(FROM, TO)
    cur = theme_counts(db, REGION1, FROM, TO)
    pri = theme_counts(db, REGION1, pfrom, pto)
    topics_cur, topics_pri = {}, {}
    for (_, topic), n in cur.items():
        topics_cur[topic] = topics_cur.get(topic, 0) + n
    for (_, topic), n in pri.items():
        topics_pri[topic] = topics_pri.get(topic, 0) + n
    cur_total, pri_total = sum(topics_cur.values()), sum(topics_pri.values())
    assert (e["current"]["freeTextResponses"], e["prior"]["freeTextResponses"]) == (cur_total, pri_total)
    assert {t["topic"] for t in e["topics"]} == set(topics_cur) | set(topics_pri)
    for t in e["topics"]:
        c, p = topics_cur.get(t["topic"], 0), topics_pri.get(t["topic"], 0)
        assert (t["currentResponses"], t["priorResponses"]) == (c, p), t["topic"]
        assert t["status"] == reference_status(c, p, cur_total, pri_total), t["topic"]
        if t["currentShare"] is not None and t["priorShare"] is not None:
            assert t["sharePointChange"] == round(t["currentShare"] - t["priorShare"], 1)


def test_the_planted_emerging_topics_are_flagged_and_cite_evidence(director):
    e = emerging(director)
    status = {t["topic"]: t for t in e["topics"]}
    assert status["ctDNA monitoring (emerging)"]["status"] == "EMERGING"
    assert status["Pulmonary surveillance (emerging)"]["status"] == "EMERGING"
    for topic in ("ctDNA monitoring (emerging)", "Pulmonary surveillance (emerging)"):
        assert status[topic]["evidence"] and all(ev["territoryId"] in REGION1 for ev in status[topic]["evidence"])
        weeks = status[topic]["weeks"]
        assert weeks and sum(w["responses"] for w in weeks) == status[topic]["currentResponses"] + status[topic]["priorResponses"]
    assert status["Access and reimbursement"]["status"] == "STABLE"
    assert e["topics"][0]["status"] == "EMERGING", "flagged topics come first"


def test_a_tiny_window_is_never_judged(director):
    e = emerging(director, "2026-11-02", "2026-11-03")
    assert e["sampleSufficient"] is False
    assert {t["status"] for t in e["topics"]} <= {"INSUFFICIENT_SAMPLE"}


def test_arranged_responses_flip_a_status_and_removing_them_restores_it(director, db):
    frm, to = "2026-10-05", "2026-11-03"
    flt = {"territoryId": "T01-01"}

    def status(topic):
        return next((t["status"] for t in emerging(director, frm, to, filters=flt)["topics"] if t["topic"] == topic), None)

    before = status("Unmet need")
    assert before != "EMERGING"
    with extra_responses(db, "T01-01", "2026-10-20", "Real unmet need and limited options remain, quality of life matters", 30):
        e = emerging(director, frm, to, filters=flt)
        unmet = next(t for t in e["topics"] if t["topic"] == "Unmet need")
        assert unmet["currentResponses"] >= 30 and unmet["status"] == "EMERGING"
        assert unmet["status"] == reference_status(unmet["currentResponses"], unmet["priorResponses"], unmet["currentTotal"], unmet["priorTotal"])
    assert status("Unmet need") == before


def test_the_response_never_makes_a_causal_claim(director):
    e = emerging(director)
    text = json.dumps({"statement": e["statement"], "rule": e["thresholds"]["rule"]}).lower()
    assert "do not say why" in text
    assert not any(word in text for word in (" because ", " caused ", " due to ", " driven by ", " leads to "))


# --- question analytics ---------------------------------------------------------------------------------


def question(persona, question_id=None, **vars_):
    return data(persona.query(QUESTION, {"from": FROM, "to": TO, "questionId": question_id, **vars_}), "questionAnalytics")


def test_question_selector_lists_in_scope_questions_with_counts(director, db):
    q = question(director)
    assert q["options"] and q["selected"]["questionId"] == q["options"][0]["questionId"]
    for opt in q["options"][:8]:
        responses, hcps = db.execute(
            """SELECT count(DISTINCT uniq_rspns_id), count(DISTINCT cust_mdm_id) FROM hcp_raw_insights WHERE qstn_ext_id = %s
               AND territory_id = ANY(%s) AND date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE""",
            (opt["questionId"], REGION1, FROM, TO),
        ).fetchone()
        assert (opt["responses"], opt["distinctHcps"]) == (responses, hcps), opt["questionId"]


def first_of_type(q, qtype):
    return next(o for o in q["options"] if o["questionType"] == qtype and not o["parentQuestionId"])


def test_choice_question_bars_count_distinct_responses_and_state_one_denominator(director, db):
    q = question(director)
    opt = first_of_type(q, "yes_no")
    s = question(director, opt["questionId"])["selected"]
    truth = dict(
        db.execute(
            """SELECT btrim(rspns_txt), count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE qstn_ext_id = %s AND territory_id = ANY(%s)
               AND date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE GROUP BY 1""",
            (opt["questionId"], REGION1, FROM, TO),
        ).fetchall()
    )
    assert {b["label"]: b["responses"] for b in s["bars"]} == truth
    assert s["denominator"] == s["responses"] == sum(truth.values())
    for b in s["bars"]:
        assert b["percentage"] == round(100.0 * b["responses"] / s["denominator"], 1)
        assert b["distinctHcps"] <= b["responses"]
    assert sum(t["responses"] for t in s["territories"]) == s["responses"]
    assert {t["territoryId"] for t in s["territories"]} <= set(REGION1)


def test_every_answer_type_gets_bars_without_mixing_questions(director):
    q = question(director)
    for qtype in ("single_choice", "multi_select", "likert_5", "rating_0_10", "numeric", "date", "ranking", "open_text", "yes_no"):
        opt = first_of_type(q, qtype)
        s = question(director, opt["questionId"])["selected"]
        assert s["questionId"] == opt["questionId"] and s["questionType"] == qtype and s["bars"], qtype
        assert s["barNote"] != "" or qtype in ("single_choice", "yes_no", "likert_5", "rating_0_10"), qtype
        if qtype in ("single_choice", "yes_no", "likert_5", "rating_0_10"):
            assert sum(b["responses"] for b in s["bars"]) == s["denominator"], qtype
    scale = question(director, first_of_type(q, "rating_0_10")["questionId"])["selected"]
    assert scale["numericSummary"] and scale["numericSummary"]["min"] <= scale["numericSummary"]["median"] <= scale["numericSummary"]["max"]


def test_a_follow_up_shows_its_parent_context_from_the_same_interactions_only(director, db):
    q = question(director)
    follow = next(o for o in q["options"] if o["parentQuestionId"] and o["parentQuestionId"] != "Q-NOT-IN-CATALOG" and o["questionType"] in ("single_choice", "yes_no", "likert_5"))
    parent_option = next((o for o in q["options"] if o["questionId"] == follow["parentQuestionId"]), None)
    s = question(director, follow["questionId"])["selected"]
    assert s["parent"] and s["parent"]["questionId"] == follow["parentQuestionId"] and s["parent"]["inCatalog"] is True
    truth = db.execute(
        """SELECT count(DISTINCT p.uniq_rspns_id) FROM hcp_raw_insights c JOIN hcp_raw_insights p
             ON p.insight_intrctn_dtl_sfdc_id = c.insight_intrctn_dtl_sfdc_id AND p.qstn_ext_id = c.qstn_pid
           WHERE c.qstn_ext_id = %s AND c.territory_id = ANY(%s) AND c.date_of_interaction BETWEEN %s AND %s
             AND c.excluded_rspns_flag IS NOT TRUE AND p.excluded_rspns_flag IS NOT TRUE AND nullif(btrim(p.rspns_txt), '') IS NOT NULL""",
        (follow["questionId"], REGION1, FROM, TO),
    ).fetchone()[0]
    if s["parent"]["questionType"] != "multi_select":
        assert sum(a["responses"] for a in s["parent"]["answerBreakdown"]) == truth
    if parent_option:
        parent_detail = question(director, parent_option["questionId"])["selected"]
        assert any(f["questionId"] == follow["questionId"] for f in parent_detail["followUps"])


def test_an_orphan_parent_is_reported_not_papered_over(director):
    q = question(director)
    orphan = next(o for o in q["options"] if o["parentQuestionId"] == "Q-NOT-IN-CATALOG")
    s = question(director, orphan["questionId"])["selected"]
    assert s["parent"]["inCatalog"] is False and s["parent"]["answerBreakdown"] == []
    assert "not in the catalog" in s["parent"]["note"]


def test_a_question_outside_the_scope_looks_exactly_like_one_with_no_responses(director):
    other_region = question(director, filters={"territoryId": "T02-01"})
    assert other_region["options"] == [] and other_region["selected"] is None
    nonexistent = question(director, "Q-9999")
    assert nonexistent["selected"] is None


def test_bad_question_ids_are_refused(director):
    res = director.query(QUESTION, {"from": FROM, "to": TO, "questionId": "Q-0001'; DROP TABLE x"})
    assert "BadRequest" in res.error_types


# --- drill-down stops at records the Director is permitted to see ----------------------------------------------


def test_drilldown_walks_region_territory_hcp_with_the_source_numbers(director, db):
    root = data(drill(director), "directorDrilldown")
    assert [c["id"] for c in root["children"]] == ["REGION-01"] and root["children"][0]["level"] == "REGION"
    region = data(drill(director, "REGION", "REGION-01"), "directorDrilldown")
    assert [c["id"] for c in region["children"]] == REGION1
    assert [b["level"] for b in region["breadcrumb"]] == ["ROOT", "REGION"]
    for child in region["children"]:
        calls, hcps = db.execute(
            "SELECT count(DISTINCT crm_call_id), count(DISTINCT cust_mdm_id) FROM call_activity WHERE territory_id = %s AND call_dt BETWEEN %s AND %s",
            (child["id"], FROM, TO),
        ).fetchone()
        (responses,) = db.execute(
            "SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE territory_id = %s AND date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE",
            (child["id"], FROM, TO),
        ).fetchone()
        assert (child["distinctCalls"], child["distinctEngagedHcps"], child["responses"]) == (calls, hcps, responses), child["id"]
    assert root["children"][0]["distinctCalls"] == sum(c["distinctCalls"] for c in region["children"])
    territory = data(drill(director, "TERRITORY", "T01-02"), "directorDrilldown")
    assert [b["level"] for b in territory["breadcrumb"]] == ["ROOT", "REGION", "TERRITORY"]
    assert territory["children"] and all(c["level"] == "HCP" for c in territory["children"])
    (hcp_total,) = db.execute(
        """SELECT count(DISTINCT x.hcp_id) FROM hcp_identifier_crosswalk x WHERE
             (x.source_system = 'call_activity.cust_mdm_id' AND x.source_identifier IN (SELECT cust_mdm_id FROM call_activity WHERE territory_id = 'T01-02' AND call_dt BETWEEN %s AND %s))
          OR (x.source_system = 'hcp_raw_insights.cust_mdm_id' AND x.source_identifier IN (SELECT cust_mdm_id FROM hcp_raw_insights WHERE territory_id = 'T01-02' AND date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE))""",
        (FROM, TO, FROM, TO),
    ).fetchone()
    assert territory["totalChildren"] == hcp_total and territory["truncated"] == (hcp_total > len(territory["children"]))


def test_the_last_step_opens_a_permitted_hcp_and_stops_at_the_boundary(director, db):
    territory = data(drill(director, "TERRITORY", "T01-02"), "directorDrilldown")
    hcp = territory["children"][0]["id"]
    ok = director.query(HCP_TIMELINE, {"hcpId": hcp})
    assert not ok.errors and (ok.data["hcpTimeline"]["interactions"] or ok.data["hcpTimeline"]["responses"])
    # an HCP only reachable through another region is refused, and looks the same as one that does not exist
    (foreign,) = db.execute(
        """SELECT x.hcp_id FROM hcp_identifier_crosswalk x JOIN call_activity c ON x.source_system = 'call_activity.cust_mdm_id'
             AND x.source_identifier = c.cust_mdm_id WHERE c.territory_id LIKE 'T03-%%'
             AND x.hcp_id NOT IN (SELECT x2.hcp_id FROM hcp_identifier_crosswalk x2 JOIN call_activity c2 ON x2.source_system = 'call_activity.cust_mdm_id'
               AND x2.source_identifier = c2.cust_mdm_id WHERE c2.territory_id LIKE 'T01-%%') LIMIT 1"""
    ).fetchone()
    refused, missing = director.query(HCP_TIMELINE, {"hcpId": foreign}), director.query(HCP_TIMELINE, {"hcpId": "HCP-DOES-NOT-EXIST"})
    assert "Forbidden" in refused.error_types and refused.error_types == missing.error_types
    assert refused.errors[0]["message"] == missing.errors[0]["message"]


def test_drilldown_refuses_an_out_of_scope_node_without_confirming_it_exists(director):
    for level, id_ in (("TERRITORY", "T02-01"), ("REGION", "REGION-02"), ("TERRITORY", "T99-99"), ("REGION", "REGION-99")):
        res = drill(director, level, id_)
        assert "Forbidden" in res.error_types, (level, id_)
    a, b = drill(director, "TERRITORY", "T02-01"), drill(director, "TERRITORY", "T99-99")
    assert a.errors[0]["message"] == b.errors[0]["message"]
    assert "BadRequest" in drill(director, "TERRITORY", "T01-01'; --").error_types
    assert "BadRequest" in drill(director, "TERRITORY", None).error_types


def test_drilldown_follows_effective_dated_scope(director, db):
    assert "Forbidden" in drill(director, "TERRITORY", "T02-01").error_types
    (assignment,) = db.execute(
        """INSERT INTO user_scope_assignments(user_id, territory_id, assignment_type, effective_from)
           VALUES ('director-region-01', 'T02-01', 'temporary', now() - interval '1 minute') RETURNING assignment_id"""
    ).fetchone()
    try:
        assert data(drill(director, "TERRITORY", "T02-01"), "directorDrilldown")["children"]
        db.execute("UPDATE user_scope_assignments SET effective_to = now() WHERE assignment_id = %s", (assignment,))
        assert "Forbidden" in drill(director, "TERRITORY", "T02-01").error_types
    finally:
        db.execute("DELETE FROM user_scope_assignments WHERE assignment_id = %s", (assignment,))


# --- exception table lists the planted seed defects --------------------------------------------------------------


def exceptions(persona):
    return data(persona.query(EXCEPTIONS, {"from": FROM, "to": TO}), "directorExceptions")


def test_exception_table_lists_stale_failed_and_missing_loads(director):
    ex = exceptions(director)
    loads = {e["exceptionId"]: e for e in ex["exceptions"] if e["category"] == "STALE_LOAD"}
    assert set(loads) == {"load:hcp-insights", "load:question-tag", "load:roster"}
    assert "stale" in loads["load:hcp-insights"]["title"] and "more than 30 days" in loads["load:hcp-insights"]["detail"]
    assert "failed" in loads["load:question-tag"]["title"]
    assert "No load is recorded" in loads["load:roster"]["detail"]
    assert all(e["rule"] for e in ex["exceptions"]) and ex["note"]


def test_exception_table_counts_equal_the_source_rows_in_scope(director, db):
    ex = exceptions(director)
    orphan = {e["territoryId"]: e for e in ex["exceptions"] if e["exceptionId"].startswith("orphan:")}
    for tid in REGION1:
        (n,) = db.execute(
            """SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights h WHERE territory_id = %s AND qstn_pid IS NOT NULL
               AND excluded_rspns_flag IS NOT TRUE AND NOT EXISTS (SELECT 1 FROM question_tag q WHERE q.qstn_ext_id = h.qstn_pid)""",
            (tid,),
        ).fetchone()
        if n:
            assert orphan[tid]["affectedCount"] == n and orphan[tid]["category"] == "MISSING_JOIN"
            assert orphan[tid]["sampleRecordIds"] and "Q-NOT-IN-CATALOG" in orphan[tid]["title"]
        else:
            assert tid not in orphan
    status = {e["territoryId"]: e for e in ex["exceptions"] if e["category"] == "STATUS_DIFFERENCE"}
    for tid in REGION1:
        (n,) = db.execute(
            """SELECT count(DISTINCT h.uniq_rspns_id) FROM hcp_raw_insights h JOIN (SELECT qstn_ext_id, min(qstn_tag_status) s FROM question_tag GROUP BY 1) q
                 ON q.qstn_ext_id = h.qstn_ext_id WHERE h.territory_id = %s AND h.qstn_tag_status IS DISTINCT FROM q.s""",
            (tid,),
        ).fetchone()
        assert status[tid]["affectedCount"] == n > 0
    joins = {e["territoryId"] for e in ex["exceptions"] if e["exceptionId"].startswith("roster-join:")}
    assert joins == set(REGION1), "call-feed team ids match no roster member in every territory"
    assert {c["category"]: c["count"] for c in ex["categories"]}["STALE_LOAD"] == 3
    assert sum(c["count"] for c in ex["categories"]) == len(ex["exceptions"])


def test_each_director_sees_the_defects_planted_in_their_own_region_only(db):
    rows = db.execute(
        "SELECT territory_id FROM hcp_raw_insights WHERE uniq_rspns_id = 'RESP-000001' ORDER BY source_row_id"
    ).fetchall()
    dup_territories = [r[0] for r in rows]
    assert len(dup_territories) == 2, "the seed plants one duplicate response key"
    seen = {}
    for region in ("01", "03", "04"):
        ex = exceptions(Persona.sign_in(f"director-region-{region}"))["exceptions"]
        seen[region] = ex
        # a duplicate is only visible when both rows are inside the Director's scope (RLS hides the other one)
        in_scope = [t for t in dup_territories if t.startswith(f"T{region}-")]
        dup = [e for e in ex if e["category"] == "DUPLICATE_KEY"]
        if len(in_scope) == 2:
            assert dup and dup[0]["sampleRecordIds"] == ["RESP-000001"] and dup[0]["affectedCount"] == 2, region
        else:
            assert not dup, region
        assert all(e["territoryId"] is None or e["territoryId"].startswith(f"T{region}-") for e in ex), region
    ident = [e for e in seen["04"] if e["category"] == "UNRESOLVED_IDENTITY"]
    assert ident and ident[0]["territoryId"] == "T04-01" and ident[0]["affectedCount"] == 2
    assert not [e for e in seen["01"] if e["category"] == "UNRESOLVED_IDENTITY"]


def test_exceptions_never_expose_names_emails_or_response_text(director):
    body = json.dumps(exceptions(director))
    assert "@example.test" not in body and "Review Candidate" not in body


def test_a_missing_reporting_month_is_detected(director, db):
    """Arrange a territory with no calls in a full month, and the rule reports it (never a person)."""
    saved = db.execute("SELECT source_row_id FROM call_activity WHERE territory_id = 'T01-03' AND call_dt BETWEEN '2026-09-01' AND '2026-09-30'").fetchall()
    ids = [r[0] for r in saved]
    rows = db.execute("SELECT * FROM call_activity WHERE source_row_id = ANY(%s)", (ids,)).fetchall()
    cols = [d.name for d in db.execute("SELECT * FROM call_activity LIMIT 0").description]
    db.execute("DELETE FROM call_activity WHERE source_row_id = ANY(%s)", (ids,))
    try:
        found = [e for e in exceptions(director)["exceptions"] if e["category"] == "MISSING_REPORTING"]
        assert [e["territoryId"] for e in found] == ["T01-03"] and "2026-09" in found[0]["detail"]
    finally:
        keep = [c for c in cols if c != "source_row_id"]
        idx = [cols.index(c) for c in keep]
        for row in rows:
            db.execute(f"INSERT INTO call_activity ({', '.join(keep)}) VALUES ({', '.join(['%s'] * len(keep))})", [row[i] for i in idx])
    assert not [e for e in exceptions(director)["exceptions"] if e["category"] == "MISSING_REPORTING"]


# --- territory summary evidence ----------------------------------------------------------------------------------


def test_summary_evidence_matches_the_source_rows_and_cites_in_scope_responses(director, db):
    res = data(director.query(SUMMARY_EVIDENCE, {"from": FROM, "to": TO}), "territorySummaryEvidence")
    assert sorted(t["territoryId"] for t in res["territories"]) == REGION1
    assert (res["priorFrom"], res["priorTo"]) == prior_window(FROM, TO)
    pfrom, pto = prior_window(FROM, TO)
    for t in res["territories"]:
        cur, pri = theme_counts(db, [t["territoryId"]], FROM, TO), theme_counts(db, [t["territoryId"]], pfrom, pto)
        cur_total, pri_total = sum(cur.values()), sum(pri.values())
        assert (t["freeTextResponses"], t["priorFreeTextResponses"]) == (cur_total, pri_total)
        assert 1 <= len(t["topThemes"]) <= 3 and all(x["topic"] != "Other perspectives" for x in t["topThemes"])
        for theme in t["topThemes"]:
            c, p = cur.get((t["territoryId"], theme["topic"]), 0), pri.get((t["territoryId"], theme["topic"]), 0)
            assert (theme["currentResponses"], theme["priorResponses"]) == (c, p)
            assert theme["status"] == reference_status(c, p, cur_total, pri_total)
            assert all(ev["territoryId"] == t["territoryId"] for ev in theme["evidence"])
        for flag in t["flagged"]:
            assert flag["status"] in ("EMERGING", "DECLINING")
    assert "AI" in res["note"]


# --- scoped natural-language analysis through the chat panel path ---------------------------------------------


def run_chat(persona, message, context=None, timeout=120):
    thread_id, run_id = str(uuid.uuid4()), str(uuid.uuid4())
    started = persona.query(START_CHAT_WITH_CONTEXT, {"threadId": thread_id, "runId": run_id, "message": message, "context": context})
    if started.errors:
        return started, None
    import time

    after, events = 0, []
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        page = persona.query(CHAT_EVENTS, {"runId": run_id, "after": after})
        assert not page.errors, page.errors
        body = page.data["chatEvents"]
        for item in body["events"]:
            after = item["seq"]
            events.append(json.loads(item["data"]))
        if body["done"]:
            return started, events
        time.sleep(0.25)
    raise AssertionError("chat run did not finish")


def facts(events):
    return [f for e in events if e.get("type") == "CUSTOM" and e.get("name") == "source_facts" for f in e["value"]["facts"]]


def test_territory_summary_run_uses_deterministic_facts_and_cited_responses(director, db):
    started, events = run_chat(
        director,
        "Summarize the recorded themes and changes for territory T01-02.",
        {"view": "director-insights", "territoryId": "T01-02", "from": FROM, "to": TO, "intent": "TERRITORY_SUMMARY"},
    )
    assert not started.errors and events[-1]["type"] == "RUN_FINISHED", events[-2:]
    by_label = {f["label"]: f for f in facts(events)}
    truth = theme_counts(db, ["T01-02"], FROM, TO)
    topic_facts = {k.removeprefix("Responses on "): v for k, v in by_label.items() if k.startswith("Responses on ")}
    assert topic_facts, list(by_label)
    for topic, fact in topic_facts.items():
        assert fact["value"] == truth[("T01-02", topic)], topic
        assert fact["scope"] == "T01-02"
    assert by_label["Free-text responses in the latest period"]["value"] == sum(truth.values())
    cites = [c for e in events if e.get("name") == "citations" for c in e["value"]]
    assert cites and all(c["dataset"] == "hcp_raw_insights" for c in cites)
    for c in cites:
        (tid,) = db.execute("SELECT territory_id FROM hcp_raw_insights WHERE uniq_rspns_id = %s LIMIT 1", (c["record_id"],)).fetchone()
        assert tid == "T01-02"
    assert any(e.get("name") == "number_check" for e in events)
    assert "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT").strip()


def test_scoped_question_analysis_reads_only_what_the_caller_may_see(director, db):
    q = question(director)
    opt = first_of_type(q, "yes_no")
    started, events = run_chat(director, f"How did HCPs answer {opt['questionId']}?", {"view": "director-insights", "questionId": opt["questionId"], "from": FROM, "to": TO})
    assert not started.errors and events[-1]["type"] == "RUN_FINISHED"
    (responses,) = db.execute(
        """SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE qstn_ext_id = %s AND territory_id = ANY(%s)
           AND date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE""",
        (opt["questionId"], REGION1, FROM, TO),
    ).fetchone()
    assert any(f["value"] == responses for f in facts(events)), (responses, facts(events))


def test_chat_context_naming_another_regions_territory_reads_nothing(director):
    started, events = run_chat(
        director,
        "Summarize the recorded themes for this territory.",
        {"view": "director-insights", "territoryId": "T02-01", "from": FROM, "to": TO, "intent": "TERRITORY_SUMMARY"},
    )
    assert not started.errors and events[-1]["type"] == "RUN_FINISHED"
    assert not [f for f in facts(events) if f["label"].startswith("Responses on")]
    assert not [e for e in events if e.get("name") == "citations"]


def test_only_a_director_may_start_a_territory_summary_and_bad_context_is_refused():
    msl = Persona.sign_in("msl-t01-01")
    started, _ = run_chat(msl, "Summarize.", {"territoryId": "T01-01", "intent": "TERRITORY_SUMMARY"})
    assert "Forbidden" in started.error_types
    for bad in ({"territoryId": "T01-01; DROP"}, {"intent": "TERRITORY_SUMMARY"}, {"from": "2026-11-03", "to": "2026-08-06"}):
        started, _ = run_chat(Persona.sign_in("director-region-01"), "Hello?", bad)
        assert "BadRequest" in started.error_types, bad


# --- logging --------------------------------------------------------------------------------------------------------


def test_logs_carry_ids_and_counts_never_response_text_or_names(director):
    h = heatmap(director)
    excerpt = h["themeCards"][0]["evidence"][0]["excerpt"][:40]
    drill(director, "TERRITORY", "T01-02")
    question(director)
    exceptions(director)
    logs = be_lambda_logs("5m")
    assert "topic heatmap computed" in logs and "director drilldown" in logs
    assert excerpt not in logs and "Synthetic HCP" not in logs and "@example.test" not in logs
