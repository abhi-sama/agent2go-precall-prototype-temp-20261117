"""Ground truth for the golden questions, recounted in hand-written SQL under the eval subject's own RLS.

Nothing here reads the agent's output or shares code with the agent's queries: the metric definitions are the
governed ones written out again (docs/adr/0003), so a bug in the agent's SQL cannot also hide in the expectation.
``compute_truth`` answers "what should this answer say" for one ``Expectation``; ``recount_visual`` recounts every
number a chat chart plots, so a chart that disagrees with the database is caught whatever the text says.

Every value is bound as a parameter. The only SQL fragments built from names are chosen from the fixed tables below.
"""

from __future__ import annotations

import datetime as dt
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import psycopg

from .eval_suites import Expectation

#: A change smaller than this share of the larger window (and under two units) is "flat", not a trend.
FLAT_SHARE = 0.03


@dataclass
class Truth:
    """What a correct answer says. ``value`` is the number to state; the rest supports directional questions."""

    value: float | None = None
    text: str = ""
    numerator: int | None = None
    denominator: int | None = None
    #: trend: UP, DOWN or FLAT, with both windows' values
    direction: str | None = None
    prior_value: float | None = None
    #: Other figures that are equally right: a topic searched in its singular, plural or one-word form.
    alternatives: list[float] = field(default_factory=list)
    #: leader: the keys sharing the extreme value, and every candidate's value
    leaders: list[str] = field(default_factory=list)
    values: dict[str, float] = field(default_factory=dict)
    extreme: str = "max"

    def as_display(self) -> str:
        return self.text


_CALLS = ("call_activity", "call_dt", "count(DISTINCT crm_call_id)", "TRUE", "prd_nm")
_HCPS = ("call_activity", "call_dt", "count(DISTINCT cust_mdm_id)", "TRUE", "prd_nm")
_RESPONSES = (
    "hcp_raw_insights",
    "date_of_interaction",
    "count(DISTINCT uniq_rspns_id)",
    "excluded_rspns_flag IS NOT TRUE AND uniq_rspns_id IS NOT NULL",
    "molecule_type",
)
_SOURCES: dict[str, tuple[str, str, str, str, str]] = {
    "distinct_calls": _CALLS,
    "engaged_hcps": _HCPS,
    "responses": _RESPONSES,
    "topic_matches": _RESPONSES,
    "question_responses": _RESPONSES,
    "question_hcps": (*_RESPONSES[:2], "count(DISTINCT cust_mdm_id)", *_RESPONSES[3:]),
}
_TOPIC = """(qstn_txt ILIKE %(like)s ESCAPE '\\' OR rspns_txt ILIKE %(like)s ESCAPE '\\'
    OR molecule_type ILIKE %(like)s ESCAPE '\\' OR landscape_type ILIKE %(like)s ESCAPE '\\'
    OR study_name ILIKE %(like)s ESCAPE '\\' OR survey_type ILIKE %(like)s ESCAPE '\\')"""
_GROUPS: dict[str, dict[str, str]] = {
    "distinct_calls": {"territory": "territory_id", "product": "prd_nm", "call_type": "call_type"},
    "engaged_hcps": {"territory": "territory_id", "product": "prd_nm", "call_type": "call_type"},
    "responses": {"territory": "territory_id", "product": "molecule_type", "question_type": "qstn_type", "program": "survey_type"},
}


