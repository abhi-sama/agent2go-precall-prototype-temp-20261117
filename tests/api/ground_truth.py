"""Expected KPI values, computed with the owner role (no RLS) for explicit territories.

These mirror the governed metric definitions (docs/adr/0003) independently of the
Lambda's SQL, so a scoping bug in the API cannot also hide in the expectation.
"""

from __future__ import annotations

import psycopg


def kpis(db: psycopg.Connection, territories: list[str], frm: str, to: str) -> dict[str, int]:
    calls, hcps = db.execute(
        """SELECT count(DISTINCT crm_call_id), count(DISTINCT cust_mdm_id) FROM call_activity
           WHERE territory_id = ANY(%s) AND call_dt BETWEEN %s AND %s""",
        (territories, frm, to),
    ).fetchone()
    (responses,) = db.execute(
        """SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights
           WHERE territory_id = ANY(%s) AND date_of_interaction BETWEEN %s AND %s
             AND excluded_rspns_flag IS NOT TRUE""",
        (territories, frm, to),
    ).fetchone()
    return {"distinctCalls": calls, "distinctEngagedHcps": hcps, "responseCount": responses}


def raw_call_rows(db: psycopg.Connection, territories: list[str], frm: str, to: str) -> int:
    (n,) = db.execute(
        "SELECT count(*) FROM call_activity WHERE territory_id = ANY(%s) AND call_dt BETWEEN %s AND %s",
        (territories, frm, to),
    ).fetchone()
    return n


def region_territories(db: psycopg.Connection, region: str) -> list[str]:
    rows = db.execute(
        "SELECT DISTINCT child_territory_id FROM territory_scope_relationships WHERE parent_territory_id = %s",
        (region,),
    ).fetchall()
    return sorted(r[0] for r in rows)


def calls_by_territory(db: psycopg.Connection, territories: list[str], frm: str, to: str) -> dict[str, int]:
    rows = db.execute(
        """SELECT g.territory_id, count(DISTINCT c.crm_call_id)
           FROM territory_geography g
           LEFT JOIN call_activity c ON c.territory_id = g.territory_id AND c.call_dt BETWEEN %s AND %s
           WHERE g.territory_id = ANY(%s) GROUP BY g.territory_id""",
        (frm, to, territories),
    ).fetchall()
    return dict(rows)


def calls_by_country(db: psycopg.Connection, territories: list[str], frm: str, to: str) -> dict[str, int]:
    """Distinct calls per country, counted over the country's territories at once."""
    rows = db.execute(
        """SELECT g.country_code, count(DISTINCT c.crm_call_id)
           FROM territory_geography g
           LEFT JOIN call_activity c ON c.territory_id = g.territory_id AND c.call_dt BETWEEN %s AND %s
           WHERE g.territory_id = ANY(%s) GROUP BY g.country_code""",
        (frm, to, territories),
    ).fetchall()
    return dict(rows)


def answer_share(db: psycopg.Connection, territories: list[str], question_id: str, answer: str, frm: str, to: str) -> tuple[int, int]:
    """(responses with this answer, responses to the question) over the window, each response counted once."""
    num, den = db.execute(
        """SELECT count(DISTINCT uniq_rspns_id) FILTER (WHERE btrim(rspns_txt) = %s), count(DISTINCT uniq_rspns_id)
           FROM hcp_raw_insights
           WHERE qstn_ext_id = %s AND territory_id = ANY(%s) AND date_of_interaction BETWEEN %s AND %s
             AND excluded_rspns_flag IS NOT TRUE AND uniq_rspns_id IS NOT NULL""",
        (answer, question_id, territories, frm, to),
    ).fetchone()
    return num, den


def topic_matches(db: psycopg.Connection, territories: list[str], topic: str, frm: str, to: str) -> int:
    like = f"%{topic}%"
    (n,) = db.execute(
        """SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights
           WHERE territory_id = ANY(%s) AND date_of_interaction BETWEEN %s AND %s AND excluded_rspns_flag IS NOT TRUE
             AND uniq_rspns_id IS NOT NULL
             AND (qstn_txt ILIKE %s OR rspns_txt ILIKE %s OR molecule_type ILIKE %s OR landscape_type ILIKE %s
                  OR study_name ILIKE %s OR survey_type ILIKE %s)""",
        (territories, frm, to, *([like] * 6)),
    ).fetchone()
    return n
