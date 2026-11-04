"""Personal activity trends and the evidence behind them. Every number is SQL under RLS.

Metric definitions (docs/adr/0003, ``metric_definitions``):

* distinctCalls (per month): ``COUNT(DISTINCT crm_call_id)`` over Call Activity rows whose
  ``call_dt`` (the interaction date) falls in the month. ``crm_call_id`` repeats once per
  product discussed, so raw rows are never counted.
* distinctEngagedHcps (per month): ``COUNT(DISTINCT cust_mdm_id)`` over the same rows.
  Months are not additive: an HCP seen in two months counts once in each, so the window
  total is its own distinct count, never the sum of the months.
* channel mix: distinct calls per ``call_chnl`` per month. A blank channel is reported as
  ``Unspecified``. A call recorded under several channels counts once in each of them.
* No target, benchmark, rank or score is computed or returned: these are counts only.
* Interaction date vs load date: ``call_dt`` is when the exchange happened;
  ``sys_inserted_datetime`` is when the record reached this system. The evidence drawer
  shows both, and ``dataThrough`` is always a load date.
"""

from __future__ import annotations

import calendar
import datetime as dt
from collections.abc import Mapping
from typing import Any

import psycopg

from a2g_logging import get_logger

from .errors import BadRequest
from .identity import Identity
from .resolvers import _data_through, _require_record_access, _scope

log = get_logger(__name__)

MAX_MONTHS = 24
DEFAULT_MONTHS = 12
MAX_EVIDENCE = 100
DEFAULT_EVIDENCE = 50
UNSPECIFIED = "Unspecified"
METRICS = ("CALLS", "HCPS")
MIN_MONTH = dt.date(2000, 1, 1)

_CHANNEL = "coalesce(nullif(btrim(call_chnl), ''), 'Unspecified')"


def _month_start(d: dt.date) -> dt.date:
    return d.replace(day=1)


def _month_end(d: dt.date) -> dt.date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def _add_months(d: dt.date, n: int) -> dt.date:
    index = d.year * 12 + (d.month - 1) + n
    return dt.date(index // 12, index % 12 + 1, 1)


def _int_arg(value: Any, name: str, default: int, low: int, high: int) -> int:
    if value in (None, ""):
        return default
    if isinstance(value, bool) or not isinstance(value, int | str):
        raise BadRequest(f"invalid_{name}")
    try:
        number = int(value)
    except ValueError as exc:
        raise BadRequest(f"invalid_{name}") from exc
    if not low <= number <= high:
        raise BadRequest(f"invalid_{name}")
    return number


def _parse_month(value: Any) -> dt.date:
    try:
        parsed = dt.date.fromisoformat(str(value))
    except ValueError as exc:
        raise BadRequest("invalid_month") from exc
    if parsed < MIN_MONTH:
        raise BadRequest("invalid_month")
    return _month_start(parsed)


def _as_date(value: dt.datetime | None) -> dt.date:
    return value.astimezone(dt.UTC).date() if value else dt.date.today()


def activity_trends(
    cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]
) -> dict[str, Any]:
    assigned, effective, label = _scope(cur, identity)
    _require_record_access(cur, label, effective)
    months = _int_arg(args.get("months"), "months", DEFAULT_MONTHS, 1, MAX_MONTHS)

    data_through = _data_through(cur)
    through_day = _as_date(data_through)
    end_month = _month_start(through_day)
    first_month = _add_months(end_month, -(months - 1))
    window_end = _month_end(end_month)
    params = {"frm": first_month, "to": window_end}

    cur.execute(
        """
        SELECT date_trunc('month', call_dt)::date, count(DISTINCT crm_call_id), count(DISTINCT cust_mdm_id)
        FROM call_activity WHERE call_dt BETWEEN %(frm)s AND %(to)s GROUP BY 1
        """,
        params,
    )
    monthly = {row[0]: (int(row[1]), int(row[2])) for row in cur.fetchall()}
    cur.execute(
        f"""
        SELECT date_trunc('month', call_dt)::date, {_CHANNEL}, count(DISTINCT crm_call_id)
        FROM call_activity WHERE call_dt BETWEEN %(frm)s AND %(to)s GROUP BY 1, 2
        """,
        params,
    )
    by_channel: dict[dt.date, dict[str, int]] = {}
    for month, channel, calls in cur.fetchall():
        by_channel.setdefault(month, {})[channel] = int(calls)
    cur.execute(
        """
        SELECT count(DISTINCT crm_call_id), count(DISTINCT cust_mdm_id)
        FROM call_activity WHERE call_dt BETWEEN %(frm)s AND %(to)s
        """,
        params,
    )
    total_calls, total_hcps = (int(v) for v in cur.fetchone())

    channels = sorted({c for per in by_channel.values() for c in per})
    series = []
    for i in range(months):
        month = _add_months(first_month, i)
        calls, hcps = monthly.get(month, (0, 0))
        series.append(
            {
                "month": month.isoformat(),
                "distinctCalls": calls,
                "distinctEngagedHcps": hcps,
                "isPartial": _month_end(month) > through_day,
                "channels": [
                    {"channel": c, "distinctCalls": n} for c, n in sorted(by_channel.get(month, {}).items())
                ],
            }
        )
    log.info(
        "activity trends computed",
        user_id=user_id,
        territory_count=effective,
        month_count=months,
        kpi_distinct_calls=total_calls,
        kpi_distinct_hcps=total_hcps,
    )
    return {
        "from": first_month.isoformat(),
        "to": window_end.isoformat(),
        "months": series,
        "channels": channels,
        "totalDistinctCalls": total_calls,
        "totalDistinctEngagedHcps": total_hcps,
        "dataThrough": data_through.isoformat() if data_through else None,
        "scopeLabel": label,
    }


