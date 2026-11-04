"""Director insights: topic heatmap, question analytics, emerging topics, drill-down, exceptions, summary evidence.

Access is the team-overview gate (``team.overview.read``, administrators via ``admin.manage``) and every
query runs under the caller's row-level security (docs/adr/0003), so only approved descendant territories
and the records inside them exist for a Director. Numbers are SQL. Nothing here calls a model.

Definitions (``DEFINITION_VERSION``):

* A *free-text response* is a non-blank, non-excluded answer to an ``open_text`` question, counted once per
  ``uniq_rspns_id``. Its *theme* is ``app.theme_of(answer)``, a transparent keyword baseline shown everywhere as
  derived, never as a source fact.
* The heatmap shares are a theme's responses over that territory's free-text responses (the denominator is
  returned with every row).
* Emerging topics compare the requested window with the immediately preceding window of equal length. The rule
  (``app.emerging_thresholds`` / ``app.emerging_status``) is evaluated in the database and returned with the
  result. It reports a change in recorded responses and never a cause.
* A question's response bars never mix questions: counts are distinct responses to that one question,
  distinct HCPs are ``cust_mdm_id`` values, and a follow-up is read against its parent only inside the same
  interaction (``insight_intrctn_dtl_sfdc_id``).
"""

from __future__ import annotations

import datetime as dt
import re
import statistics
from collections import defaultdict
from collections.abc import Mapping
from typing import Any

import psycopg

from a2g_logging import get_logger

from .activity import _add_months, _as_date, _month_start
from .director import (
    DEFAULT_WINDOW_DAYS,
    MAX_WINDOW_DAYS,
    _require_team_overview,
    _scope_territories,
    _window,
    _window_months,
)
from .errors import BadRequest, Forbidden, NoScope
from .identity import Identity
from .resolvers import _data_through, _filters, _insight_where, _scope

log = get_logger(__name__)

DEFINITION_VERSION = "director-insights-v1"
OTHER_THEME = "Other perspectives"
EXCERPT_CHARS = 280
MAX_FACET_VALUES = 5
CARDS_PER_FACET = 3
MAX_DRILL_HCPS = 100
MAX_SAMPLE_IDS = 5

# Whitelisted facet columns (never built from caller text). Tumor type lives on the catalog, not on responses.
FACETS: dict[str, tuple[str, str]] = {
    "MOLECULE": ("Molecule", "h.molecule_type"),
    "TUMOR_TYPE": ("Tumor type", "tq.tumor_type"),
    "STUDY": ("Study", "h.study_name"),
    "SURVEY": ("Survey", "h.survey_type"),
}

_QUESTION_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
_ENTITY_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")
_MULTI_DELIM = ";"

STATEMENT = (
    "These figures describe what recorded responses mention and how that changed between two equal periods. "
    "They do not say why, and a theme is a keyword grouping of free text, not a source fact."
)

_FREE_TEXT = (
    "h.qstn_type = 'open_text' AND nullif(btrim(h.rspns_txt), '') IS NOT NULL AND h.excluded_rspns_flag IS NOT TRUE"
)


def _gate(cur: psycopg.Cursor, identity: Identity) -> tuple[str, int]:
    _assigned, effective, label = _scope(cur, identity)
    _require_team_overview(cur, label, effective)
    return label, effective


def _facet(args: Mapping[str, Any]) -> str | None:
    raw = args.get("facet")
    if raw in (None, "", "NONE"):
        return None
    if raw not in FACETS:
        raise BadRequest("invalid_facet")
    return str(raw)


def _clip(text: str | None, limit: int = EXCERPT_CHARS) -> str:
    value = " ".join((text or "").split())
    return value if len(value) <= limit else value[: limit - 1] + "…"


def _filter_sql(args: Mapping[str, Any], alias: str = "h", tids: list[str] | None = None) -> tuple[str, dict[str, Any]]:
    """The shared filter facets as SQL, plus (when given) the territories the caller's geography scope lists.

    RLS already limits the rows; restricting to the listed territories keeps an administrator's views
    consistent with the territory list they are shown, and changes nothing for a Director.
    """
    filters = _filters(args)
    clauses, params = _insight_where(filters, alias)
    out = dict(params)
    if tids is not None:
        clauses = [*clauses, f"{alias}.territory_id = ANY(%(scope_tids)s)"]
        out["scope_tids"] = tids
    return "".join(f" AND {c}" for c in clauses), out


def _tumor_join(facet: str | None) -> str:
    if facet != "TUMOR_TYPE":
        return ""
    return " LEFT JOIN (SELECT qstn_ext_id, min(tumor_type) AS tumor_type FROM question_tag GROUP BY qstn_ext_id) tq ON tq.qstn_ext_id = h.qstn_ext_id"


