"""Deterministic aggregate queries behind chat visuals.

Every number a chart shows is produced here, by SQL running as ``app_user`` under the caller's RLS session
(see ``repository.py``); the model only chooses *which* of these queries to run, from a closed vocabulary.
Nothing the model sends is interpolated into SQL: metric, grouping and answer type are looked up in the
whitelists below, and dates, territory, product and topic are bound parameters.

Metric definitions match ``PostgresScopedRepository.activity_summary`` and the BE API resolvers: calls count
distinct ``crm_call_id`` (it repeats per product row), engaged HCPs distinct ``cust_mdm_id``, responses distinct
non-excluded ``uniq_rspns_id``.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Literal

import psycopg

Metric = Literal["calls", "engaged_hcps", "responses"]
GroupBy = Literal["day", "week", "month", "territory", "product", "call_type", "question_type", "program"]
AnswerType = Literal["likert_5", "rating_0_10", "yes_no", "single_choice"]

METRICS: tuple[str, ...] = ("calls", "engaged_hcps", "responses")
TIME_DIMS = ("day", "week", "month")
DEFAULT_DAYS = 90
MAX_BARS = 10
MAX_ROWS = 12
MAX_TIMELINE_POINTS = 62
MAX_HEATMAP_MONTHS = 13
MAX_TABLE_BUCKETS = 16
MAX_SERIES_BUCKETS = 160

METRIC_LABELS = {"calls": "Distinct calls", "engaged_hcps": "Engaged HCPs", "responses": "Insight responses"}
METRIC_UNITS = {"calls": "calls", "engaged_hcps": "HCPs", "responses": "responses"}
METRIC_DEFINITIONS = {
    "calls": "Distinct calls: each call counted once, however many products it covered.",
    "engaged_hcps": "Engaged HCPs: each HCP counted once per group, across the calls in the period.",
    "responses": "Insight responses: each recorded response counted once; excluded responses left out.",
}
GROUP_LABELS = {
    "day": "day",
    "week": "week",
    "month": "month",
    "territory": "territory",
    "product": "product",
    "call_type": "call type",
    "question_type": "answer type",
    "program": "program",
}


@dataclass(frozen=True)
class _Source:
    table: str
    date_col: str
    count_expr: str
    base_filter: str
    dims: dict[str, str]  # group name -> SQL expression (constants from this module, never user input)


_CALLS = {
    "territory": "territory_id",
    "product": "prd_nm",
    "call_type": "call_type",
}
_SOURCES: dict[str, _Source] = {
    "calls": _Source("call_activity", "call_dt", "count(DISTINCT crm_call_id)", "TRUE", _CALLS),
    "engaged_hcps": _Source("call_activity", "call_dt", "count(DISTINCT cust_mdm_id)", "TRUE", _CALLS),
    "responses": _Source(
        "hcp_raw_insights",
        "date_of_interaction",
        "count(DISTINCT uniq_rspns_id)",
        "excluded_rspns_flag IS NOT TRUE",
        {
            "territory": "territory_id",
            "product": "molecule_type",
            "question_type": "qstn_type",
            "program": "survey_type",
        },
    ),
}
_PRODUCT_COL = {"call_activity": "prd_nm", "hcp_raw_insights": "molecule_type"}
_TOPIC_FILTER = """(qstn_txt ILIKE %(like)s ESCAPE '\\' OR rspns_txt ILIKE %(like)s ESCAPE '\\'
    OR molecule_type ILIKE %(like)s ESCAPE '\\' OR landscape_type ILIKE %(like)s ESCAPE '\\'
    OR study_name ILIKE %(like)s ESCAPE '\\' OR survey_type ILIKE %(like)s ESCAPE '\\')"""

_BUCKET_SQL = {
    "day": "to_char({d}, 'YYYY-MM-DD')",
    "week": "to_char(date_trunc('week', {d}::timestamp)::date, 'YYYY-MM-DD')",
    "month": "to_char(date_trunc('month', {d}::timestamp)::date, 'YYYY-MM')",
}


@dataclass(frozen=True)
class SeriesRow:
    key: str
    label: str
    value: int


@dataclass(frozen=True)
class Matrix:
    columns: tuple[str, ...]
    rows: tuple[tuple[str, tuple[int, ...]], ...]  # (row label, one value per column)


@dataclass(frozen=True)
class TableRow:
    label: str
    values: tuple[int, ...]


@dataclass(frozen=True)
class ChartParams:
    metric: str
    group_by: str
    period_from: dt.date
    period_to: dt.date
    territory_id: str | None = None
    product: str | None = None
    topic: str | None = None
    answer_type: str | None = None


def is_valid_pair(metric: str, group_by: str) -> bool:
    if metric not in _SOURCES:
        return False
    return group_by in TIME_DIMS or group_by in _SOURCES[metric].dims


def _like(text: str) -> str:
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _where(metric: str, p: ChartParams) -> tuple[str, dict[str, object]]:
    src = _SOURCES[metric]
    clauses = [f"{src.date_col} BETWEEN %(frm)s AND %(to)s", src.base_filter]
    params: dict[str, object] = {"frm": p.period_from, "to": p.period_to}
    if p.territory_id:
        clauses.append("territory_id = %(territory)s")
        params["territory"] = p.territory_id
    if p.product:
        clauses.append(f"{_PRODUCT_COL[src.table]} ILIKE %(product_like)s ESCAPE '\\'")
        params["product_like"] = _like(p.product)
    if p.topic and src.table == "hcp_raw_insights":
        clauses.append(_TOPIC_FILTER)
        params["like"] = _like(p.topic)
    return " AND ".join(clauses), params


def _expr(metric: str, group_by: str) -> str:
    src = _SOURCES[metric]
    if group_by in TIME_DIMS:
        return _BUCKET_SQL[group_by].format(d=src.date_col)
    return f"coalesce({src.dims[group_by]}, 'Not recorded')"


def month_starts(start: dt.date, end: dt.date) -> list[str]:
    out, cursor = [], dt.date(start.year, start.month, 1)
    while cursor <= end:
        out.append(cursor.strftime("%Y-%m"))
        cursor = dt.date(cursor.year + (cursor.month == 12), cursor.month % 12 + 1, 1)
    return out


def week_starts(start: dt.date, end: dt.date) -> list[str]:
    cursor = start - dt.timedelta(days=start.weekday())
    out = []
    while cursor <= end:
        out.append(cursor.isoformat())
        cursor += dt.timedelta(days=7)
    return out


def day_list(start: dt.date, end: dt.date) -> list[str]:
    return [(start + dt.timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]


def buckets(group_by: str, start: dt.date, end: dt.date) -> list[str]:
    return {"month": month_starts, "week": week_starts, "day": day_list}[group_by](start, end)


def bucket_count(group_by: str, start: dt.date, end: dt.date) -> int:
    return len(buckets(group_by, start, end))


def fits(shape: str, group_by: str, start: dt.date, end: dt.date) -> bool:
    """A chart the interface can draw legibly: a heatmap has at most a year of month columns, a table a page of rows."""
    if shape == "matrix":
        return len(month_starts(start, end)) <= MAX_HEATMAP_MONTHS
    if group_by in TIME_DIMS:
        limit = {"table": MAX_TABLE_BUCKETS, "series": MAX_SERIES_BUCKETS}.get(shape, MAX_SERIES_BUCKETS)
        if group_by == "day":
            limit = min(limit, MAX_TIMELINE_POINTS)
        return bucket_count(group_by, start, end) <= limit
    return True


def total_count(cur: psycopg.Cursor, p: ChartParams) -> int:
    where, params = _where(p.metric, p)
    src = _SOURCES[p.metric]
    cur.execute(f"SELECT {src.count_expr} FROM {src.table} WHERE {where}", params)
    return int(cur.fetchone()[0])


def run_series(cur: psycopg.Cursor, p: ChartParams) -> tuple[list[SeriesRow], int, int]:
    """Counts per group. Time groups are zero-filled and chronological; others are ranked, top ``MAX_BARS``.

    Returns (rows, total over the whole period, number of groups left out of ``rows``).
    """
    where, params = _where(p.metric, p)
    src = _SOURCES[p.metric]
    expr = _expr(p.metric, p.group_by)
    cur.execute(
        f"SELECT {expr} AS k, {src.count_expr} FROM {src.table} WHERE {where} GROUP BY 1",
        params,
    )
    found = {row[0]: int(row[1]) for row in cur.fetchall()}
    total = total_count(cur, p)
    if p.group_by in TIME_DIMS:
        keys = buckets(p.group_by, p.period_from, p.period_to)
        return [SeriesRow(k, k, found.get(k, 0)) for k in keys], total, 0
    ranked = sorted(found.items(), key=lambda kv: (-kv[1], kv[0]))
    shown = ranked[:MAX_BARS]
    return [SeriesRow(k, k, v) for k, v in shown], total, len(ranked) - len(shown)


def run_matrix(cur: psycopg.Cursor, p: ChartParams) -> tuple[Matrix, int]:
    """Rows (territory or product, ranked by total) by month. Returns (matrix, rows left out)."""
    where, params = _where(p.metric, p)
    src = _SOURCES[p.metric]
    row_expr = _expr(p.metric, p.group_by)
    month_expr = _expr(p.metric, "month")
    cur.execute(
        f"SELECT {row_expr}, {month_expr}, {src.count_expr} FROM {src.table} WHERE {where} GROUP BY 1, 2",
        params,
    )
    cells: dict[str, dict[str, int]] = {}
    for row_key, month, value in cur.fetchall():
        cells.setdefault(row_key, {})[month] = int(value)
    months = month_starts(p.period_from, p.period_to)
    # Rank rows by their distinct count over the whole period (not the sum of cells: HCPs repeat across months).
    cur.execute(
        f"SELECT {row_expr}, {src.count_expr} FROM {src.table} WHERE {where} GROUP BY 1",
        params,
    )
    totals = {k: int(v) for k, v in cur.fetchall()}
    ranked = sorted(totals, key=lambda k: (-totals[k], k))
    shown = ranked[:MAX_ROWS]
    rows = tuple((k, tuple(cells.get(k, {}).get(m, 0) for m in months)) for k in shown)
    return Matrix(tuple(months), rows), len(ranked) - len(shown)


def run_table(cur: psycopg.Cursor, p: ChartParams) -> tuple[list[TableRow], int, int]:
    """Calls, engaged HCPs and responses per group (territory, product, month or week) in one table."""
    metrics = ("calls", "engaged_hcps", "responses")
    per_metric: dict[str, dict[str, int]] = {}
    for metric in metrics:
        sub = ChartParams(
            **{**p.__dict__, "metric": metric, "topic": p.topic if metric == "responses" else None}
        )
        where, params = _where(metric, sub)
        src = _SOURCES[metric]
        expr = _expr(metric, p.group_by)
        cur.execute(f"SELECT {expr}, {src.count_expr} FROM {src.table} WHERE {where} GROUP BY 1", params)
        per_metric[metric] = {k: int(v) for k, v in cur.fetchall()}
    total = total_count(cur, ChartParams(**{**p.__dict__, "metric": "calls", "topic": None}))
    keys = set().union(*(m.keys() for m in per_metric.values()))
    if p.group_by in TIME_DIMS:
        ordered = buckets(p.group_by, p.period_from, p.period_to)
        left_out = 0
    else:
        ordered = sorted(keys, key=lambda k: (-per_metric["calls"].get(k, 0), k))
        left_out = max(0, len(ordered) - MAX_ROWS)
        ordered = ordered[:MAX_ROWS]
    rows = [TableRow(k, tuple(per_metric[m].get(k, 0) for m in metrics)) for k in ordered]
    return rows, total, left_out


_ANSWER_FILTER = {
    "likert_5": "qstn_type = 'likert_5'",
    "rating_0_10": "qstn_type = 'rating_0_10'",
    "yes_no": "qstn_type = 'yes_no'",
    "single_choice": "qstn_type = 'single_choice'",
}
_ANSWER_ORDER = {
    "likert_5": [str(i) for i in range(1, 6)],
    "rating_0_10": [str(i) for i in range(0, 11)],
    "yes_no": ["Yes", "No", "Unsure"],
}


def run_distribution(cur: psycopg.Cursor, p: ChartParams) -> tuple[list[SeriesRow], int]:
    """How often each answer was given, for one answer type (optionally one topic). Returns (rows, total)."""
    answer = p.answer_type or ""
    if answer not in _ANSWER_FILTER:
        raise ValueError("unsupported answer type")
    clauses = [
        "date_of_interaction BETWEEN %(frm)s AND %(to)s",
        "excluded_rspns_flag IS NOT TRUE",
        "uniq_rspns_id IS NOT NULL",
        _ANSWER_FILTER[answer],
    ]
    params: dict[str, object] = {"frm": p.period_from, "to": p.period_to}
    if p.territory_id:
        clauses.append("territory_id = %(territory)s")
        params["territory"] = p.territory_id
    if p.topic:
        clauses.append(_TOPIC_FILTER)
        params["like"] = _like(p.topic)
    where = " AND ".join(clauses)
    cur.execute(
        f"SELECT btrim(rspns_txt), count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE {where} GROUP BY 1",
        params,
    )
    found = {row[0]: int(row[1]) for row in cur.fetchall() if row[0]}
    cur.execute(
        f"SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE {where} AND rspns_txt IS NOT NULL",
        params,
    )
    total = int(cur.fetchone()[0])
    if answer in _ANSWER_ORDER:
        return [SeriesRow(k, k, found.get(k, 0)) for k in _ANSWER_ORDER[answer]], total
    ranked = sorted(found.items(), key=lambda kv: (-kv[1], kv[0]))[:MAX_BARS]
    return [SeriesRow(k, k, v) for k, v in ranked], total