def activity_evidence(
    cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]
) -> dict[str, Any]:
    """The distinct calls, or distinct HCPs, behind one chart point, with both dates."""
    assigned, effective, label = _scope(cur, identity)
    _require_record_access(cur, label, effective)
    metric = str(args.get("metric") or "")
    if metric not in METRICS:
        raise BadRequest("invalid_metric")
    month = _parse_month(args.get("month"))
    limit = _int_arg(args.get("limit"), "limit", DEFAULT_EVIDENCE, 1, MAX_EVIDENCE)
    channel = args.get("channel")
    if channel is not None and (not isinstance(channel, str) or not 0 < len(channel) <= 80):
        raise BadRequest("invalid_channel")

    where = "call_dt BETWEEN %(frm)s AND %(to)s"
    params: dict[str, Any] = {"frm": month, "to": _month_end(month), "limit": limit}
    if channel is not None:
        where += f" AND {_CHANNEL} = %(channel)s"
        params["channel"] = channel

    cur.execute(
        f"""
        SELECT count(DISTINCT {"crm_call_id" if metric == "CALLS" else "cust_mdm_id"}),
               max(call_dt), max(sys_inserted_datetime)
        FROM call_activity WHERE {where}
        """,
        params,
    )
    total, latest_interaction, latest_load = cur.fetchone()
    total = int(total)

    if metric == "CALLS":
        cur.execute(
            f"""
            SELECT crm_call_id, min(cust_mdm_id), min(cust_full_nm), min(territory_id),
                   min({_CHANNEL}), 1, min(call_dt), max(sys_inserted_datetime)
            FROM call_activity WHERE {where} AND crm_call_id IS NOT NULL
            GROUP BY crm_call_id ORDER BY min(call_dt) DESC, crm_call_id LIMIT %(limit)s
            """,
            params,
        )
    else:
        cur.execute(
            f"""
            SELECT cust_mdm_id, cust_mdm_id, min(cust_full_nm), min(territory_id),
                   NULL, count(DISTINCT crm_call_id), max(call_dt), max(sys_inserted_datetime)
            FROM call_activity WHERE {where} AND cust_mdm_id IS NOT NULL
            GROUP BY cust_mdm_id ORDER BY max(call_dt) DESC, cust_mdm_id LIMIT %(limit)s
            """,
            params,
        )
    records = [
        {
            "recordId": rid,
            "kind": "CALL" if metric == "CALLS" else "HCP",
            "hcpId": hcp_id,
            "hcpName": hcp_name,
            "territoryId": territory,
            "channel": chnl,
            "callCount": int(calls),
            "interactionDate": interaction.isoformat(),
            "loadedAt": loaded.isoformat() if loaded else None,
        }
        for rid, hcp_id, hcp_name, territory, chnl, calls, interaction, loaded in cur.fetchall()
    ]
    log.info(
        "activity evidence served",
        user_id=user_id,
        metric=metric,
        count=len(records),
        row_count=total,
    )
    return {
        "metric": metric,
        "month": month.isoformat(),
        "channel": channel,
        "total": total,
        "truncated": total > len(records),
        "latestInteractionDate": latest_interaction.isoformat() if latest_interaction else None,
        "latestLoadedAt": latest_load.isoformat() if latest_load else None,
        "dataThrough": (dtu.isoformat() if (dtu := _data_through(cur)) else None),
        "scopeLabel": label,
        "records": records,
    }