def _evidence(rows: list[tuple[Any, ...]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for record_id, text, question, day, territory in rows:
        if record_id in seen:
            continue
        seen.add(record_id)
        out.append(
            {
                "recordId": record_id,
                "excerpt": _clip(text),
                "questionText": question,
                "interactionDate": day.isoformat() if day else None,
                "territoryId": territory,
            }
        )
    return out


# --------------------------------------------------------------------------------------------------
# Topic-by-territory heatmap and theme cards
# --------------------------------------------------------------------------------------------------
def topic_heatmap(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    label, _effective = _gate(cur, identity)
    data_through = _data_through(cur)
    frm, to = _window(args, data_through)
    facet = _facet(args)
    territories = _scope_territories(cur)
    if not territories:
        raise NoScope("no_effective_scope")
    where, params = _filter_sql(args, "h", [t["territoryId"] for t in territories])
    params.update({"frm": frm, "to": to})

    base = f"""
        FROM hcp_raw_insights h {_tumor_join(facet)}
        WHERE {_FREE_TEXT} AND h.date_of_interaction BETWEEN %(frm)s AND %(to)s {where}
    """
    cur.execute(
        f"""
        SELECT h.territory_id, app.theme_of(h.rspns_txt) AS topic,
               count(DISTINCT h.uniq_rspns_id), count(DISTINCT h.cust_mdm_id)
        {base} GROUP BY 1, 2
        """,
        params,
    )
    cells_raw = cur.fetchall()
    territory_totals: dict[str, int] = defaultdict(int)
    topic_totals: dict[str, int] = defaultdict(int)
    for tid, topic, n, _hcps in cells_raw:
        territory_totals[tid] += int(n)
        topic_totals[topic] += int(n)
    cells = [
        {
            "territoryId": tid,
            "topic": topic,
            "responses": int(n),
            "distinctHcps": int(hcps),
            "share": round(100.0 * int(n) / territory_totals[tid], 1),
            "territoryResponses": territory_totals[tid],
        }
        for tid, topic, n, hcps in cells_raw
    ]
    cur.execute(
        f"SELECT app.theme_of(h.rspns_txt), count(DISTINCT h.cust_mdm_id) {base} GROUP BY 1",
        params,
    )
    topic_hcps = {topic: int(n) for topic, n in cur.fetchall()}
    topics = sorted(
        (
            {"topic": t, "responses": n, "distinctHcps": topic_hcps.get(t, 0), "isOther": t == OTHER_THEME}
            for t, n in topic_totals.items()
        ),
        key=lambda item: (item["isOther"], -item["responses"], item["topic"]),
    )

    # Theme cards: every topic (or, with a facet, each facet value's leading topics) with evidence excerpts.
    facet_expr = FACETS[facet][1] if facet else "''::text"
    cur.execute(
        f"""
        WITH b AS (
          SELECT coalesce({facet_expr}, 'Unspecified') AS facet_value, app.theme_of(h.rspns_txt) AS topic,
                 h.territory_id, h.cust_mdm_id, h.uniq_rspns_id, h.rspns_txt, h.qstn_txt, h.date_of_interaction
          {base}
        ), agg AS (
          SELECT facet_value, topic, count(DISTINCT uniq_rspns_id) AS n, count(DISTINCT cust_mdm_id) AS hcps,
                 count(DISTINCT territory_id) AS terrs
          FROM b GROUP BY 1, 2
        ), ranked AS (
          SELECT agg.*, sum(n) OVER (PARTITION BY facet_value) AS total,
                 row_number() OVER (PARTITION BY facet_value ORDER BY (topic = %(other)s), n DESC, topic) AS rk
          FROM agg
        ), facet_rank AS (
          SELECT facet_value, row_number() OVER (ORDER BY sum(n) DESC, facet_value) AS frk FROM agg GROUP BY facet_value
        )
        SELECT r.facet_value, r.topic, r.n, r.hcps, r.terrs, r.total, r.rk, f.frk
        FROM ranked r JOIN facet_rank f USING (facet_value)
        WHERE r.rk <= %(per)s AND f.frk <= %(values)s
        ORDER BY f.frk, r.rk
        """,
        {**params, "other": OTHER_THEME, "per": CARDS_PER_FACET if facet else 8, "values": MAX_FACET_VALUES if facet else 1},
    )
    card_rows = cur.fetchall()
    cards: list[dict[str, Any]] = []
    for facet_value, topic, n, hcps, terrs, total, _rk, _frk in card_rows:
        cur.execute(
            f"""
            SELECT h.uniq_rspns_id, h.rspns_txt, h.qstn_txt, h.date_of_interaction, h.territory_id
            {base} AND app.theme_of(h.rspns_txt) = %(topic)s
              AND coalesce({facet_expr}, 'Unspecified') = %(fv)s AND h.uniq_rspns_id IS NOT NULL
            ORDER BY h.date_of_interaction DESC, h.uniq_rspns_id LIMIT 4
            """,
            {**params, "topic": topic, "fv": facet_value},
        )
        cards.append(
            {
                "cardId": f"{facet or 'ALL'}:{facet_value}:{topic}",
                "facetValue": facet_value if facet else None,
                "topic": topic,
                "responses": int(n),
                "distinctHcps": int(hcps),
                "territoryCount": int(terrs),
                "share": round(100.0 * int(n) / int(total), 1),
                "facetResponses": int(total),
                "evidence": _evidence(cur.fetchall())[:2],
            }
        )

    log.info(
        "topic heatmap computed",
        operation="topic_heatmap",
        user_id=user_id,
        territory_count=len(territories),
        count=len(cards),
        range_days=(to - frm).days + 1,
    )
    return {
        "from": frm.isoformat(),
        "to": to.isoformat(),
        "dataThrough": data_through.isoformat() if data_through else None,
        "scopeLabel": label,
        "definitionVersion": DEFINITION_VERSION,
        "facet": facet or "NONE",
        "facetLabel": FACETS[facet][0] if facet else None,
        "territories": [{**t, "freeTextResponses": territory_totals.get(t["territoryId"], 0)} for t in territories],
        "topics": topics,
        "cells": cells,
        "themeCards": cards,
        "freeTextResponses": sum(territory_totals.values()),
        "note": "Themes group free-text answers by keywords. They are derived, not source facts; each card cites the responses behind it.",
    }


# --------------------------------------------------------------------------------------------------
# Emerging topics
# --------------------------------------------------------------------------------------------------
def _prior_window(frm: dt.date, to: dt.date) -> tuple[dt.date, dt.date]:
    days = (to - frm).days + 1
    return frm - dt.timedelta(days=days), frm - dt.timedelta(days=1)


def _thresholds(cur: psycopg.Cursor) -> dict[str, Any]:
    cur.execute("SELECT min_window_responses, min_topic_responses, min_relative_increase, min_share_points FROM app.emerging_thresholds()")
    window, topic, rel, points = cur.fetchone()
    return {
        "minWindowResponses": int(window),
        "minTopicResponses": int(topic),
        "minRelativeIncrease": float(rel),
        "minSharePoints": float(points),
        "rule": (
            f"A topic is flagged EMERGING when both periods hold at least {int(window)} free-text responses, the topic has at least "
            f"{int(topic)} responses in the latest period, its share of responses rose by at least {float(points):g} percentage points, "
            f"and that share is at least {1 + float(rel):g} times the earlier share (or it had none before). DECLINING is the mirror image."
        ),
    }


def trend_rows(
    cur: psycopg.Cursor,
    frm: dt.date,
    to: dt.date,
    where: str,
    params: Mapping[str, Any],
    *,
    by_territory: bool,
) -> list[dict[str, Any]]:
    """Per-theme counts for the window and the equal window before it, with the deterministic status."""
    pfrm, pto = _prior_window(frm, to)
    tcol = "h.territory_id" if by_territory else "''::text"
    cur.execute(
        f"""
        WITH base AS (
          SELECT {tcol} AS territory_id, app.theme_of(h.rspns_txt) AS topic, h.uniq_rspns_id,
                 (h.date_of_interaction >= %(frm)s) AS in_cur
          FROM hcp_raw_insights h
          WHERE {_FREE_TEXT} AND h.date_of_interaction BETWEEN %(pfrm)s AND %(to)s {where}
        ), grp AS (
          SELECT territory_id, topic,
                 count(DISTINCT uniq_rspns_id) FILTER (WHERE in_cur) AS cur_n,
                 count(DISTINCT uniq_rspns_id) FILTER (WHERE NOT in_cur) AS pri_n
          FROM base GROUP BY 1, 2
        ), tot AS (
          SELECT territory_id,
                 count(DISTINCT uniq_rspns_id) FILTER (WHERE in_cur) AS cur_t,
                 count(DISTINCT uniq_rspns_id) FILTER (WHERE NOT in_cur) AS pri_t
          FROM base GROUP BY 1
        )
        SELECT g.territory_id, g.topic, g.cur_n, g.pri_n, t.cur_t, t.pri_t,
               app.emerging_status(g.cur_n, g.pri_n, t.cur_t, t.pri_t)
        FROM grp g JOIN tot t USING (territory_id)
        ORDER BY g.territory_id, g.cur_n DESC, g.topic
        """,
        {**params, "frm": frm, "pfrm": pfrm, "to": to},
    )
    out = []
    for tid, topic, cur_n, pri_n, cur_t, pri_t, status in cur.fetchall():
        cur_n, pri_n, cur_t, pri_t = int(cur_n), int(pri_n), int(cur_t), int(pri_t)
        cur_share = round(100.0 * cur_n / cur_t, 1) if cur_t else None
        pri_share = round(100.0 * pri_n / pri_t, 1) if pri_t else None
        out.append(
            {
                "territoryId": tid or None,
                "topic": topic,
                "currentResponses": cur_n,
                "priorResponses": pri_n,
                "currentTotal": cur_t,
                "priorTotal": pri_t,
                "currentShare": cur_share,
                "priorShare": pri_share,
                "sharePointChange": round(cur_share - pri_share, 1) if cur_share is not None and pri_share is not None else None,
                "status": status,
            }
        )
    return out


def emerging_topics(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    label, _effective = _gate(cur, identity)
    data_through = _data_through(cur)
    frm, to = _window(args, data_through)
    pfrm, pto = _prior_window(frm, to)
    territories = _scope_territories(cur)
    if not territories:
        raise NoScope("no_effective_scope")
    where, params = _filter_sql(args, "h", [t["territoryId"] for t in territories])
    thresholds = _thresholds(cur)
    rows = trend_rows(cur, frm, to, where, params, by_territory=False)

    # Weekly counts across both windows, for the trend chart.
    cur.execute(
        f"""
        SELECT app.theme_of(h.rspns_txt) AS topic, date_trunc('week', h.date_of_interaction)::date, count(DISTINCT h.uniq_rspns_id)
        FROM hcp_raw_insights h
        WHERE {_FREE_TEXT} AND h.date_of_interaction BETWEEN %(pfrm)s AND %(to)s {where}
        GROUP BY 1, 2 ORDER BY 2
        """,
        {**params, "pfrm": pfrm, "to": to},
    )
    counts: dict[str, dict[dt.date, int]] = defaultdict(dict)
    for topic, week, n in cur.fetchall():
        counts[topic][week] = int(n)
    weeks: list[dt.date] = []
    cursor_week = pfrm - dt.timedelta(days=pfrm.weekday())
    while cursor_week <= to:
        weeks.append(cursor_week)
        cursor_week += dt.timedelta(days=7)
    series = {
        topic: [{"weekStart": w.isoformat(), "responses": by_week.get(w, 0)} for w in weeks] for topic, by_week in counts.items()
    }

    flagged = [r["topic"] for r in rows if r["status"] in ("EMERGING", "DECLINING")]
    evidence: dict[str, list[dict[str, Any]]] = {}
    for topic in flagged:
        cur.execute(
            f"""
            SELECT h.uniq_rspns_id, h.rspns_txt, h.qstn_txt, h.date_of_interaction, h.territory_id
            FROM hcp_raw_insights h
            WHERE {_FREE_TEXT} AND h.date_of_interaction BETWEEN %(frm)s AND %(to)s {where}
              AND app.theme_of(h.rspns_txt) = %(topic)s AND h.uniq_rspns_id IS NOT NULL
            ORDER BY h.date_of_interaction DESC, h.uniq_rspns_id LIMIT 4
            """,
            {**params, "frm": frm, "to": to, "topic": topic},
        )
        evidence[topic] = _evidence(cur.fetchall())[:2]

    current_total = rows[0]["currentTotal"] if rows else 0
    prior_total = rows[0]["priorTotal"] if rows else 0
    topics = [
        {**r, "weeks": series.get(r["topic"], []), "evidence": evidence.get(r["topic"], [])}
        for r in sorted(rows, key=lambda r: (r["status"] != "EMERGING", r["status"] != "DECLINING", -r["currentResponses"], r["topic"]))
    ]
    log.info(
        "emerging topics evaluated",
        operation="emerging_topics",
        user_id=user_id,
        count=sum(1 for t in topics if t["status"] == "EMERGING"),
        range_days=(to - frm).days + 1,
    )
    return {
        "scopeLabel": label,
        "definitionVersion": DEFINITION_VERSION,
        "dataThrough": data_through.isoformat() if data_through else None,
        "current": {"from": frm.isoformat(), "to": to.isoformat(), "freeTextResponses": current_total},
        "prior": {"from": pfrm.isoformat(), "to": pto.isoformat(), "freeTextResponses": prior_total},
        "thresholds": thresholds,
        "sampleSufficient": current_total >= thresholds["minWindowResponses"] and prior_total >= thresholds["minWindowResponses"],
        "topics": topics,
        "statement": STATEMENT,
    }


# --------------------------------------------------------------------------------------------------
# Question-level analytics
# --------------------------------------------------------------------------------------------------
_LIKERT = {"1": 1, "2": 2, "3": 3, "4": 4, "5": 5}
_NUMBER = re.compile(r"^-?[0-9]+(\.[0-9]+)?$")
_DATE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")


def _bar_order(qtype: str, label: str, count: int) -> tuple[Any, ...]:
    if qtype in ("likert_5", "rating_0_10") and _NUMBER.match(label):
        return (0, float(label), label)
    if qtype in ("numeric", "date"):
        m = re.match(r"^(-?[0-9]+)", label)
        return (0, float(m.group(1)) if m else 0.0, label) if qtype == "numeric" else (0, 0.0, label)
    return (1, -count, label)


def _question_bars(qtype: str, rows: list[dict[str, Any]], themes: dict[str, str]) -> tuple[list[dict[str, Any]], str]:
    """Bars for ONE question. Returns (bars, note). A bar counts distinct responses; HCPs are distinct ids."""
    buckets: dict[str, dict[str, set[str]]] = defaultdict(lambda: {"responses": set(), "hcps": set()})
    note = ""

    numeric_values = [float(r["answer"]) for r in rows if qtype == "numeric" and _NUMBER.match(r["answer"])]
    lo = min(numeric_values) if numeric_values else 0.0
    hi = max(numeric_values) if numeric_values else 0.0
    width = max(1, -(-(int(hi) - int(lo) + 1) // 5)) if numeric_values else 1

    for r in rows:
        answer, rid, hcp = r["answer"], r["responseId"], r["hcp"]
        if rid is None:
            continue
        if not answer:
            labels = ["No response recorded"]
        elif qtype == "open_text":
            labels = [themes.get(rid, OTHER_THEME)]
        elif qtype == "multi_select":
            labels = [part.strip() for part in answer.split(_MULTI_DELIM) if part.strip()] or ["No response recorded"]
        elif qtype == "ranking":
            labels = [f"Ranked first: {answer.split(' > ')[0].strip()}"]
        elif qtype == "numeric" and _NUMBER.match(answer):
            start = int(lo + ((float(answer) - lo) // width) * width)
            labels = [f"{start} to {start + width - 1}"]
        elif qtype == "date" and _DATE.match(answer):
            labels = [answer[:7]]
        else:
            labels = [answer]
        for lab in labels:
            buckets[lab]["responses"].add(rid)
            if hcp:
                buckets[lab]["hcps"].add(hcp)

    if qtype == "open_text":
        note = "Free text is grouped into derived themes by keyword; each response counts in one theme."
    elif qtype == "multi_select":
        note = "Select-all answers: a response counts once for each option chosen, so bars can add up to more than the denominator."
    elif qtype == "ranking":
        note = "Rankings are shown by the option ranked first."
    elif qtype == "numeric":
        note = "Numeric answers are grouped into at most five equal ranges."
    elif qtype == "date":
        note = "Date answers are grouped by month."
    denominator = len({r["responseId"] for r in rows if r["responseId"] is not None})
    bars = [
        {
            "label": lab,
            "responses": len(v["responses"]),
            "distinctHcps": len(v["hcps"]),
            "percentage": round(100.0 * len(v["responses"]) / denominator, 1) if denominator else 0.0,
        }
        for lab, v in buckets.items()
    ]
    bars.sort(key=lambda b: _bar_order(qtype, b["label"], b["responses"]))
    return bars[:12], note


def question_analytics(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    label, _effective = _gate(cur, identity)
    data_through = _data_through(cur)
    frm, to = _window(args, data_through)
    territories = _scope_territories(cur)
    if not territories:
        raise NoScope("no_effective_scope")
    scope_tids = [t["territoryId"] for t in territories]
    where, params = _filter_sql(args, "h", scope_tids)
    params.update({"frm": frm, "to": to})
    question_id = args.get("questionId")
    if question_id not in (None, "") and (not isinstance(question_id, str) or not _QUESTION_ID.match(question_id)):
        raise BadRequest("invalid_question_id")

    cur.execute(
        f"""
        SELECT h.qstn_ext_id, min(h.qstn_txt), min(h.qstn_type), min(h.qstn_pid), min(h.molecule_type),
               count(DISTINCT h.uniq_rspns_id), count(DISTINCT h.cust_mdm_id)
        FROM hcp_raw_insights h
        WHERE h.date_of_interaction BETWEEN %(frm)s AND %(to)s AND h.excluded_rspns_flag IS NOT TRUE
          AND h.qstn_ext_id IS NOT NULL {where}
        GROUP BY h.qstn_ext_id ORDER BY count(DISTINCT h.uniq_rspns_id) DESC, h.qstn_ext_id LIMIT 500
        """,
        params,
    )
    options = [
        {
            "questionId": qid,
            "questionText": text or qid,
            "questionType": qtype,
            "parentQuestionId": pid,
            "molecule": molecule,
            "responses": int(n),
            "distinctHcps": int(hcps),
        }
        for qid, text, qtype, pid, molecule, n, hcps in cur.fetchall()
    ]
    base = {
        "scopeLabel": label,
        "definitionVersion": DEFINITION_VERSION,
        "from": frm.isoformat(),
        "to": to.isoformat(),
        "dataThrough": data_through.isoformat() if data_through else None,
        "options": options,
    }
    if not options:
        return {**base, "selected": None}
    chosen = question_id or options[0]["questionId"]
    option = next((o for o in options if o["questionId"] == chosen), None)
    if option is None:
        # Not answered in scope and window. Same answer for out-of-scope and nonexistent questions.
        return {**base, "selected": None}

    cur.execute(
        f"""
        SELECT h.uniq_rspns_id, btrim(h.rspns_txt), h.cust_mdm_id, h.territory_id, h.insight_intrctn_dtl_sfdc_id
        FROM hcp_raw_insights h
        WHERE h.qstn_ext_id = %(qid)s AND h.date_of_interaction BETWEEN %(frm)s AND %(to)s
          AND h.excluded_rspns_flag IS NOT TRUE {where}
        """,
        {**params, "qid": chosen},
    )
    rows = [
        {"responseId": rid, "answer": ans or "", "hcp": hcp, "territory": terr, "interaction": inter}
        for rid, ans, hcp, terr, inter in cur.fetchall()
    ]
    cur.execute(
        f"""
        SELECT DISTINCT h.uniq_rspns_id, app.theme_of(h.rspns_txt) FROM hcp_raw_insights h
        WHERE h.qstn_ext_id = %(qid)s AND h.date_of_interaction BETWEEN %(frm)s AND %(to)s
          AND h.excluded_rspns_flag IS NOT TRUE AND h.uniq_rspns_id IS NOT NULL {where}
        """,
        {**params, "qid": chosen},
    )
    themes = {rid: theme for rid, theme in cur.fetchall()}
    qtype = option["questionType"] or "single_choice"
    bars, note = _question_bars(qtype, rows, themes)

    per_territory: dict[str, dict[str, set[str]]] = defaultdict(lambda: {"responses": set(), "hcps": set()})
    for r in rows:
        if r["responseId"] is None:
            continue
        per_territory[r["territory"]]["responses"].add(r["responseId"])
        if r["hcp"]:
            per_territory[r["territory"]]["hcps"].add(r["hcp"])
    territories = sorted(
        ({"territoryId": t, "responses": len(v["responses"]), "distinctHcps": len(v["hcps"])} for t, v in per_territory.items()),
        key=lambda x: (-x["responses"], x["territoryId"]),
    )

    summary: dict[str, Any] | None = None
    if qtype in ("likert_5", "rating_0_10", "numeric"):
        values = sorted(float(r["answer"]) for r in rows if _NUMBER.match(r["answer"]))
        if values:
            summary = {"min": values[0], "median": statistics.median(values), "max": values[-1], "answered": len(values)}

    where_c, _ = _filter_sql(args, "c", scope_tids)
    parent = _parent_context(cur, chosen, option.get("parentQuestionId"), where, where_c, params)
    cur.execute(
        f"""
        SELECT h.qstn_ext_id, min(h.qstn_txt), count(DISTINCT h.uniq_rspns_id)
        FROM hcp_raw_insights h
        WHERE h.qstn_pid = %(qid)s AND h.date_of_interaction BETWEEN %(frm)s AND %(to)s
          AND h.excluded_rspns_flag IS NOT TRUE {where}
        GROUP BY h.qstn_ext_id ORDER BY 3 DESC, 1 LIMIT 10
        """,
        {**params, "qid": chosen},
    )
    follow_ups = [{"questionId": qid, "questionText": text or qid, "responses": int(n)} for qid, text, n in cur.fetchall()]

    cur.execute(
        "SELECT qstn_tag_status, tumor_type, survey_type, study_name FROM question_tag WHERE qstn_ext_id = %s ORDER BY qstn_tag_status LIMIT 1",
        (chosen,),
    )
    catalog = cur.fetchone()
    log.info(
        "question analytics computed",
        operation="question_analytics",
        user_id=user_id,
        count=len(bars),
        range_days=(to - frm).days + 1,
    )
    return {
        **base,
        "selected": {
            **option,
            "denominator": option["responses"],
            "bars": bars,
            "barNote": note,
            "territories": territories[:30],
            "numericSummary": summary,
            "parent": parent,
            "followUps": follow_ups,
            "catalog": (
                {"status": catalog[0], "tumorType": catalog[1], "survey": catalog[2], "study": catalog[3]} if catalog else None
            ),
        },
    }


def _parent_context(
    cur: psycopg.Cursor, question_id: str, parent_id: str | None, where: str, where_c: str, params: Mapping[str, Any]
) -> dict[str, Any] | None:
    """The parent question and, inside the same interactions only, how its answers split."""
    if not parent_id:
        return None
    cur.execute("SELECT qstn_txt FROM question_tag WHERE qstn_ext_id = %s LIMIT 1", (parent_id,))
    in_catalog = cur.fetchone()
    cur.execute(
        f"""
        SELECT min(h.qstn_txt), min(h.qstn_type) FROM hcp_raw_insights h WHERE h.qstn_ext_id = %(pid)s {where}
        """,
        {**params, "pid": parent_id},
    )
    seen_text, parent_type = cur.fetchone()
    text = (in_catalog[0] if in_catalog else None) or seen_text
    breakdown: list[dict[str, Any]] = []
    if seen_text is not None:
        cur.execute(
            f"""
            SELECT btrim(p.rspns_txt), count(DISTINCT p.uniq_rspns_id)
            FROM hcp_raw_insights c
            JOIN hcp_raw_insights p ON p.insight_intrctn_dtl_sfdc_id = c.insight_intrctn_dtl_sfdc_id
                                   AND p.qstn_ext_id = c.qstn_pid
            WHERE c.qstn_ext_id = %(qid)s AND c.date_of_interaction BETWEEN %(frm)s AND %(to)s
              AND c.excluded_rspns_flag IS NOT TRUE AND p.excluded_rspns_flag IS NOT TRUE
              AND nullif(btrim(p.rspns_txt), '') IS NOT NULL
              {where_c}
            GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 200
            """,
            {**params, "qid": question_id},
        )
        rows = [(a, int(n)) for a, n in cur.fetchall()]
        if parent_type == "multi_select":
            # A select-all answer counts once for each option chosen, as it does on its own question.
            exploded: dict[str, int] = defaultdict(int)
            for answer, n in rows:
                for part in answer.split(_MULTI_DELIM):
                    if part.strip():
                        exploded[part.strip()] += n
            rows = sorted(exploded.items(), key=lambda item: (-item[1], item[0]))[:8]
        breakdown = [{"answer": a, "responses": n} for a, n in rows]
    return {
        "questionId": parent_id,
        "questionText": text,
        "questionType": parent_type,
        "inCatalog": in_catalog is not None,
        "answerBreakdown": breakdown,
        "note": (
            "Parent answers come only from the same interactions as this follow-up."
            if in_catalog is not None or seen_text is not None
            else "This question names a parent that is not in the catalog, so its answers cannot be read in parent context."
        ),
    }


# --------------------------------------------------------------------------------------------------
# Drill-down: region -> territory -> permitted HCP (interaction and response detail: hcpTimeline)
# --------------------------------------------------------------------------------------------------
LEVELS = ("ROOT", "REGION", "TERRITORY")


def _territory_metrics_light(cur: psycopg.Cursor, tids: list[str], frm: dt.date, to: dt.date) -> dict[str, dict[str, int]]:
    cur.execute(
        """
        SELECT territory_id, count(DISTINCT crm_call_id), count(DISTINCT cust_mdm_id)
        FROM call_activity WHERE call_dt BETWEEN %(frm)s AND %(to)s AND territory_id = ANY(%(tids)s) GROUP BY 1
        """,
        {"frm": frm, "to": to, "tids": tids},
    )
    out = {t: {"distinctCalls": 0, "distinctEngagedHcps": 0, "responses": 0} for t in tids}
    for tid, calls, hcps in cur.fetchall():
        out[tid].update({"distinctCalls": int(calls), "distinctEngagedHcps": int(hcps)})
    cur.execute(
        """
        SELECT territory_id, count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights
        WHERE date_of_interaction BETWEEN %(frm)s AND %(to)s AND excluded_rspns_flag IS NOT TRUE AND territory_id = ANY(%(tids)s)
        GROUP BY 1
        """,
        {"frm": frm, "to": to, "tids": tids},
    )
    for tid, n in cur.fetchall():
        out[tid]["responses"] = int(n)
    return out


def director_drilldown(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    label, _effective = _gate(cur, identity)
    data_through = _data_through(cur)
    frm, to = _window(args, data_through)
    level = args.get("level") or "ROOT"
    if level not in LEVELS:
        raise BadRequest("invalid_level")
    node_id = args.get("id")
    if level != "ROOT" and (not isinstance(node_id, str) or not _ENTITY_ID.match(node_id)):
        raise BadRequest("invalid_id")
    territories = _scope_territories(cur)  # RLS: only approved descendant territories exist here.
    if not territories:
        raise NoScope("no_effective_scope")
    by_id = {t["territoryId"]: t for t in territories}
    metrics = _territory_metrics_light(cur, list(by_id), frm, to)
    breadcrumb: list[dict[str, str]] = [{"level": "ROOT", "id": "", "label": label}]
    children: list[dict[str, Any]] = []
    total_children = 0

    if level == "ROOT":
        regions: dict[str, dict[str, Any]] = {}
        for t in territories:
            key = t["regionId"] or "UNASSIGNED"
            r = regions.setdefault(key, {"id": key, "label": t["regionName"] or key, "territories": []})
            r["territories"].append(t["territoryId"])
        cur.execute(
            """
            SELECT territory_id, cust_mdm_id FROM call_activity
            WHERE call_dt BETWEEN %(frm)s AND %(to)s AND territory_id = ANY(%(tids)s) AND cust_mdm_id IS NOT NULL
            GROUP BY 1, 2
            """,
            {"frm": frm, "to": to, "tids": list(by_id)},
        )
        hcps_by_territory: dict[str, set[str]] = defaultdict(set)
        for tid, hcp in cur.fetchall():
            hcps_by_territory[tid].add(hcp)
        for key in sorted(regions):
            r = regions[key]
            distinct_hcps: set[str] = set()
            for tid in r["territories"]:
                distinct_hcps |= hcps_by_territory.get(tid, set())
            children.append(
                {
                    "id": key,
                    "label": r["label"],
                    "level": "REGION",
                    "childLabel": "territories",
                    "childCount": len(r["territories"]),
                    "distinctCalls": sum(metrics[t]["distinctCalls"] for t in r["territories"]),
                    "distinctEngagedHcps": len(distinct_hcps),
                    "responses": sum(metrics[t]["responses"] for t in r["territories"]),
                    "lastInteractionDate": None,
                }
            )
        total_children = len(children)
    elif level == "REGION":
        members = [t for t in territories if (t["regionId"] or "UNASSIGNED") == node_id]
        if not members:
            raise Forbidden("not_in_scope")  # same answer for a region that is outside scope and one that does not exist
        breadcrumb.append({"level": "REGION", "id": node_id, "label": members[0]["regionName"] or node_id})
        for t in members:
            m = metrics[t["territoryId"]]
            children.append(
                {
                    "id": t["territoryId"],
                    "label": f"{t['territoryId']} · {t['name']}" if t["name"] else t["territoryId"],
                    "level": "TERRITORY",
                    "childLabel": "HCPs",
                    "childCount": m["distinctEngagedHcps"],
                    "distinctCalls": m["distinctCalls"],
                    "distinctEngagedHcps": m["distinctEngagedHcps"],
                    "responses": m["responses"],
                    "lastInteractionDate": None,
                }
            )
        total_children = len(children)
    else:
        territory = by_id.get(node_id)
        if territory is None:
            raise Forbidden("not_in_scope")
        breadcrumb.append({"level": "REGION", "id": territory["regionId"] or "UNASSIGNED", "label": territory["regionName"] or territory["regionId"]})
        breadcrumb.append({"level": "TERRITORY", "id": node_id, "label": territory["name"] or node_id})
        cur.execute(
            """
            WITH calls AS (
              SELECT x.hcp_id, count(DISTINCT c.crm_call_id) AS calls, max(c.call_dt) AS last_call, min(c.cust_full_nm) AS name
              FROM call_activity c
              JOIN hcp_identifier_crosswalk x ON x.source_system = 'call_activity.cust_mdm_id' AND x.source_identifier = c.cust_mdm_id
              WHERE c.territory_id = %(tid)s AND c.call_dt BETWEEN %(frm)s AND %(to)s
              GROUP BY x.hcp_id
            ), resp AS (
              SELECT x.hcp_id, count(DISTINCT i.uniq_rspns_id) AS responses, max(i.date_of_interaction) AS last_resp, min(i.cust_nm) AS name
              FROM hcp_raw_insights i
              JOIN hcp_identifier_crosswalk x ON x.source_system = 'hcp_raw_insights.cust_mdm_id' AND x.source_identifier = i.cust_mdm_id
              WHERE i.territory_id = %(tid)s AND i.date_of_interaction BETWEEN %(frm)s AND %(to)s AND i.excluded_rspns_flag IS NOT TRUE
              GROUP BY x.hcp_id
            )
            SELECT coalesce(c.hcp_id, r.hcp_id), coalesce(c.name, r.name), coalesce(c.calls, 0), coalesce(r.responses, 0),
                   greatest(c.last_call, r.last_resp), count(*) OVER ()
            FROM calls c FULL JOIN resp r ON r.hcp_id = c.hcp_id
            ORDER BY coalesce(c.calls, 0) + coalesce(r.responses, 0) DESC, coalesce(c.hcp_id, r.hcp_id)
            LIMIT %(limit)s
            """,
            {"tid": node_id, "frm": frm, "to": to, "limit": MAX_DRILL_HCPS},
        )
        for hcp_id, name, calls, responses, last, total in cur.fetchall():
            total_children = int(total)
            children.append(
                {
                    "id": hcp_id,
                    "label": name or hcp_id,
                    "level": "HCP",
                    "childLabel": "interactions",
                    "childCount": int(calls),
                    "distinctCalls": int(calls),
                    "distinctEngagedHcps": 1,
                    "responses": int(responses),
                    "lastInteractionDate": last.isoformat() if last else None,
                }
            )
    log.info(
        "director drilldown",
        operation="director_drilldown",
        user_id=user_id,
        count=len(children),
        range_days=(to - frm).days + 1,
    )
    return {
        "level": level,
        "id": node_id or "",
        "scopeLabel": label,
        "from": frm.isoformat(),
        "to": to.isoformat(),
        "dataThrough": data_through.isoformat() if data_through else None,
        "breadcrumb": breadcrumb,
        "children": children,
        "totalChildren": total_children,
        "truncated": total_children > len(children),
        "note": "Only regions, territories and HCPs inside your approved scope are listed. Interaction and response detail opens from an HCP.",
    }


# --------------------------------------------------------------------------------------------------
# Exceptions: data problems visible inside the caller's scope
# --------------------------------------------------------------------------------------------------
CATEGORIES = {
    "STALE_LOAD": "Stale or failed load",
    "MISSING_JOIN": "Missing join",
    "UNRESOLVED_IDENTITY": "Unresolved identity",
    "DUPLICATE_KEY": "Duplicate key",
    "STATUS_DIFFERENCE": "Status difference",
    "MISSING_REPORTING": "Missing reporting",
}
RULES = {
    "STALE_LOAD": "A source whose latest completed load is more than 30 days old, whose latest attempt failed, or that has no recorded load.",
    "MISSING_JOIN": "Responses whose parent question is not in the catalog, and call-feed team members that match no roster member in scope.",
    "UNRESOLVED_IDENTITY": "Roster rows that share one login email, so the login cannot be matched to a single person, and HCP identifiers with no canonical HCP.",
    "DUPLICATE_KEY": "Responses sharing one response key (uniq_rspns_id).",
    "STATUS_DIFFERENCE": "Responses whose recorded question status differs from the catalog's status for that question.",
    "MISSING_REPORTING": "Territory-months that data has reached with no recorded call.",
}


def _row(
    cid: str,
    category: str,
    severity: str,
    title: str,
    detail: str,
    *,
    territory: str | None = None,
    count: int = 0,
    table: str = "",
    ids: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "exceptionId": cid,
        "category": category,
        "categoryLabel": CATEGORIES[category],
        "severity": severity,
        "title": title,
        "detail": detail,
        "territoryId": territory,
        "affectedCount": count,
        "sourceTable": table,
        "sampleRecordIds": (ids or [])[:MAX_SAMPLE_IDS],
        "rule": RULES[category],
    }


def director_exceptions(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    label, _effective = _gate(cur, identity)
    data_through = _data_through(cur)
    frm, to = _window(args, data_through)
    territories = _scope_territories(cur)
    if not territories:
        raise NoScope("no_effective_scope")
    tids = [t["territoryId"] for t in territories]
    out: list[dict[str, Any]] = []

    # Stale or failed loads (the only administrator table a Director reads, through a narrow function).
    cur.execute("SELECT source_id, source_name, last_status, last_completed_at, load_state FROM app.source_load_status()")
    for source_id, name, last_status, completed, state in cur.fetchall():
        if state == "current":
            continue
        when = completed.date().isoformat() if completed else None
        detail = {
            "stale": f"The latest completed load was on {when}, more than 30 days ago, so this source may be missing recent records.",
            "failed": "The latest load attempt failed. Records from this source may be incomplete or out of date."
            + (f" The last successful load was on {when}." if when else " No successful load is recorded."),
            "never_loaded": "No load is recorded for this source, so its freshness cannot be confirmed.",
        }.get(state, "")
        out.append(_row(f"load:{source_id}", "STALE_LOAD", "high" if state != "never_loaded" else "medium", f"{name}: {state.replace('_', ' ')}", detail, count=0, table="data_sources", ids=[source_id]))

    # Duplicate response keys visible in scope.
    cur.execute(
        """
        SELECT uniq_rspns_id, array_agg(DISTINCT territory_id ORDER BY territory_id), count(*)
        FROM hcp_raw_insights WHERE uniq_rspns_id IS NOT NULL AND territory_id = ANY(%s)
        GROUP BY 1 HAVING count(*) > 1 ORDER BY 1
        """,
        (tids,),
    )
    for key, terrs, n in cur.fetchall():
        out.append(_row(f"dup:{key}", "DUPLICATE_KEY", "high", f"Response key {key} appears {int(n)} times", "Two or more response rows share this key, so response counts use distinct keys and the rows need reconciling at source.", territory=terrs[0] if len(terrs) == 1 else None, count=int(n), table="hcp_raw_insights", ids=[key]))

    # Orphan parent: follow-up responses whose parent question is not in the catalog.
    cur.execute(
        """
        SELECT h.territory_id, h.qstn_pid, count(DISTINCT h.uniq_rspns_id), (array_agg(DISTINCT h.uniq_rspns_id))[1:5]
        FROM hcp_raw_insights h
        WHERE h.qstn_pid IS NOT NULL AND h.territory_id = ANY(%s) AND h.excluded_rspns_flag IS NOT TRUE
          AND NOT EXISTS (SELECT 1 FROM question_tag q WHERE q.qstn_ext_id = h.qstn_pid)
        GROUP BY 1, 2 ORDER BY 1, 2
        """,
        (tids,),
    )
    for tid, parent, n, ids in cur.fetchall():
        out.append(_row(f"orphan:{tid}:{parent}", "MISSING_JOIN", "high", f"Parent question {parent} is not in the catalog", "These follow-up responses cannot be read in their parent question's context, because the parent question has no catalog entry.", territory=tid, count=int(n), table="hcp_raw_insights", ids=[i for i in ids if i]))

    # Call-feed team members with no roster match.
    cur.execute(
        """
        SELECT c.territory_id, count(DISTINCT c.crm_call_user_id), count(DISTINCT c.crm_call_id), (array_agg(DISTINCT c.crm_call_user_id))[1:5]
        FROM call_activity c
        WHERE c.territory_id = ANY(%s) AND c.crm_call_user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM medical_roster r WHERE r.vva_user_id = c.crm_call_user_id OR r.sfdc_submitter_id = c.crm_call_user_id)
        GROUP BY 1 ORDER BY 1
        """,
        (tids,),
    )
    for tid, users, calls, ids in cur.fetchall():
        out.append(_row(f"roster-join:{tid}", "MISSING_JOIN", "medium", f"{int(users)} call-feed team member id(s) match no roster member in your scope", f"{int(calls)} calls carry a team member id that is not on the medical roster rows you can see, so completeness per person cannot be attributed. Nobody is marked as not reporting because of this.", territory=tid, count=int(users), table="call_activity", ids=list(ids)))

    # HCP identifiers with no canonical HCP.
    cur.execute(
        """
        SELECT 'call_activity', count(DISTINCT c.cust_mdm_id), (array_agg(DISTINCT c.cust_mdm_id))[1:5]
        FROM call_activity c WHERE c.territory_id = ANY(%(t)s) AND c.cust_mdm_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM hcp_identifier_crosswalk x WHERE x.source_system = 'call_activity.cust_mdm_id' AND x.source_identifier = c.cust_mdm_id)
        UNION ALL
        SELECT 'hcp_raw_insights', count(DISTINCT i.cust_mdm_id), (array_agg(DISTINCT i.cust_mdm_id))[1:5]
        FROM hcp_raw_insights i WHERE i.territory_id = ANY(%(t)s) AND i.cust_mdm_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM hcp_identifier_crosswalk x WHERE x.source_system = 'hcp_raw_insights.cust_mdm_id' AND x.source_identifier = i.cust_mdm_id)
        """,
        {"t": tids},
    )
    for table, n, ids in cur.fetchall():
        if int(n):
            out.append(_row(f"hcp-identity:{table}", "UNRESOLVED_IDENTITY", "high", f"{int(n)} HCP identifier(s) in {table} have no canonical HCP", "These records cannot be joined to one HCP, so they are left out of HCP-level views.", count=int(n), table=table, ids=list(ids)))

    # Roster rows sharing one login email.
    cur.execute(
        """
        SELECT territory_id, count(*), array_agg(source_row_id::text ORDER BY source_row_id)
        FROM medical_roster r
        WHERE r.territory_id = ANY(%s) AND r.email_id IS NOT NULL
          AND (SELECT count(*) FROM medical_roster o WHERE o.email_id = r.email_id) > 1
        GROUP BY territory_id, lower(email_id) ORDER BY 1
        """,
        (tids,),
    )
    for tid, n, ids in cur.fetchall():
        out.append(_row(f"roster-email:{tid}:{ids[0]}", "UNRESOLVED_IDENTITY", "high", f"{int(n)} roster rows share one login email", "The login cannot be matched to a single roster member until an administrator resolves which row is correct. Nothing is joined by guess.", territory=tid, count=int(n), table="medical_roster", ids=list(ids)))

    # Recorded question status differs from the catalog.
    cur.execute(
        """
        SELECT h.territory_id, count(DISTINCT h.uniq_rspns_id), count(DISTINCT h.qstn_ext_id), (array_agg(DISTINCT h.qstn_ext_id))[1:5],
               min(h.qstn_tag_status), min(q.qstn_tag_status)
        FROM hcp_raw_insights h
        JOIN (SELECT qstn_ext_id, min(qstn_tag_status) AS qstn_tag_status FROM question_tag GROUP BY qstn_ext_id) q ON q.qstn_ext_id = h.qstn_ext_id
        WHERE h.territory_id = ANY(%s) AND h.qstn_tag_status IS DISTINCT FROM q.qstn_tag_status
        GROUP BY 1 ORDER BY 1
        """,
        (tids,),
    )
    for tid, n, questions, ids, recorded, catalog in cur.fetchall():
        out.append(_row(f"status:{tid}", "STATUS_DIFFERENCE", "medium", f"{int(n)} responses carry a question status that differs from the catalog", f"Responses record status “{recorded}” for {int(questions)} question(s) the catalog lists as “{catalog}”. Both values are kept; an administrator reconciles them.", territory=tid, count=int(n), table="hcp_raw_insights", ids=list(ids)))

    # Territory-months with no recorded call.
    through_day = _as_date(data_through)
    months = _window_months(frm, to, through_day)
    if months:
        cur.execute(
            """
            SELECT territory_id, date_trunc('month', call_dt)::date FROM call_activity
            WHERE call_dt BETWEEN %(frm)s AND %(to)s AND territory_id = ANY(%(t)s) GROUP BY 1, 2
            """,
            {"frm": frm, "to": to, "t": tids},
        )
        reported = {(t, m) for t, m in cur.fetchall()}
        for tid in tids:
            missing = [m["month"] for m in months if not m["isPartial"] and (tid, m["month"]) not in reported]
            if missing:
                out.append(_row(f"reporting:{tid}", "MISSING_REPORTING", "medium", f"No recorded calls in {len(missing)} full month(s)", "Months that data has reached with no call recorded for this territory: " + ", ".join(m.isoformat()[:7] for m in missing[:6]) + ".", territory=tid, count=len(missing), table="call_activity", ids=[m.isoformat()[:7] for m in missing]))

    severity_rank = {"high": 0, "medium": 1, "low": 2}
    out.sort(key=lambda r: (severity_rank.get(r["severity"], 3), r["category"], r["territoryId"] or "", r["exceptionId"]))
    counts: dict[str, int] = defaultdict(int)
    for r in out:
        counts[r["category"]] += 1
    log.info("director exceptions computed", operation="director_exceptions", user_id=user_id, count=len(out), territory_count=len(tids))
    return {
        "scopeLabel": label,
        "from": frm.isoformat(),
        "to": to.isoformat(),
        "dataThrough": data_through.isoformat() if data_through else None,
        "definitionVersion": DEFINITION_VERSION,
        "categories": [{"category": k, "label": v, "rule": RULES[k], "count": counts.get(k, 0)} for k, v in CATEGORIES.items()],
        "exceptions": out,
        "note": "Detected by fixed rules over the records in your scope. A finding says a join or load is missing, never that a person did something wrong.",
    }


# --------------------------------------------------------------------------------------------------
# Territory summary evidence (the facts the AI summary is written from)
# --------------------------------------------------------------------------------------------------
def territory_summary_evidence(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    label, _effective = _gate(cur, identity)
    data_through = _data_through(cur)
    frm, to = _window(args, data_through)
    territories = _scope_territories(cur)
    if not territories:
        raise NoScope("no_effective_scope")
    by_id = {t["territoryId"]: t for t in territories}
    metrics = _territory_metrics_light(cur, list(by_id), frm, to)
    rows = trend_rows(cur, frm, to, " AND h.territory_id = ANY(%(tids)s)", {"tids": list(by_id)}, by_territory=True)
    per_territory: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        per_territory[r["territoryId"]].append(r)

    cards: list[dict[str, Any]] = []
    for tid, t in by_id.items():
        trends = per_territory.get(tid, [])
        top = sorted((r for r in trends if r["topic"] != OTHER_THEME), key=lambda r: (-r["currentResponses"], r["topic"]))[:3]
        flagged = [r for r in trends if r["status"] in ("EMERGING", "DECLINING")]
        themes = []
        for r in top:
            cur.execute(
                """
                SELECT h.uniq_rspns_id, h.rspns_txt, h.qstn_txt, h.date_of_interaction, h.territory_id
                FROM hcp_raw_insights h
                WHERE h.qstn_type = 'open_text' AND h.excluded_rspns_flag IS NOT TRUE AND h.territory_id = %(tid)s
                  AND h.date_of_interaction BETWEEN %(frm)s AND %(to)s AND app.theme_of(h.rspns_txt) = %(topic)s
                  AND h.uniq_rspns_id IS NOT NULL
                ORDER BY h.date_of_interaction DESC, h.uniq_rspns_id LIMIT 3
                """,
                {"tid": tid, "frm": frm, "to": to, "topic": r["topic"]},
            )
            themes.append({**r, "evidence": _evidence(cur.fetchall())[:1]})
        m = metrics[tid]
        cards.append(
            {
                "territoryId": tid,
                "name": t["name"],
                "regionId": t["regionId"],
                "regionName": t["regionName"],
                "distinctCalls": m["distinctCalls"],
                "distinctEngagedHcps": m["distinctEngagedHcps"],
                "responses": m["responses"],
                "freeTextResponses": trends[0]["currentTotal"] if trends else 0,
                "priorFreeTextResponses": trends[0]["priorTotal"] if trends else 0,
                "topThemes": themes,
                "flagged": [{"topic": r["topic"], "status": r["status"], "currentResponses": r["currentResponses"], "priorResponses": r["priorResponses"]} for r in flagged],
            }
        )
    cards.sort(key=lambda c: (-len(c["flagged"]), -c["responses"], c["territoryId"]))
    pfrm, pto = _prior_window(frm, to)
    log.info("territory summary evidence computed", operation="territory_summary_evidence", user_id=user_id, territory_count=len(cards), range_days=(to - frm).days + 1)
    return {
        "scopeLabel": label,
        "definitionVersion": DEFINITION_VERSION,
        "from": frm.isoformat(),
        "to": to.isoformat(),
        "priorFrom": pfrm.isoformat(),
        "priorTo": pto.isoformat(),
        "dataThrough": data_through.isoformat() if data_through else None,
        "territories": cards,
        "note": "These are the source figures and cited responses a summary is written from. The summary text itself is generated by AI.",
    }


__all__ = [
    "DEFAULT_WINDOW_DAYS",
    "MAX_WINDOW_DAYS",
    "director_drilldown",
    "director_exceptions",
    "emerging_topics",
    "question_analytics",
    "territory_summary_evidence",
    "topic_heatmap",
    "trend_rows",
]