def _like(text: str) -> str:
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _month_window(key: str, lo: dt.date, hi: dt.date) -> tuple[dt.date, dt.date]:
    first = dt.date.fromisoformat(key + "-01")
    last = (first.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
    return max(first, lo), min(last, hi)


def _months(lo: dt.date, hi: dt.date) -> list[str]:
    out, cur = [], lo.replace(day=1)
    while cur <= hi:
        out.append(cur.strftime("%Y-%m"))
        cur = (cur.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return out


def count(
    cur: psycopg.Cursor,
    metric: str,
    frm: str | dt.date,
    to: str | dt.date,
    *,
    territory: str | None = None,
    product: str | None = None,
    specialty: str | None = None,
    topic: str | None = None,
    question_id: str | None = None,
    answer: str | None = None,
) -> int:
    """One counted figure for a window, under the cursor's RLS."""
    table, date_col, expr, base, product_col = _SOURCES[metric]
    where = [f"{date_col} BETWEEN %(frm)s AND %(to)s", base]
    params: dict[str, Any] = {"frm": frm, "to": to}
    if territory:
        where.append("territory_id = %(territory)s")
        params["territory"] = territory
    if product:
        where.append(f"{product_col} ILIKE %(product)s ESCAPE '\\'")
        params["product"] = _like(product)
    if specialty and table == "call_activity":
        where.append("cust_sub_typ ILIKE %(specialty)s ESCAPE '\\'")
        params["specialty"] = _like(specialty)
    if table == "hcp_raw_insights":
        if topic:
            where.append(_TOPIC)
            params["like"] = _like(topic)
        if question_id:
            where.append("qstn_ext_id = %(qid)s")
            params["qid"] = question_id
        if answer is not None:
            where.append("btrim(rspns_txt) = %(answer)s")
            params["answer"] = answer
    cur.execute(f"SELECT {expr} FROM {table} WHERE {' AND '.join(where)}", params)
    return int(cur.fetchone()[0])


def _value(cur: psycopg.Cursor, metric: str, frm, to, e: Expectation, **over: Any) -> float:
    """A counted figure for ``metric``, with the expectation's filters, some overridden (a month, a key)."""
    kwargs: dict[str, Any] = {
        "territory": e.territory,
        "product": e.product,
        "specialty": e.specialty,
        "topic": e.topic,
        "question_id": e.question_id,
        "answer": e.answer,
        **over,
    }
    if metric == "answer_share":
        den = count(cur, "question_responses", frm, to, territory=kwargs["territory"], question_id=kwargs["question_id"])
        num = count(cur, "question_responses", frm, to, territory=kwargs["territory"], question_id=kwargs["question_id"], answer=kwargs["answer"])
        return round(100 * num / den, 1) if den else 0.0
    if metric == "topic_matches":
        kwargs["question_id"] = None
        return count(cur, "topic_matches", frm, to, **kwargs)
    return count(cur, metric, frm, to, **kwargs)


def _executive_cells(cur: psycopg.Cursor, frm: str | dt.date, to: str | dt.date) -> list[tuple[Any, ...]]:
    """The independent aggregate recount for Executive chat.

    This uses the same governed security-definer surface as the overview, but does not share the agent's shaping or
    suppression code. It runs as the seeded Executive, so scope remains an effective-dated Executive assignment.
    """
    cur.execute(
        "SELECT level, territory_id, region_id, month, calls, responses, hcps FROM app.exec_cells(%s, %s)",
        (frm, to),
    )
    return list(cur.fetchall())


def _executive_value(cur: psycopg.Cursor, metric: str, frm, to, e: Expectation, **over: Any) -> float:
    index = {"distinct_calls": 4, "responses": 5, "engaged_hcps": 6}.get(metric)
    if index is None:
        raise ValueError("unsupported_executive_metric")
    territory = over.get("territory", e.territory)
    level = "TERRITORY" if territory else "TOTAL"
    for row in _executive_cells(cur, frm, to):
        if row[0] == level and (not territory or row[1] == territory) and (level != "TERRITORY" or row[3] is None):
            return float(row[index] or 0)
    return 0.0


def _executive_group_values(cur: psycopg.Cursor, e: Expectation) -> dict[str, float]:
    assert e.of and e.group_by
    level = {"month": "MONTH", "region": "REGION", "territory": "TERRITORY"}.get(e.group_by)
    index = {"distinct_calls": 4, "responses": 5, "engaged_hcps": 6}.get(e.of)
    if level is None or index is None:
        raise ValueError("unsupported_executive_group")
    out: dict[str, float] = {}
    for row in _executive_cells(cur, e.from_date, e.to_date):
        if row[0] != level or (level == "TERRITORY" and row[3] is not None):
            continue
        key = row[3].strftime("%Y-%m") if level == "MONTH" else str(row[2] if level == "REGION" else row[1])
        out[key] = float(row[index] or 0)
    return {key: out.get(key, 0.0) for key in e.keys} if e.keys else out


_FILLER = {"and", "the", "for", "with", "about", "use"}


def topic_variants(topic: str) -> list[str]:
    """The ways a person or an agent would search a theme: as written, singular, plural, or one word of a phrase."""
    forms = {topic, topic.removesuffix("s") if topic.endswith("s") else topic + "s"}
    words = [w for w in re.split(r"\W+", topic) if len(w) >= 5 and w.lower() not in _FILLER]
    if len(words) > 1:
        forms |= set(words)
    return sorted(forms)


def _direction(prior: float, current: float) -> str:
    delta = current - prior
    if abs(delta) <= max(1.0, FLAT_SHARE * max(abs(prior), abs(current))):
        return "FLAT"
    return "UP" if delta > 0 else "DOWN"


def _fmt(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:g}"


def compute_truth(cur: psycopg.Cursor, e: Expectation) -> Truth:
    """What a correct answer says for this expectation."""
    if e.aggregate:
        if e.metric in ("distinct_calls", "engaged_hcps", "responses"):
            value = _executive_value(cur, e.metric, e.from_date, e.to_date, e)
            return Truth(value=value, text=_fmt(value))
        if e.metric == "trend":
            assert e.of and e.prior
            prior = _executive_value(cur, e.of, e.prior[0], e.prior[1], e)
            current = _executive_value(cur, e.of, e.from_date, e.to_date, e)
            direction = _direction(prior, current)
            return Truth(value=current, prior_value=prior, direction=direction, text=f"{direction} ({_fmt(prior)} to {_fmt(current)})")
        if e.metric == "leader":
            values = _executive_group_values(cur, e)
            if not values:
                return Truth(text="no data in scope", extreme=e.extreme)
            best = (max if e.extreme == "max" else min)(values.values())
            leaders = sorted(key for key, value in values.items() if value == best)
            shown = ", ".join(f"{key} {_fmt(value)}" for key, value in sorted(values.items(), key=lambda pair: (-pair[1], pair[0]))[:6])
            return Truth(value=best, leaders=leaders, values=values, extreme=e.extreme, text=f"most: {' / '.join(leaders)} ({shown})")
    if e.metric == "answer_share":
        den = count(cur, "question_responses", e.from_date, e.to_date, territory=e.territory, question_id=e.question_id)
        num = count(cur, "question_responses", e.from_date, e.to_date, territory=e.territory, question_id=e.question_id, answer=e.answer)
        pct = round(100 * num / den, 1) if den else None
        text = f"{pct:g}% ({num} of {den})" if den else "no responses in scope"
        return Truth(value=pct, text=text, numerator=num, denominator=den)
    if e.metric == "topic_matches" and e.topic:
        v = _value(cur, e.metric, e.from_date, e.to_date, e)
        others = sorted(
            {
                _value(cur, e.metric, e.from_date, e.to_date, e, topic=variant)
                for variant in topic_variants(e.topic)
                if variant.lower() != e.topic.lower()
            }
            - {v}
        )
        text = _fmt(v) + (f" (or {', '.join(_fmt(o) for o in others)} for a variant search term)" if others else "")
        return Truth(value=v, text=text, alternatives=[v, *others])
    if e.metric in ("distinct_calls", "engaged_hcps", "responses", "topic_matches", "question_responses", "question_hcps"):
        v = _value(cur, e.metric, e.from_date, e.to_date, e)
        return Truth(value=v, text=_fmt(v))
    if e.metric == "trend":
        assert e.of and e.prior
        prior = _value(cur, e.of, e.prior[0], e.prior[1], e)
        now = _value(cur, e.of, e.from_date, e.to_date, e)
        direction = _direction(prior, now)
        return Truth(value=now, prior_value=prior, direction=direction, text=f"{direction} ({_fmt(prior)} to {_fmt(now)})")
    if e.metric == "leader":
        return _leader(cur, e)
    raise ValueError("unknown_metric")


def _group_values(cur: psycopg.Cursor, e: Expectation) -> dict[str, float]:
    assert e.of and e.group_by
    lo, hi = dt.date.fromisoformat(e.from_date), dt.date.fromisoformat(e.to_date)
    if e.group_by == "month":
        keys = list(e.keys) or _months(lo, hi)
        out = {}
        for key in keys:
            a, b = _month_window(key, lo, hi)
            out[key] = _value(cur, e.of, a, b, e)
        return out
    if e.group_by == "topic":
        return {key: _value(cur, e.of, e.from_date, e.to_date, e, topic=key) for key in e.keys}
    if e.group_by == "question":
        return {key: _value(cur, e.of, e.from_date, e.to_date, e, question_id=key) for key in e.keys}
    column = _GROUPS.get(e.of, {}).get(e.group_by)
    if column is None:
        raise ValueError("unknown_group")
    table, date_col, expr, base, _ = _SOURCES[e.of]
    where = [f"{date_col} BETWEEN %(frm)s AND %(to)s", base, f"{column} IS NOT NULL"]
    params: dict[str, Any] = {"frm": e.from_date, "to": e.to_date}
    if e.territory and e.group_by != "territory":
        where.append("territory_id = %(territory)s")
        params["territory"] = e.territory
    cur.execute(f"SELECT {column}, {expr} FROM {table} WHERE {' AND '.join(where)} GROUP BY 1", params)
    return {str(k): float(v) for k, v in cur.fetchall()}


def _leader(cur: psycopg.Cursor, e: Expectation) -> Truth:
    values = _group_values(cur, e)
    if not values:
        return Truth(text="no data in scope", extreme=e.extreme)
    best = (max if e.extreme == "max" else min)(values.values())
    leaders = sorted(k for k, v in values.items() if v == best)
    shown = ", ".join(f"{k} {_fmt(v)}" for k, v in sorted(values.items(), key=lambda kv: (-kv[1], kv[0]))[:6])
    label = "most" if e.extreme == "max" else "fewest"
    return Truth(value=best, leaders=leaders, values=values, extreme=e.extreme, text=f"{label}: {' / '.join(leaders)} ({shown})")


# -- chart recounts ----------------------------------------------------------------------------------------------------

_TERRITORY = re.compile(r"^T\d{2}-\d{2}$")
_MONTH = re.compile(r"^\d{4}-\d{2}$")
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_BUCKET = {
    "month": "to_char(date_trunc('month', {d}::timestamp)::date, 'YYYY-MM')",
    "week": "to_char(date_trunc('week', {d}::timestamp)::date, 'YYYY-MM-DD')",
    "day": "to_char({d}, 'YYYY-MM-DD')",
}
_METRIC_SOURCE = {"calls": _CALLS, "engaged_hcps": _HCPS, "responses": _RESPONSES}


def _scope_parts(scope: str) -> tuple[str | None, str | None, str | None]:
    """Territory, product and topic out of a visual's scope text (``T01-01 · osimertinib · “ctDNA”``)."""
    territory = product = topic = None
    for part in (p.strip() for p in scope.split("·")):
        if part == "your scope" or not part:
            continue
        if _TERRITORY.match(part):
            territory = part
        elif part.startswith("“") and part.endswith("”"):
            topic = part[1:-1]
        else:
            product = part
    return territory, product, topic


def _filters(table: str, product_col: str, territory, product, topic) -> tuple[list[str], dict[str, Any]]:
    where: list[str] = []
    params: dict[str, Any] = {}
    if territory:
        where.append("territory_id = %(territory)s")
        params["territory"] = territory
    if product:
        where.append(f"{product_col} ILIKE %(product)s ESCAPE '\\'")
        params["product"] = _like(product)
    if topic and table == "hcp_raw_insights":
        where.append(_TOPIC)
        params["like"] = _like(topic)
    return where, params


def _candidate_dims(metric: str, keys: Sequence[str]) -> list[str]:
    if keys and all(_MONTH.match(k) for k in keys):
        return ["month"]
    if keys and all(_DAY.match(k) for k in keys):
        return ["week", "day"]
    if keys and all(_TERRITORY.match(k) for k in keys):
        return ["territory"]
    return [d for d in ("product", "call_type", "question_type", "program") if d in _GROUPS.get(_alias(metric), {})]


def _alias(metric: str) -> str:
    return {"calls": "distinct_calls"}.get(metric, metric)


def _recount_series(cur: psycopg.Cursor, v: Mapping[str, Any]) -> tuple[bool, str]:
    metric = str(v.get("metric") or "")
    if metric not in _METRIC_SOURCE or " to " not in str(v.get("period") or ""):
        return True, "not recountable"
    frm, to = str(v["period"]).split(" to ")
    table, date_col, expr, base, product_col = _METRIC_SOURCE[metric]
    territory, product, topic = _scope_parts(str(v.get("scope") or ""))
    where, params = _filters(table, product_col, territory, product, topic)
    where = [f"{date_col} BETWEEN %(frm)s AND %(to)s", base, *where]
    params |= {"frm": frm, "to": to}
    points = {str(p["key"]): int(p["value"]) for p in v.get("points") or []}
    if not points:
        return False, "no points"
    cur.execute(f"SELECT {expr} FROM {table} WHERE {' AND '.join(where)}", params)
    overall = int(cur.fetchone()[0])
    total = v.get("total")
    # A time series total is the sum of its buckets for calls and responses and the distinct count for HCPs;
    # for a ranking it is the distinct count over the whole period. Either way it must be a real figure.
    for dim in _candidate_dims(metric, list(points)):
        group = _group_expr(dim, date_col, table, metric)
        if group is None:
            continue
        cur.execute(f"SELECT {group}, {expr} FROM {table} WHERE {' AND '.join(where)} GROUP BY 1", params)
        truth = {str(k): int(n) for k, n in cur.fetchall()}
        if all(truth.get(k, 0) == n for k, n in points.items()):
            ok_total = total is None or total in (overall, sum(truth.values()))
            return ok_total, "ok" if ok_total else f"total {total} is neither {overall} nor {sum(truth.values())}"
    return False, "points differ from SQL"


def _recount_executive_series(cur: psycopg.Cursor, v: Mapping[str, Any]) -> tuple[bool, str]:
    """Recount plotted Executive aggregates through the governed aggregate function, not source-row RLS."""
    metric = {"calls": 4, "responses": 5, "engaged_hcps": 6}.get(str(v.get("metric") or ""))
    period = str(v.get("period") or "")
    if metric is None or " to " not in period:
        return True, "not recountable"
    frm, to = period.split(" to ", 1)
    points = {str(point["key"]): int(point["value"]) for point in v.get("points") or []}
    if not points:
        return True, "no shown aggregate points"
    rows = _executive_cells(cur, frm, to)
    overall = next((int(row[metric] or 0) for row in rows if row[0] == "TOTAL"), 0)
    # A total-only Executive visual deliberately has one opaque aggregate
    # point.  It is not a territory key and must be recounted against the
    # governed TOTAL cell, never against the source-row territory surface.
    if set(points) == {"total"}:
        total = v.get("total")
        return points["total"] == overall and total in (None, overall), "ok" if points["total"] == overall and total in (None, overall) else "total differs from Executive aggregate SQL"
    if all(_MONTH.match(key) for key in points):
        truth = {row[3].strftime("%Y-%m"): int(row[metric] or 0) for row in rows if row[0] == "MONTH" and row[3]}
    elif all(key.startswith("REGION-") for key in points):
        truth = {str(row[2]): int(row[metric] or 0) for row in rows if row[0] == "REGION"}
    else:
        truth = {str(row[1]): int(row[metric] or 0) for row in rows if row[0] == "TERRITORY" and row[3] is None}
    if not all(truth.get(key) == value for key, value in points.items()):
        return False, "points differ from Executive aggregate SQL"
    total = v.get("total")
    return total in (None, overall), "ok" if total in (None, overall) else "total differs from Executive aggregate SQL"


def _group_expr(dim: str, date_col: str, table: str, metric: str) -> str | None:
    if dim in _BUCKET:
        return _BUCKET[dim].format(d=date_col)
    return _GROUPS.get(_alias(metric), {}).get(dim)


def _recount_heatmap(cur: psycopg.Cursor, v: Mapping[str, Any]) -> tuple[bool, str]:
    metric = str(v.get("metric") or "")
    if metric not in _METRIC_SOURCE or " to " not in str(v.get("period") or ""):
        return True, "not recountable"
    frm, to = str(v["period"]).split(" to ")
    table, date_col, expr, base, product_col = _METRIC_SOURCE[metric]
    territory, product, topic = _scope_parts(str(v.get("scope") or ""))
    where, params = _filters(table, product_col, territory, product, topic)
    where = [f"{date_col} BETWEEN %(frm)s AND %(to)s", base, *where]
    params |= {"frm": frm, "to": to}
    columns = list(v.get("columns") or [])
    rows = v.get("rows") or []
    if not rows or not columns:
        return False, "no cells"
    month = _BUCKET["month"].format(d=date_col)
    for dim in ("territory", "product"):
        row_col = _GROUPS.get(_alias(metric), {}).get(dim)
        if row_col is None:
            continue
        cur.execute(f"SELECT {row_col}, {month}, {expr} FROM {table} WHERE {' AND '.join(where)} GROUP BY 1, 2", params)
        cells = {(str(r), str(m)): int(n) for r, m, n in cur.fetchall()}
        # Columns are months; the first value may be a total column, so line up from the right.
        months = [c for c in columns if _MONTH.match(str(c))]
        if months and all(
            cells.get((str(row["key"]), m), 0) == val
            for row in rows
            for m, val in zip(months, row["values"][len(row["values"]) - len(months):], strict=True)
        ):
            return True, "ok"
    return False, "cells differ from SQL"


_TABLE_GROUPS = {"territory": "territory", "product": "product", "month": "month", "week": "week", "day": "day"}


def _recount_table(cur: psycopg.Cursor, v: Mapping[str, Any]) -> tuple[bool, str]:
    """A small table of calls, engaged HCPs and responses per group: every cell is recounted."""
    title = str(v.get("title") or "")
    group = _TABLE_GROUPS.get(title.removeprefix("Activity by ").strip().lower())
    if group is None or " to " not in str(v.get("period") or "") or not v.get("rows"):
        return True, "not recountable"
    frm, to = str(v["period"]).split(" to ")
    territory, product, topic = _scope_parts(str(v.get("scope") or ""))
    per_metric: list[dict[str, int]] = []
    for metric in ("calls", "engaged_hcps", "responses"):
        table, date_col, expr, base, product_col = _METRIC_SOURCE[metric]
        where, params = _filters(table, product_col, territory, product, topic if metric == "responses" else None)
        where = [f"{date_col} BETWEEN %(frm)s AND %(to)s", base, *where]
        params |= {"frm": frm, "to": to}
        column = _group_expr(group, date_col, table, metric)
        cur.execute(f"SELECT {column}, {expr} FROM {table} WHERE {' AND '.join(where)} GROUP BY 1", params)
        per_metric.append({str(k): int(n) for k, n in cur.fetchall()})
    for row in v["rows"]:
        key = str(row["key"])
        if [m.get(key, 0) for m in per_metric] != [int(x) for x in row["values"]]:
            return False, f"row {key} differs from SQL"
    return True, "ok"


def _distribution_consistent(v: Mapping[str, Any]) -> tuple[bool, str]:
    """A distribution's shares are its counts over its total, to one decimal (no database figure to recount)."""
    points = v.get("points") or []
    total = sum(int(p["value"]) for p in points)
    for p in points:
        share = p.get("share_pct")
        if share is not None and total and abs(share - round(100 * int(p["value"]) / total, 1)) > 0.11:
            return False, "share does not equal count over total"
    return True, "ok"


def recount_visual(cur: psycopg.Cursor, visual: Mapping[str, Any]) -> tuple[bool, str]:
    """Whether every number a ready chart plots equals an independent recount. ``(True, reason)`` when nothing is checkable."""
    kind = visual.get("kind")
    if visual.get("scope") == "your executive scope" and kind in ("line", "bar", "timeline"):
        return _recount_executive_series(cur, visual)
    if kind in ("line", "bar", "timeline"):
        return _recount_series(cur, visual)
    if kind == "heatmap":
        return _recount_heatmap(cur, visual)
    if kind == "distribution":
        return _distribution_consistent(visual)
    if kind == "table":
        return _recount_table(cur, visual)
    return True, "not recountable"


__all__ = ["FLAT_SHARE", "Truth", "compute_truth", "count", "recount_visual", "topic_variants"]
