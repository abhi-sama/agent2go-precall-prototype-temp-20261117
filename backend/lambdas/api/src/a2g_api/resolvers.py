"""AppSync field resolvers. Every number is computed by SQL under RLS, never by AI.

Metric definitions (docs/adr/0003, ``metric_definitions`` in Postgres):

* distinctCalls: ``COUNT(DISTINCT crm_call_id)`` over Call Activity rows with
  ``call_dt`` in range. ``crm_call_id`` repeats per call-product row, so raw rows are
  never counted; null identifiers are excluded by ``COUNT(DISTINCT ...)``.
* distinctEngagedHcps: ``COUNT(DISTINCT cust_mdm_id)`` over the same Call Activity rows.
* responseCount: ``COUNT(DISTINCT uniq_rspns_id)`` over HCP insight rows with
  ``date_of_interaction`` in range, excluding ``excluded_rspns_flag`` rows. The key is
  counted distinct because it is not yet a validated unique key (duplicates exist).
* dataThrough: the load timestamp (``sys_inserted_datetime``) through which both
  in-scope sources are loaded, i.e. the earlier of the two latest loads. It is a load
  date, deliberately distinct from interaction dates.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Mapping
from typing import Any

import psycopg

from a2g_logging import get_logger

from .errors import BadRequest, Forbidden, NoScope
from .identity import Identity

log = get_logger(__name__)

MAX_RANGE_DAYS = 366 * 3


def _scope(cur: psycopg.Cursor, identity: Identity) -> tuple[list[str], int, str]:
    """Return (directly assigned territory ids, effective leaf-territory count, label)."""
    cur.execute(
        """
        SELECT DISTINCT territory_id FROM user_scope_assignments
        WHERE user_id = app.request_user_id()
          AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
        ORDER BY territory_id
        """
    )
    assigned = [r[0] for r in cur.fetchall()]
    # Count leaf territories: a region in scope contributes its territories, not itself.
    cur.execute(
        """
        SELECT count(*) FROM app.current_scope_territories() s
        WHERE NOT EXISTS (
          SELECT 1 FROM territory_scope_relationships r
          WHERE r.parent_territory_id = s.territory_id
            AND r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now()))
        """
    )
    effective = int(cur.fetchone()[0])
    cur.execute("SELECT app.has_permission('admin.manage')")
    is_admin = bool(cur.fetchone()[0])
    if is_admin:
        return assigned, effective, "All territories (administrator)"
    if not assigned:
        return assigned, 0, "No territory assigned"
    names = ", ".join(assigned)
    if effective <= len(assigned):
        return assigned, effective, names
    return assigned, effective, f"{names} · {effective} territories"


def me(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    _assigned, _effective, label = _scope(cur, identity)
    full_name = identity.full_name
    if not full_name:
        cur.execute("SELECT display_name FROM users WHERE user_id = app.request_user_id()")
        row = cur.fetchone()
        full_name = (row[0] if row else None) or ""
    return {
        "userId": user_id,
        "fullName": full_name,
        "email": identity.email,
        "persona": identity.persona,
        "scopeLabel": label,
    }


def _parse_date(value: Any, name: str) -> dt.date | None:
    if value in (None, ""):
        return None
    try:
        return dt.date.fromisoformat(str(value))
    except ValueError as exc:
        raise BadRequest(f"invalid_{name}") from exc


def _require_record_access(cur: psycopg.Cursor, label: str, effective: int) -> None:
    if effective == 0 and label != "All territories (administrator)":
        raise NoScope("no_effective_scope")
    cur.execute("SELECT app.has_permission('source.records.read')")
    if not cur.fetchone()[0]:
        # Aggregate-only personas (Executive) get suppressed aggregates through a
        # separate path (ticket 12); source-row counts would read as zero here.
        raise Forbidden("aggregate_only_landing_pending")


def _data_through(cur: psycopg.Cursor) -> dt.datetime | None:
    cur.execute(
        """
        SELECT LEAST((SELECT max(sys_inserted_datetime) FROM call_activity),
                     (SELECT max(sys_inserted_datetime) FROM hcp_raw_insights))
        """
    )
    return cur.fetchone()[0]


def _range(args: Mapping[str, Any], data_through: dt.datetime | None, default_range_days: int) -> tuple[dt.date, dt.date]:
    to = _parse_date(args.get("to"), "to") or (data_through.date() if data_through else dt.date.today())
    frm = _parse_date(args.get("from"), "from") or (to - dt.timedelta(days=default_range_days - 1))
    if frm > to or (to - frm).days > MAX_RANGE_DAYS:
        raise BadRequest("invalid_range")
    return frm, to


def landing_kpis(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, default_range_days: int) -> dict[str, Any]:
    assigned, effective, label = _scope(cur, identity)
    _require_record_access(cur, label, effective)

    data_through = _data_through(cur)
    frm, to = _range(args, data_through, default_range_days)

    cur.execute(
        """
        SELECT
          (SELECT count(DISTINCT crm_call_id) FROM call_activity
             WHERE call_dt BETWEEN %(frm)s AND %(to)s),
          (SELECT count(DISTINCT cust_mdm_id) FROM call_activity
             WHERE call_dt BETWEEN %(frm)s AND %(to)s),
          (SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights
             WHERE date_of_interaction BETWEEN %(frm)s AND %(to)s
               AND excluded_rspns_flag IS NOT TRUE)
        """,
        {"frm": frm, "to": to},
    )
    calls, hcps, responses = (int(v) for v in cur.fetchone())
    log.info(
        "landing kpis computed",
        user_id=user_id,
        territory_count=effective,
        range_days=(to - frm).days + 1,
        kpi_distinct_calls=calls,
        kpi_distinct_hcps=hcps,
        kpi_responses=responses,
    )
    return {
        "distinctCalls": calls,
        "distinctEngagedHcps": hcps,
        "responseCount": responses,
        "from": frm.isoformat(),
        "to": to.isoformat(),
        "dataThrough": data_through.isoformat() if data_through else None,
        "scopeLabel": label,
    }


def territory_activity(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, default_range_days: int) -> list[dict[str, Any]]:
    """Per-territory KPIs for the caller's leaf territories, same definitions as landingKpis."""
    assigned, effective, label = _scope(cur, identity)
    _require_record_access(cur, label, effective)
    frm, to = _range(args, _data_through(cur), default_range_days)
    cur.execute(
        """
        WITH scope AS (
          SELECT s.territory_id FROM app.current_scope_territories() s
          WHERE NOT EXISTS (
            SELECT 1 FROM territory_scope_relationships r
            WHERE r.parent_territory_id = s.territory_id
              AND r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now()))
        ),
        region AS (
          SELECT DISTINCT ON (r.child_territory_id) r.child_territory_id AS territory_id,
                 r.parent_territory_id AS region_id, coalesce(r.region_name, r.parent_territory_id) AS region_name
          FROM territory_scope_relationships r
          WHERE r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now())
          ORDER BY r.child_territory_id, (r.parent_territory_id LIKE 'REGION-%%') DESC, r.parent_territory_id
        ),
        names AS (
          SELECT DISTINCT ON (child_territory_id) child_territory_id AS territory_id, child_territory_name AS name
          FROM territory_rd_access ORDER BY child_territory_id, child_territory_name
        ),
        calls AS (
          SELECT territory_id, count(DISTINCT crm_call_id) AS calls, count(DISTINCT cust_mdm_id) AS hcps
          FROM call_activity WHERE call_dt BETWEEN %(frm)s AND %(to)s GROUP BY territory_id
        ),
        responses AS (
          SELECT territory_id, count(DISTINCT uniq_rspns_id) AS responses
          FROM hcp_raw_insights WHERE date_of_interaction BETWEEN %(frm)s AND %(to)s
            AND excluded_rspns_flag IS NOT TRUE GROUP BY territory_id
        )
        SELECT s.territory_id, coalesce(n.name, s.territory_id), coalesce(g.region_id, ''),
               coalesce(g.region_name, ''), coalesce(c.calls, 0), coalesce(c.hcps, 0), coalesce(x.responses, 0)
        FROM scope s
        LEFT JOIN names n USING (territory_id)
        LEFT JOIN region g USING (territory_id)
        LEFT JOIN calls c USING (territory_id)
        LEFT JOIN responses x USING (territory_id)
        ORDER BY g.region_id, s.territory_id
        """,
        {"frm": frm, "to": to},
    )
    rows = cur.fetchall()
    regions = sorted({r[2] for r in rows})
    col_in_region: dict[str, int] = {}
    tiles = []
    for tid, name, region_id, region_name, calls, hcps, responses in rows:
        col = col_in_region.get(region_id, 0)
        col_in_region[region_id] = col + 1
        tiles.append(
            {
                "territoryId": tid,
                "name": name,
                "regionId": region_id,
                "regionName": region_name,
                "col": col,
                "row": regions.index(region_id),
                "inScope": True,
                "isOwn": tid in assigned,
                "distinctCalls": int(calls),
                "distinctEngagedHcps": int(hcps),
                "responseCount": int(responses),
            }
        )
    log.info("territory activity computed", user_id=user_id, count=len(tiles), range_days=(to - frm).days + 1)
    return tiles
