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
    assert scalar(db, "SELECT count(*) FROM medical_roster") == 60
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
