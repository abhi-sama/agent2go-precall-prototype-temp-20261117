"""The seed loads at the agreed volume and contains the planted data-quality defects."""

from __future__ import annotations


def scalar(db, sql: str, *args):
    return db.execute(sql, args).fetchone()[0]


def test_seed_volume(db):
    assert scalar(db, "SELECT count(*) FROM call_activity") == 25000
    assert scalar(db, "SELECT count(*) FROM hcp_raw_insights") == 60000
    assert scalar(db, "SELECT count(*) FROM question_tag") == 400
    assert scalar(db, "SELECT count(DISTINCT child_territory_id) FROM territory_scope_relationships") == 24
    assert scalar(db, "SELECT count(DISTINCT parent_territory_id) FROM territory_scope_relationships WHERE parent_territory_id LIKE 'REGION-%%'") == 4
    assert scalar(db, "SELECT count(*) FROM medical_roster") == 62  # 60 staff + two planted duplicate-email candidates
    assert scalar(db, "SELECT count(*) FROM users") == 36


def test_call_ids_repeat_across_product_rows(db):
    assert scalar(db, "SELECT count(*) FROM call_activity") > scalar(db, "SELECT count(DISTINCT crm_call_id) FROM call_activity")


def test_planted_duplicate_response_key(db):
    assert scalar(db, "SELECT count(*) FROM (SELECT uniq_rspns_id FROM hcp_raw_insights GROUP BY 1 HAVING count(*) > 1) d") >= 1


def test_planted_orphan_parent_question(db):
    assert scalar(
        db,
        """SELECT count(*) FROM question_tag q WHERE q.qstn_pid IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM question_tag p WHERE p.qstn_ext_id = q.qstn_pid)""",
    ) >= 1


def test_planted_catalog_vs_response_status_differences(db):
    assert scalar(
        db,
        """SELECT count(*) FROM hcp_raw_insights h JOIN question_tag q USING (qstn_ext_id)
           WHERE h.qstn_tag_status IS DISTINCT FROM q.qstn_tag_status""",
    ) >= 1


def test_planted_stale_and_failed_loads(db):
    assert scalar(db, "SELECT count(*) FROM ingestion_runs WHERE status = 'failed'") >= 1
    assert scalar(db, "SELECT count(*) FROM ingestion_runs WHERE status = 'completed' AND completed_at < now() - interval '30 days'") >= 1


def test_planted_unresolved_identities(db):
    assert scalar(db, "SELECT count(*) FROM users WHERE identity_status <> 'matched'") >= 1


def test_roster_time_only_dates_stay_text(db):
    assert scalar(db, "SELECT count(*) FROM medical_roster WHERE start_date ~ '^[0-9]{2}:[0-9]{2}'") >= 1


# --- Geography: every territory is a real US state or a real country, everywhere it appears.

#: Three-digit ZIP prefixes by state (USPS), enough to prove postal code and state agree.
ZIP3 = {
    "MA": range(10, 28), "NY": range(100, 150), "PA": range(150, 197), "CT": range(60, 70), "NJ": range(70, 90),
    "GA": [*range(300, 320), 398, 399], "NC": range(270, 290), "FL": range(320, 350), "TN": range(370, 386),
    "TX": [*range(750, 800), 885], "IL": range(600, 630), "MI": range(480, 500), "MN": range(550, 568),
    "OH": range(430, 459), "WA": range(980, 995), "OR": range(970, 980), "CA": range(900, 962), "AZ": range(850, 866),
}
POSTAL = {  # non-US countries: the national postal code shape
    "CA": r"^[A-Z]\d[A-Z] \d[A-Z]\d$", "GB": r"^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$", "DE": r"^\d{5}$",
    "FR": r"^\d{5}$", "JP": r"^\d{3}-\d{4}$", "BR": r"^\d{5}-\d{3}$",
}


def test_every_territory_has_one_real_location(db):
    assert scalar(db, "SELECT count(*) FROM territory_geography") == 24
    assert scalar(db, "SELECT count(DISTINCT territory_id) FROM call_activity") == 24
    assert scalar(
        db,
        """SELECT count(*) FROM (SELECT DISTINCT territory_id FROM call_activity) c
           LEFT JOIN territory_geography g USING (territory_id) WHERE g.territory_id IS NULL""",
    ) == 0
    countries = {r[0] for r in db.execute("SELECT DISTINCT country_code FROM territory_geography").fetchall()}
    assert "US" in countries and 4 <= len(countries) - 1 <= 8, "a handful of international countries"
    assert scalar(db, "SELECT count(*) FROM territory_geography WHERE country_code = 'US'") == 18, "most territories are US states"
    assert scalar(db, "SELECT count(DISTINCT subdivision_code) FROM territory_geography WHERE country_code = 'US'") == 18, "one territory per state"


