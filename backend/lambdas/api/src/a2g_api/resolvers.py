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
MAX_HCP_SEARCH_RESULTS = 50


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


#: Aggregate-only callers never see a count below this, and never see a total that would let
#: them subtract one back out (small-group suppression, ADR 0003).
MIN_CELL = 5


def geo_activity(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, default_range_days: int) -> dict[str, Any]:
    """Distinct calls per territory and per country for the territory map.

    Works for every persona that holds ``aggregate.read``: the counts come from the
    SECURITY DEFINER aggregate functions (migration 006), which restrict to the caller's
    effective scope, so an Executive gets the map without ever reading a call row. Out-of-scope
    territories are not returned at all, so they cannot be coloured or even named.
    Callers without ``source.records.read`` (aggregate-only) get small counts suppressed.
    """
    cur.execute("SELECT app.can_read_aggregate(), app.has_permission('source.records.read'), app.has_permission('admin.manage')")
    can_aggregate, can_records, is_admin = (bool(v) for v in cur.fetchone())
    if not can_aggregate:
        raise Forbidden("aggregate_access_required")
    cur.execute("SELECT app.aggregate_data_through()")
    data_through = cur.fetchone()[0]
    frm, to = _range(args, data_through, default_range_days)

    cur.execute(
        """
        SELECT territory_id, territory_name, region_id, region_name, country_code, country_name,
               subdivision_code, subdivision_name, latitude, longitude, is_own, distinct_calls
        FROM app.geo_territories(%(frm)s, %(to)s)
        """,
        {"frm": frm, "to": to},
    )
    territory_rows = cur.fetchall()
    cur.execute(
        "SELECT country_code, country_name, territory_count, distinct_calls FROM app.geo_countries(%(frm)s, %(to)s)",
        {"frm": frm, "to": to},
    )
    country_rows = cur.fetchall()
    if not territory_rows and not is_admin:
        raise NoScope("no_effective_scope")

    suppress = not can_records
    hidden_countries = {r[4] for r in territory_rows if suppress and int(r[11]) < MIN_CELL}

    territories = [
        {
            "territoryId": tid,
            "name": name,
            "regionId": region_id,
            "regionName": region_name,
            "countryCode": country_code,
            "countryName": country_name,
            "subdivisionCode": sub_code,
            "subdivisionName": sub_name,
            "latitude": float(lat),
            "longitude": float(lon),
            "isOwn": bool(own),
            "distinctCalls": None if suppress and int(calls) < MIN_CELL else int(calls),
            "suppressed": suppress and int(calls) < MIN_CELL,
        }
        for tid, name, region_id, region_name, country_code, country_name, sub_code, sub_name, lat, lon, own, calls in territory_rows
    ]
    countries = [
        {
            "countryCode": code,
            "countryName": name,
            "territoryCount": int(count),
            "distinctCalls": None if suppress and (int(calls) < MIN_CELL or code in hidden_countries) else int(calls),
            "suppressed": suppress and (int(calls) < MIN_CELL or code in hidden_countries),
        }
        for code, name, count, calls in country_rows
    ]

    scope_label = _geo_scope_label(_assigned_scope_ids(cur), len(territories), is_admin)
    log.info(
        "geo activity computed",
        user_id=user_id,
        territory_count=len(territories),
        country_count=len(countries),
        suppressed_count=sum(1 for t in territories if t["suppressed"]),
        range_days=(to - frm).days + 1,
    )
    return {
        "from": frm.isoformat(),
        "to": to.isoformat(),
        "dataThrough": data_through.isoformat() if data_through else None,
        "scopeLabel": scope_label,
        "territories": territories,
        "countries": countries,
    }


def _assigned_scope_ids(cur: psycopg.Cursor) -> list[str]:
    cur.execute(
        """
        SELECT DISTINCT territory_id FROM user_scope_assignments
        WHERE user_id = app.request_user_id()
          AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
        ORDER BY territory_id
        """
    )
    return [r[0] for r in cur.fetchall()]


def _geo_scope_label(assigned: list[str], leaf_count: int, is_admin: bool) -> str:
    """Same wording as ``_scope`` but counted from the territories the caller can actually see,
    because an aggregate-only caller cannot read the hierarchy table ``_scope`` walks."""
    if is_admin:
        return "All territories (administrator)"
    if not assigned:
        return "No territory assigned"
    names = ", ".join(assigned)
    return names if leaf_count <= len(assigned) else f"{names} \u00b7 {leaf_count} territories"


