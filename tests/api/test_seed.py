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