def test_call_address_agrees_with_the_territory_location(db):
    rows = db.execute(
        """SELECT g.country_code, g.subdivision_code, c.territory_id, c.st_cd, c.city, c.pstl_cd, c.addr_ln_1
           FROM call_activity c JOIN territory_geography g USING (territory_id)
           GROUP BY 1, 2, 3, 4, 5, 6, 7"""
    ).fetchall()
    assert len(rows) == 48, "two cities per territory"
    import re
    for country, sub, tid, st_cd, city, postal, street in rows:
        assert st_cd == sub, f"{tid}: state {st_cd} != territory state {sub}"
        assert city and street, tid
        if country == "US":
            assert re.fullmatch(r"\d{5}", postal) and int(postal[:3]) in ZIP3[st_cd], f"{tid}: ZIP {postal} is not in {st_cd}"
        else:
            assert re.fullmatch(POSTAL[country], postal), f"{tid}: postal code {postal} is not a {country} postal code"


def test_insight_country_agrees_with_the_territory_location(db):
    assert scalar(
        db,
        """SELECT count(*) FROM hcp_raw_insights i JOIN territory_geography g USING (territory_id)
           WHERE i.insight_country IS DISTINCT FROM g.country_code OR i.country_nm IS DISTINCT FROM g.country_name""",
    ) == 0
    assert scalar(db, "SELECT count(DISTINCT insight_country) FROM hcp_raw_insights") >= 5


# --- Insight data variety (ticket 27): every answer type, conditional follow-ups, planted signal.

def test_questions_span_every_answer_type(db):
    types = {r[0]: r[1] for r in db.execute("SELECT qstn_type, count(*) FROM question_tag GROUP BY 1").fetchall()}
    assert set(types) == {"open_text", "single_choice", "multi_select", "yes_no", "likert_5", "rating_0_10", "numeric", "date", "ranking"}
    assert all(n >= 8 for n in types.values())
    answered = {r[0] for r in db.execute("SELECT DISTINCT qstn_type FROM hcp_raw_insights").fetchall()}
    assert answered == set(types), "every question type has stored answers"


def test_response_rows_carry_the_catalog_question_type_and_metadata(db):
    assert scalar(
        db,
        """SELECT count(*) FROM hcp_raw_insights h JOIN question_tag q USING (qstn_ext_id)
           WHERE h.qstn_type IS DISTINCT FROM q.qstn_type OR h.qstn_txt IS DISTINCT FROM q.qstn_txt
              OR h.molecule_type IS DISTINCT FROM q.molecule_type OR h.survey_type IS DISTINCT FROM q.survey_type""",
    ) == 0


def test_scaled_numeric_and_date_answers_parse(db):
    assert scalar(db, "SELECT count(*) FROM hcp_raw_insights WHERE qstn_type = 'likert_5' AND rspns_txt NOT IN ('1','2','3','4','5')") == 0
    assert scalar(db, "SELECT count(*) FROM hcp_raw_insights WHERE qstn_type = 'rating_0_10' AND rspns_txt !~ '^([0-9]|10)$'") == 0
    assert scalar(db, "SELECT count(*) FROM hcp_raw_insights WHERE qstn_type = 'yes_no' AND rspns_txt NOT IN ('Yes','No','Unsure')") == 0
    assert scalar(db, "SELECT count(*) FROM hcp_raw_insights WHERE qstn_type = 'numeric' AND rspns_txt !~ '^[0-9]+$'") == 0
    assert scalar(db, "SELECT count(*) FROM hcp_raw_insights WHERE qstn_type = 'date' AND rspns_txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'") == 0
    assert scalar(db, "SELECT count(*) FROM hcp_raw_insights WHERE qstn_type = 'date' AND rspns_txt::date IS NULL") == 0