def _hcp_field(value: Any) -> dict[str, Any]:
    return {"value": value, "state": "MISSING" if value is None else "PRESENT"}


def _require_hcp_search_access(cur: psycopg.Cursor, identity: Identity) -> None:
    _assigned, effective, label = _scope(cur, identity)
    _require_record_access(cur, label, effective)


def _search_pattern(value: Any) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 200:
        raise BadRequest("search_query_required")
    return "%" + value.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _profile(cur: psycopg.Cursor, hcp_id: str) -> tuple[Any, ...] | None:
    cur.execute("""
      WITH visible AS (SELECT x.hcp_id FROM hcp_identifier_crosswalk x JOIN call_activity c ON x.source_system='call_activity.cust_mdm_id' AND x.source_identifier=c.cust_mdm_id WHERE x.hcp_id=%(id)s UNION SELECT x.hcp_id FROM hcp_identifier_crosswalk x JOIN hcp_raw_insights i ON x.source_system='hcp_raw_insights.cust_mdm_id' AND x.source_identifier=i.cust_mdm_id WHERE x.hcp_id=%(id)s), calls AS (SELECT c.* FROM call_activity c JOIN hcp_identifier_crosswalk x ON x.source_system='call_activity.cust_mdm_id' AND x.source_identifier=c.cust_mdm_id JOIN visible v ON v.hcp_id=x.hcp_id), insights AS (SELECT i.* FROM hcp_raw_insights i JOIN hcp_identifier_crosswalk x ON x.source_system='hcp_raw_insights.cust_mdm_id' AND x.source_identifier=i.cust_mdm_id JOIN visible v ON v.hcp_id=x.hcp_id) SELECT v.hcp_id, COALESCE((SELECT min(cust_full_nm) FROM calls),(SELECT min(cust_nm) FROM insights)), (SELECT min(hcp_speciality) FROM insights), (SELECT min(hcp_discipline) FROM insights), (SELECT min(hcp_type) FROM insights), (SELECT min(hcp_institution) FROM insights), (SELECT min(cust_cdtl) FROM calls), (SELECT string_agg(territory_name, ', ' ORDER BY territory_name) FROM (SELECT DISTINCT territory_name FROM calls WHERE territory_name IS NOT NULL UNION SELECT DISTINCT territory_name FROM insights WHERE territory_name IS NOT NULL) t) FROM visible v
    """, {"id": hcp_id})
    return cur.fetchone()


def hcp_profile(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    _require_hcp_search_access(cur, identity)
    hcp_id = args.get("hcpId")
    if not isinstance(hcp_id, str) or not hcp_id.strip() or len(hcp_id) > 200: raise BadRequest("invalid_hcp_id")
    row = _profile(cur, hcp_id.strip())
    if row is None: raise Forbidden("hcp_not_in_scope")
    keys = ("hcpId", "name", "specialty", "discipline", "type", "institution", "credentials", "territory")
    raw = dict(zip(keys, row, strict=True))
    return {"hcpId": raw["hcpId"], **{key: _hcp_field(raw[key]) for key in keys[1:]}}


def search_hcps(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> list[dict[str, Any]]:
    _require_hcp_search_access(cur, identity)
    pattern = _search_pattern(args.get("query")); limit = args.get("limit", 20)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_HCP_SEARCH_RESULTS: raise BadRequest("invalid_search_limit")
    cur.execute("""SELECT DISTINCT x.hcp_id FROM hcp_identifier_crosswalk x JOIN call_activity c ON x.source_system='call_activity.cust_mdm_id' AND x.source_identifier=c.cust_mdm_id WHERE c.cust_full_nm ILIKE %(p)s ESCAPE '\\' OR c.territory_name ILIKE %(p)s ESCAPE '\\' UNION SELECT DISTINCT x.hcp_id FROM hcp_identifier_crosswalk x JOIN hcp_raw_insights i ON x.source_system='hcp_raw_insights.cust_mdm_id' AND x.source_identifier=i.cust_mdm_id WHERE i.cust_nm ILIKE %(p)s ESCAPE '\\' OR i.hcp_institution ILIKE %(p)s ESCAPE '\\' OR i.territory_name ILIKE %(p)s ESCAPE '\\'""", {"p": pattern})
    results = []
    for (hcp_id,) in cur.fetchall():
        row = _profile(cur, hcp_id)
        if row: results.append({"hcpId": row[0], "name": _hcp_field(row[1]), "institution": _hcp_field(row[5]), "territory": _hcp_field(row[7])})
    return sorted(results, key=lambda item: (item["name"]["value"] or "", item["hcpId"]))[:limit]