def test_qualitative_answers_are_varied_and_do_not_repeat_often(db):
    assert scalar(db, "SELECT count(DISTINCT rspns_txt) FROM hcp_raw_insights WHERE qstn_type = 'open_text'") >= 2000
    assert scalar(db, "SELECT max(n) FROM (SELECT count(*) AS n FROM hcp_raw_insights WHERE qstn_type = 'open_text' GROUP BY rspns_txt) t") <= 4
    assert scalar(db, "SELECT count(*) FROM hcp_raw_insights WHERE rspns_txt ILIKE 'Recorded perspective%%'") == 0


def test_follow_ups_sit_in_the_parents_interaction_and_agree_with_it(db):
    # Every follow-up row (other than the planted orphan) has exactly one parent answer in the same interaction and for the same HCP.
    assert scalar(
        db,
        """SELECT count(*) FROM hcp_raw_insights c WHERE c.qstn_pid IS NOT NULL AND c.qstn_pid <> 'Q-NOT-IN-CATALOG'
           AND (SELECT count(*) FROM hcp_raw_insights p WHERE p.insight_intrctn_dtl_sfdc_id = c.insight_intrctn_dtl_sfdc_id
                AND p.qstn_ext_id = c.qstn_pid AND p.cust_mdm_id = c.cust_mdm_id AND p.date_of_interaction = c.date_of_interaction) <> 1""",
    ) == 0
    assert scalar(db, "SELECT count(*) FROM hcp_raw_insights WHERE qstn_pid IS NOT NULL AND qstn_pid <> 'Q-NOT-IN-CATALOG'") > 8000
    # A parent's follow-up fields name the child row that exists in its interaction, with the same question and answer.
    assert scalar(
        db,
        """SELECT count(*) FROM hcp_raw_insights p WHERE p.followup_qid IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM hcp_raw_insights c WHERE c.insight_intrctn_dtl_sfdc_id = p.insight_intrctn_dtl_sfdc_id AND c.qstn_ext_id = p.followup_qid
               AND c.qstn_pid = p.qstn_ext_id AND c.rspns_txt = p.followup_rspns AND c.qstn_txt = p.followup_qstn)""",
    ) == 0
    # "No" / "Unsure" to 'started a patient recently' triggers a barrier question; "Yes" never does.
    assert scalar(
        db,
        """SELECT count(*) FROM hcp_raw_insights c JOIN hcp_raw_insights p ON p.insight_intrctn_dtl_sfdc_id = c.insight_intrctn_dtl_sfdc_id AND p.qstn_ext_id = c.qstn_pid
           WHERE c.qstn_txt LIKE 'What is the main barrier to starting patients%%' AND p.rspns_txt = 'Yes'""",
    ) == 0
    assert scalar(
        db,
        """SELECT count(*) FROM hcp_raw_insights c JOIN hcp_raw_insights p ON p.insight_intrctn_dtl_sfdc_id = c.insight_intrctn_dtl_sfdc_id AND p.qstn_ext_id = c.qstn_pid
           WHERE c.qstn_txt LIKE 'What is the main reason for your low score%%' AND p.qstn_type = 'likert_5' AND p.rspns_txt::int > 2""",
    ) == 0


def test_emerging_topics_grow_in_the_last_90_days(db):
    rows = db.execute(
        r"""SELECT (date '2026-11-03' - date_of_interaction) < 90 AS recent, count(*) FILTER (WHERE rspns_txt ~* 'ctdna|liquid biopsy|\mmrd\M'), count(*)
           FROM hcp_raw_insights WHERE qstn_type = 'open_text' GROUP BY 1"""
    ).fetchall()
    share = {recent: hits / total for recent, hits, total in rows}
    assert share[True] > 4 * share[False]


def test_the_tracker_panel_shifts_perspective_over_time(db):
    rows = db.execute(
        """SELECT CASE WHEN date_of_interaction < '2026-02-01' THEN 1 WHEN date_of_interaction < '2026-08-01' THEN 2 ELSE 3 END AS wave, avg(rspns_txt::numeric)
           FROM hcp_raw_insights WHERE qstn_ext_id IN ('Q-0005','Q-0006','Q-0007','Q-0008')
             AND cust_mdm_id IN (SELECT cust_mdm_id FROM hcp_raw_insights WHERE qstn_ext_id IN ('Q-0005','Q-0006','Q-0007','Q-0008') GROUP BY 1 HAVING count(*) = 3)
           GROUP BY 1 ORDER BY 1"""
    ).fetchall()
    means = [float(m) for _, m in rows]
    assert len(means) == 3 and means[0] + 0.6 < means[1] < means[2] - 0.4, means
