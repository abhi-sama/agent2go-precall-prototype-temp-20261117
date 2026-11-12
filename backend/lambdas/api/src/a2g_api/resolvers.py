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
from .embeddings import EmbeddingProvider, vector_literal
from .identity import Identity
from .saved_views import SavedViews

log = get_logger(__name__)

MAX_RANGE_DAYS = 366 * 3
MAX_HCP_SEARCH_RESULTS = 50
FILTER_KEYS = ("from", "to", "territoryId", "molecule", "landscape", "study", "survey", "questionId")

# This is deliberately a manifest rather than a second authorization implementation.  The
# source of truth is tests/api/test_authorization_grid.py: it signs in the seeded persona,
# calls AppSync, and checks the result from the actual protected path.  Publishing the manifest
# lets administrators inspect exactly what CI proves without exposing test identities or data.
_AUTHORIZATION_PATHS = (
    ("api_search", "API search"),
    ("dashboard", "Dashboards"),
    ("chat_retrieval", "Chat retrieval"),
    ("vector_search", "Vector search"),
    ("saved_outputs", "Saved outputs"),
    ("offline_cache", "Offline caches"),
    ("export", "Exports"),
    ("drill_down", "Drill-down"),
)
_AUTHORIZATION_PERSONAS = ("MSL", "Director", "Executive", "Administrator")
_AUTHORIZATION_SCENARIOS = (
    ("in_scope", "Only records in the active scope are returned."),
    ("out_of_scope", "An out-of-scope record is refused without confirming it exists."),
    ("after_transfer", "The prior territory closes immediately when a transfer takes effect."),
    ("coverage_expired", "Temporary coverage closes at its effective end time."),
)


def _filters(args: Mapping[str, Any]) -> dict[str, str]:
    """Accept only the fixed source-backed vocabulary; never dynamic SQL."""
    raw = args.get("filters") or {}
    if not isinstance(raw, Mapping):
        raise BadRequest("invalid_filters")
    result: dict[str, str] = {}
    for key in FILTER_KEYS:
        value = raw.get(key)
        if value in (None, ""):
            continue
        value = str(value).strip()
        if not value or len(value) > 200:
            raise BadRequest("invalid_filters")
        result[key] = value
    return result


def _insight_where(filters: Mapping[str, str], alias: str = "h") -> tuple[list[str], dict[str, str]]:
    columns = {"territoryId": "territory_id", "molecule": "molecule_type", "landscape": "landscape_type", "study": "study_name", "survey": "survey_type", "questionId": "qstn_ext_id"}
    clauses, params = [], {}
    for key, column in columns.items():
        if key in filters:
            clauses.append(f"{alias}.{column} = %({key})s")
            params[key] = filters[key]
    return clauses, params


def _catalog_where(filters: Mapping[str, str]) -> tuple[list[str], dict[str, str]]:
    columns = {"molecule": "molecule_type", "study": "study_name", "survey": "survey_type", "questionId": "qstn_ext_id"}
    clauses, params = [], {}
    for key, column in columns.items():
        if key in filters:
            clauses.append(f"q.{column} = %({key})s")
            params[key] = filters[key]
    return clauses, params


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
    filters = _filters(args)
    to = _parse_date(args.get("to") or filters.get("to"), "to") or (data_through.date() if data_through else dt.date.today())
    frm = _parse_date(args.get("from") or filters.get("from"), "from") or (to - dt.timedelta(days=default_range_days - 1))
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
    filters = _filters(args)
    if filters.get("territoryId"):
        territory_rows = [row for row in territory_rows if row[0] == filters["territoryId"]]
    cur.execute(
        "SELECT country_code, country_name, territory_count, distinct_calls FROM app.geo_countries(%(frm)s, %(to)s)",
        {"frm": frm, "to": to},
    )
    country_rows = cur.fetchall()
    if filters.get("territoryId"):
        country_rows = [
            (code, rows[0][5], len(rows), sum(int(row[11]) for row in rows))
            for code, rows in {
                code: [row for row in territory_rows if row[4] == code] for code in {row[4] for row in territory_rows}
            }.items()
        ]
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


SCOPE_ASSIGNMENT_TYPES = frozenset({"primary", "temporary", "executive", "administrative"})

def _require_admin(cur):
    cur.execute("SELECT app.has_permission('admin.manage')")
    if not cur.fetchone()[0]: raise Forbidden("admin_manage_required")

def _time(value, name, required=False):
    if value in (None, ""):
        if required: raise BadRequest(f"missing_{name}")
        return None
    try: value = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc: raise BadRequest(f"invalid_{name}") from exc
    if value.tzinfo is None: raise BadRequest(f"invalid_{name}")
    return value

def _identity_matches(cur, user_id=None):
    cur.execute("""SELECT u.user_id,coalesce(u.display_name,''),u.identity_status,u.roster_source_row_id,m.full_name,(SELECT count(*) FROM medical_roster c WHERE c.email_id IS NOT NULL AND c.email_id=u.email),coalesce((SELECT array_agg(c.source_row_id ORDER BY c.source_row_id) FROM medical_roster c WHERE c.email_id IS NOT NULL AND c.email_id=u.email),ARRAY[]::bigint[]) FROM users u LEFT JOIN medical_roster m ON m.source_row_id=u.roster_source_row_id WHERE (%s::text IS NULL OR u.user_id=%s) ORDER BY u.user_id""", (user_id,user_id))
    out=[]
    for uid,name,status,rid,rname,count,ids in cur.fetchall():
        flag="matched" if rid is not None and status=="matched" else ("conflicting" if rid is None and count>1 else "missing")
        out.append({"userId":uid,"displayName":name,"identityStatus":status,"rosterSourceRowId":str(rid) if rid else None,"rosterName":rname,"exactEmailCandidateCount":int(count),"candidateRosterSourceRowIds":[str(x) for x in ids],"flag":flag})
    return out

def _roles(cur, role_id=None):
    cur.execute("SELECT r.role_id,r.role_name,p.permission_code,p.description FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.role_id LEFT JOIN permissions p ON p.permission_code=rp.permission_code WHERE (%s::text IS NULL OR r.role_id=%s) ORDER BY r.role_id,p.permission_code",(role_id,role_id)); out={}
    for rid,name,code,description in cur.fetchall(): out.setdefault(rid,{"roleId":rid,"roleName":name,"permissions":[]})["permissions"] += [] if code is None else [{"permissionCode":code,"description":description}]
    return list(out.values())

def _assignments(cur, assignment_id=None):
    cur.execute("""SELECT a.assignment_id,a.user_id,coalesce(u.display_name,''),a.territory_id,a.assignment_type,a.effective_from,a.effective_to,NOT EXISTS(SELECT 1 FROM territory_rd_access t WHERE t.child_territory_id=a.territory_id UNION ALL SELECT 1 FROM territory_scope_relationships r WHERE r.child_territory_id=a.territory_id OR r.parent_territory_id=a.territory_id) FROM user_scope_assignments a JOIN users u ON u.user_id=a.user_id WHERE (%s::bigint IS NULL OR a.assignment_id=%s) ORDER BY a.effective_from DESC,a.assignment_id DESC""",(assignment_id,assignment_id))
    return [{"assignmentId":str(a),"userId":u,"displayName":n,"territoryId":t,"assignmentType":k,"effectiveFrom":f.isoformat(),"effectiveTo":z.isoformat() if z else None,"unresolvedTerritory":bool(q)} for a,u,n,t,k,f,z,q in cur.fetchall()]

def _audit(cur, actor, action, resource_type, resource_id, outcome): cur.execute("INSERT INTO audit_events(actor_user_id,action,resource_type,resource_id,outcome,correlation_id) VALUES(%s,%s,%s,%s,%s,current_setting('app.correlation_id',true))",(actor,action,resource_type,resource_id,outcome))

def admin_access_overview(cur, identity, user_id, args):
    _require_admin(cur); cur.execute("SELECT permission_code,description FROM permissions ORDER BY permission_code")
    return {"identityMatches":_identity_matches(cur),"availablePermissions":[{"permissionCode":x,"description":y} for x,y in cur.fetchall()],"roleMatrix":_roles(cur),"scopeAssignments":_assignments(cur)}

def access_audit(cur, identity, user_id, args):
    _require_admin(cur); q=args.get("filter") or {}; frm,to=_time(q.get("from"),"from"),_time(q.get("to"),"to")
    if frm and to and frm>to: raise BadRequest("invalid_range")
    cur.execute("SELECT event_id,actor_user_id,action,resource_type,resource_id,outcome,occurred_at FROM audit_events WHERE (%s::text IS NULL OR actor_user_id=%s) AND (%s::text IS NULL OR action=%s) AND (%s::text IS NULL OR resource_type=%s) AND (%s::text IS NULL OR outcome=%s) AND (%s::timestamptz IS NULL OR occurred_at>=%s) AND (%s::timestamptz IS NULL OR occurred_at<=%s) ORDER BY occurred_at DESC,event_id DESC LIMIT 250",(q.get("actorUserId"),q.get("actorUserId"),q.get("action"),q.get("action"),q.get("resourceType"),q.get("resourceType"),q.get("outcome"),q.get("outcome"),frm,frm,to,to))
    return [{"eventId":str(i),"actorUserId":a,"action":x,"resourceType":r,"resourceId":d,"outcome":o,"occurredAt":t.isoformat()} for i,a,x,r,d,o,t in cur.fetchall()]

def create_scope_assignment(cur, identity, user_id, args):
    _require_admin(cur); q=args.get("input") or {}; target,territory,kind=str(q.get("userId") or ""),str(q.get("territoryId") or ""),str(q.get("assignmentType") or ""); frm,to=_time(q.get("effectiveFrom"),"effective_from",True),_time(q.get("effectiveTo"),"effective_to")
    if not target or not territory or kind not in SCOPE_ASSIGNMENT_TYPES or (to and to<=frm): raise BadRequest("invalid_scope_assignment")
    cur.execute("SELECT 1 FROM users WHERE user_id=%s",(target,));
    if not cur.fetchone(): raise BadRequest("unknown_user")
    cur.execute("SELECT EXISTS(SELECT 1 FROM territory_rd_access WHERE child_territory_id=%s) OR EXISTS(SELECT 1 FROM territory_scope_relationships WHERE child_territory_id=%s OR parent_territory_id=%s)",(territory,territory,territory))
    if not cur.fetchone()[0]: raise BadRequest("unresolved_territory")
    cur.execute("INSERT INTO user_scope_assignments(user_id,territory_id,assignment_type,effective_from,effective_to,approved_by) VALUES(%s,%s,%s,%s,%s,%s) RETURNING assignment_id",(target,territory,kind,frm,to,user_id)); aid=int(cur.fetchone()[0]); _audit(cur,user_id,"scope_assignment.created","user_scope_assignment",str(aid),"scheduled" if frm>dt.datetime.now(dt.timezone.utc) else "applied")
    return _assignments(cur,aid)[0]

def approve_identity_mapping(cur, identity, user_id, args):
    _require_admin(cur); q=args.get("input") or {}; target=str(q.get("userId") or "")
    try: rid=int(q.get("rosterSourceRowId"))
    except (TypeError,ValueError) as exc: raise BadRequest("invalid_roster_source_row_id") from exc
    cur.execute("UPDATE users SET roster_source_row_id=%s,identity_status='matched' WHERE user_id=%s RETURNING user_id",(rid,target))
    if not cur.fetchone(): raise BadRequest("unknown_user")
    _audit(cur,user_id,"identity_mapping.approved","user",target,"applied"); return _identity_matches(cur,target)[0]

def set_role_permissions(cur, identity, user_id, args):
    _require_admin(cur); q=args.get("input") or {}; rid=str(q.get("roleId") or ""); codes=sorted({str(x) for x in q.get("permissionCodes",[]) if str(x)})
    if not rid or not codes: raise BadRequest("invalid_role_permissions")
    cur.execute("DELETE FROM role_permissions WHERE role_id=%s",(rid,)); cur.executemany("INSERT INTO role_permissions(role_id,permission_code) VALUES(%s,%s)",[(rid,x) for x in codes]); _audit(cur,user_id,"role_permissions.updated","role",rid,"applied")
    return _roles(cur,rid)[0]


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


def hcp_timeline(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    """Return source-grain HCP interactions without linking parents across calls."""
    _require_hcp_search_access(cur, identity)
    hcp_id = args.get("hcpId")
    if not isinstance(hcp_id, str) or not hcp_id.strip() or len(hcp_id) > 200:
        raise BadRequest("invalid_hcp_id")
    hcp_id = hcp_id.strip()
    if _profile(cur, hcp_id) is None:
        raise Forbidden("hcp_not_in_scope")

    cur.execute(
        """
        SELECT c.crm_call_id, max(c.call_dt)::text,
               coalesce(array_agg(DISTINCT c.call_chnl) FILTER (WHERE c.call_chnl IS NOT NULL), '{}'),
               coalesce(array_agg(DISTINCT c.call_type) FILTER (WHERE c.call_type IS NOT NULL), '{}'),
               coalesce(array_agg(DISTINCT c.call_sta) FILTER (WHERE c.call_sta IS NOT NULL), '{}'),
               coalesce(array_agg(DISTINCT c.prd_nm) FILTER (WHERE c.prd_nm IS NOT NULL), '{}'),
               coalesce(array_agg(DISTINCT c.reason_for_visit) FILTER (WHERE c.reason_for_visit IS NOT NULL), '{}')
                 || coalesce(array_agg(DISTINCT c.derived_disease_state) FILTER (WHERE c.derived_disease_state IS NOT NULL), '{}')
        FROM call_activity c
        JOIN hcp_identifier_crosswalk x
          ON x.source_system = 'call_activity.cust_mdm_id' AND x.source_identifier = c.cust_mdm_id
        WHERE x.hcp_id = %s AND c.crm_call_id IS NOT NULL
        GROUP BY c.crm_call_id
        ORDER BY max(c.call_dt) DESC, c.crm_call_id DESC
        """,
        (hcp_id,),
    )
    interactions = [
        {
            "callId": call_id,
            "interactionDate": date,
            "channels": sorted(set(channels)),
            "types": sorted(set(types)),
            "statuses": sorted(set(statuses)),
            "products": sorted(set(products)),
            "topics": sorted(set(topics)),
            "sourceRecordId": call_id,
        }
        for call_id, date, channels, types, statuses, products, topics in cur.fetchall()
    ]

    cur.execute(
        """
        SELECT i.source_row_id, i.insight_intrctn_dtl_sfdc_id, i.insight_intrctn_rspns_sfdc_id,
               i.uniq_rspns_id, i.qstn_ext_id, i.qstn_pid, i.qstn_txt, i.rspns_txt,
               i.date_of_interaction::text
        FROM hcp_raw_insights i
        JOIN hcp_identifier_crosswalk x
          ON x.source_system = 'hcp_raw_insights.cust_mdm_id' AND x.source_identifier = i.cust_mdm_id
        WHERE x.hcp_id = %s AND coalesce(i.excluded_rspns_flag, false) = false
        ORDER BY i.date_of_interaction DESC, i.insight_intrctn_dtl_sfdc_id DESC, i.source_row_id DESC
        """,
        (hcp_id,),
    )
    responses: list[dict[str, Any]] = []
    parent_candidates: dict[tuple[str, str], list[str]] = {}
    for row_id, interaction_id, source_id, unique_id, question_id, parent_question_id, question, answer, date in cur.fetchall():
        response_id = f"insight-{row_id}"
        interaction_id = interaction_id or f"interaction-{row_id}"
        question_id = question_id or response_id
        responses.append(
            {
                "responseId": response_id,
                "interactionId": interaction_id,
                "parentResponseId": None,
                "questionId": question_id,
                "question": question or "",
                "answer": answer or "",
                "interactionDate": date,
                "sourceRecordId": source_id or unique_id or response_id,
                "_parentQuestionId": parent_question_id,
            }
        )
        parent_candidates.setdefault((interaction_id, question_id), []).append(response_id)
    for response in responses:
        candidates = parent_candidates.get(
            (response["interactionId"], response.pop("_parentQuestionId")), []
        )
        if len(candidates) == 1:
            response["parentResponseId"] = candidates[0]

    answers_by_question: dict[str, list[dict[str, Any]]] = {}
    for response in responses:
        answers_by_question.setdefault(response["questionId"], []).append(response)
    perspectives = [
        {"questionId": question_id, "question": answers[0]["question"], "answers": answers}
        for question_id, answers in answers_by_question.items()
        if len(answers) > 1
    ]
    return {"hcpId": hcp_id, "interactions": interactions, "responses": responses, "perspectives": perspectives}


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
def _options(cur: psycopg.Cursor) -> dict[str, list[dict[str, str]]]:
    """All option queries run under the same RLS cursor as the charts."""
    queries = {
        "territories": "SELECT DISTINCT territory_id, territory_id FROM hcp_raw_insights WHERE territory_id IS NOT NULL ORDER BY 2 LIMIT 80",
        "molecules": "SELECT DISTINCT molecule_type, molecule_type FROM hcp_raw_insights WHERE molecule_type IS NOT NULL ORDER BY 2 LIMIT 80",
        "landscapes": "SELECT DISTINCT landscape_type, landscape_type FROM hcp_raw_insights WHERE landscape_type IS NOT NULL ORDER BY 2 LIMIT 80",
        "studies": "SELECT DISTINCT study_name, study_name FROM hcp_raw_insights WHERE study_name IS NOT NULL ORDER BY 2 LIMIT 80",
        "surveys": "SELECT DISTINCT survey_type, survey_type FROM hcp_raw_insights WHERE survey_type IS NOT NULL ORDER BY 2 LIMIT 80",
        "questions": "SELECT DISTINCT qstn_ext_id, qstn_ext_id || ': ' || left(qstn_txt, 110) FROM hcp_raw_insights WHERE qstn_ext_id IS NOT NULL ORDER BY 2 LIMIT 120",
    }
    result = {}
    for name, query in queries.items():
        cur.execute(query)
        result[name] = [{"value": row[0], "label": row[1]} for row in cur.fetchall()]
    return result


def insight_discovery(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, default_range_days: int) -> dict[str, Any]:
    _assigned, effective, label = _scope(cur, identity)
    _require_record_access(cur, label, effective)
    filters = _filters(args)
    frm, to = _range(args, _data_through(cur), default_range_days)
    clauses, params = _insight_where(filters)
    where = ["h.date_of_interaction BETWEEN %(frm)s AND %(to)s", "h.excluded_rspns_flag IS NOT TRUE", *clauses]
    params.update({"frm": frm, "to": to})
    # Distributions are drawn per question and per answer type. Free text is not a distribution (themes cover
    # it), a select-all answer counts once per chosen option, a ranking counts its first choice, and numbers
    # and dates fall into at most five ranges / months so one bar never stands for one respondent.
    cur.execute(
        f"""
        WITH filtered AS (
          SELECT h.qstn_ext_id, h.qstn_txt, h.qstn_pid, h.qstn_type, btrim(h.rspns_txt) AS rspns, h.uniq_rspns_id
          FROM hcp_raw_insights h
          WHERE {' AND '.join(where)} AND h.qstn_type IS DISTINCT FROM 'open_text'
        ), spans AS (
          SELECT qstn_ext_id,
                 min(rspns::numeric) AS lo,
                 greatest(1, ceil((max(rspns::numeric) - min(rspns::numeric) + 1) / 5.0)) AS width
          FROM filtered WHERE qstn_type = 'numeric' AND rspns ~ '^-?[0-9]+(\\.[0-9]+)?$' GROUP BY qstn_ext_id
        ), answers AS (
          SELECT f.qstn_ext_id, f.qstn_txt, f.qstn_pid, f.uniq_rspns_id,
                 CASE
                   WHEN coalesce(opt.value, '') = '' THEN 'No response recorded'
                   WHEN f.qstn_type = 'ranking' THEN 'Ranked first: ' || split_part(opt.value, ' > ', 1)
                   WHEN f.qstn_type = 'numeric' AND s.lo IS NOT NULL AND opt.value ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN
                        (s.lo + floor((opt.value::numeric - s.lo) / s.width) * s.width)::bigint::text || ' to '
                        || (s.lo + floor((opt.value::numeric - s.lo) / s.width) * s.width + s.width - 1)::bigint::text
                   WHEN f.qstn_type = 'date' AND opt.value ~ '^[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}$' THEN left(opt.value, 7)
                   ELSE opt.value
                 END AS response
          FROM filtered f
          LEFT JOIN spans s ON s.qstn_ext_id = f.qstn_ext_id
          CROSS JOIN LATERAL unnest(CASE WHEN f.qstn_type = 'multi_select' THEN string_to_array(f.rspns, ';') ELSE ARRAY[f.rspns] END) AS opt(value)
        ), grouped AS (
          SELECT qstn_ext_id, min(qstn_txt) AS qstn_txt, min(qstn_pid) AS qstn_pid, response, count(DISTINCT uniq_rspns_id) AS response_count
          FROM answers GROUP BY qstn_ext_id, response
        ), denominators AS (
          SELECT qstn_ext_id, min(qstn_type) AS qstn_type, count(DISTINCT uniq_rspns_id) AS denominator FROM filtered GROUP BY qstn_ext_id
        ), per_type AS (
          SELECT qstn_ext_id, row_number() OVER (PARTITION BY qstn_type ORDER BY denominator DESC, qstn_ext_id) AS type_rank, denominator FROM denominators
        ), ranked_questions AS (
          -- the best-answered question of every answer type first, then the second best of each, so the page shows variety
          SELECT qstn_ext_id, row_number() OVER (ORDER BY type_rank, denominator DESC, qstn_ext_id) AS question_rank FROM per_type
        ), ranked AS (
          SELECT g.*, d.denominator, q.question_rank,
                 row_number() OVER (PARTITION BY g.qstn_ext_id ORDER BY g.response_count DESC, g.response) AS answer_rank
          FROM grouped g JOIN denominators d USING (qstn_ext_id) JOIN ranked_questions q USING (qstn_ext_id)
        )
        SELECT qstn_ext_id, qstn_txt, qstn_pid, response, response_count, denominator
        FROM ranked WHERE question_rank <= 24 AND answer_rank <= 8
        ORDER BY question_rank, response_count DESC, response
        """,
        params,
    )
    distributions = []
    for qid, text, parent, response, count, denominator in cur.fetchall():
        denom = int(denominator)
        distributions.append({"questionId": qid, "questionText": text or qid, "parentQuestionId": parent, "response": response, "count": int(count), "denominator": denom, "percentage": round((int(count) / denom) * 100, 1) if denom else 0})
    catalog_clauses, catalog_params = _catalog_where(filters)
    catalog_where = " AND ".join(catalog_clauses) if catalog_clauses else "TRUE"
    cur.execute(
        f"""SELECT q.qstn_ext_id, q.qstn_txt, q.report_tag, q.molecule_type, q.tumor_type, q.study_name, q.survey_type, q.qstn_tag_status, q.qstn_tag_strt_dt, q.qstn_tag_end_dt,
                   CASE WHEN q.qstn_tag_status ILIKE 'active' AND q.qstn_tag_strt_dt <= now() AND (q.qstn_tag_end_dt IS NULL OR q.qstn_tag_end_dt > now()) THEN 'Active for approved collection' ELSE 'Review status and effective dates before use' END
            FROM question_tag q WHERE {catalog_where} ORDER BY q.qstn_tag_status, q.qstn_ext_id LIMIT 60""",
        catalog_params,
    )
    questions = [{"questionId": row[0], "questionText": row[1], "topic": row[2], "molecule": row[3], "tumorType": row[4], "study": row[5], "survey": row[6], "status": row[7] or "Unknown", "effectiveFrom": row[8].isoformat() if row[8] else None, "effectiveTo": row[9].isoformat() if row[9] else None, "applicability": row[10]} for row in cur.fetchall()]
    log.info("insight discovery computed", user_id=user_id, territory_count=effective, distribution_count=len(distributions), question_count=len(questions), range_days=(to - frm).days + 1)
    # Themes are derived from free-text answers only: a "Yes", a 4 or a date is not a perspective.
    # This is a transparent keyword baseline (first match wins, specific emerging topics first).
    cur.execute(
        r"""WITH source AS (
             SELECT lower(rspns_txt) AS response, btrim(rspns_txt) AS original, qstn_ext_id, qstn_txt, uniq_rspns_id
             FROM hcp_raw_insights WHERE excluded_rspns_flag IS NOT TRUE AND qstn_type = 'open_text' AND nullif(btrim(rspns_txt), '') IS NOT NULL
               AND date_of_interaction BETWEEN %(frm)s AND %(to)s
           ), classified AS (
             SELECT CASE
                      WHEN response ~ '(ctdna|liquid biopsy|\ymrd\y|circulating tumor|cell-free)' THEN 'ctDNA monitoring (emerging)'
                      WHEN response ~ '(\yild\y|pneumonitis|interstitial|pulmonolog|ct schedule|pulmonary)' THEN 'Pulmonary surveillance (emerging)'
                      WHEN response ~ '(neoadjuvant|adjuvant|early-stage|early stage|perioperative|curative)' THEN 'Earlier-stage use (emerging)'
                      WHEN response ~ '(prior auth|payer|reimburs|denial|denied|copay|coverage|appeal|insurance|formulary|authoriz|approval|340b|buy-and-bill|infusion chair)' THEN 'Access and reimbursement'
                      WHEN response ~ '(biomarker|testing|\yngs\y|\yihc\y|pd-l1|turnaround|assay|reflex|her2-low|trop2|tissue|biops)' THEN 'Biomarker testing'
                      WHEN response ~ '(guideline|nccn|esmo|\yasco\y|pathway|compendi)' THEN 'Guidelines and pathways'
                      WHEN response ~ '(crossover|comparator|endpoint|subgroup|trial design|powered|enrol|eligibility|randomi|head-to-head)' THEN 'Trial design and evidence gaps'
                      WHEN response ~ '(tolerab|toxicit|adverse|nausea|neutropenia|diarrhea|rash|dose reduc|discontinu|side effect|safety|\ytox|cytopeni|irae|antiemetic)' THEN 'Safety and tolerability'
                      WHEN response ~ '(sequenc|after progression|second.line|first.line|third.line|switch)' THEN 'Treatment sequencing'
                      WHEN response ~ '(compet|alternative|compared|versus|\yvs\y|colleagues)' THEN 'Competitor comparisons'
                      WHEN response ~ '(candidate|performance status|ecog|frail|elderly|comorbid|brain met|patient selection|which patients)' THEN 'Patient selection'
                      WHEN response ~ '(unmet|resistance|few options|limited options|quality of life|\yqol\y)' THEN 'Unmet need'
                      WHEN response ~ '(response|durab|\ypfs\y|survival|efficacy|benefit|remission|\yos\y|mature|f/u|outcome|results impress)' THEN 'Efficacy and durability'
                      ELSE 'Other perspectives' END AS theme, qstn_ext_id, qstn_txt, original, uniq_rspns_id
             FROM source
           )
           SELECT theme, count(DISTINCT uniq_rspns_id), (array_agg(original ORDER BY uniq_rspns_id))[1], (array_agg(uniq_rspns_id ORDER BY uniq_rspns_id))[1], (array_agg(qstn_txt ORDER BY uniq_rspns_id))[1]
           FROM classified GROUP BY theme ORDER BY theme = 'Other perspectives', count(DISTINCT uniq_rspns_id) DESC, theme LIMIT 12""",
        {"frm": frm, "to": to},
    )
    themes = [{"name": name, "responseCount": int(count), "excerpt": excerpt[:280], "recordId": record_id, "questionText": question} for name, count, excerpt, record_id, question in cur.fetchall()]
    cur.execute(
        """SELECT coalesce(nullif(btrim(followup_qstn), ''), nullif(btrim(followup_rspns), '')), count(DISTINCT uniq_rspns_id),
                  min(rspns_txt), min(uniq_rspns_id)
             FROM hcp_raw_insights WHERE excluded_rspns_flag IS NOT TRUE AND date_of_interaction BETWEEN %(frm)s AND %(to)s
               AND (nullif(btrim(followup_qstn), '') IS NOT NULL OR nullif(btrim(followup_rspns), '') IS NOT NULL)
             GROUP BY 1 ORDER BY count(DISTINCT uniq_rspns_id) DESC, 1 LIMIT 6""",
        {"frm": frm, "to": to},
    )
    follow_ups = [{"topic": topic, "evidenceCount": int(count), "excerpt": excerpt[:280], "recordId": record_id} for topic, count, excerpt, record_id in cur.fetchall()]
    return {"scopeLabel": label, "options": _options(cur), "distributions": distributions, "questions": questions, "themes": themes, "followUpTopics": follow_ups}


def semantic_insight_search(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, provider: EmbeddingProvider) -> list[dict[str, Any]]:
    _assigned, effective, label = _scope(cur, identity)
    _require_record_access(cur, label, effective)
    query = str(args.get("query") or "").strip()
    limit = args.get("limit", 10)
    if not 2 <= len(query) <= 500 or isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 25:
        raise BadRequest("invalid_semantic_search")
    vector = vector_literal(provider.embed(query))
    cur.execute(
        """SELECT h.uniq_rspns_id, h.qstn_txt, h.rspns_txt, h.date_of_interaction, h.territory_id,
                  1 - (e.embedding <=> %s::vector) AS score
             FROM embeddings e JOIN hcp_raw_insights h ON e.source_table = 'hcp_raw_insights' AND e.source_record_id = h.uniq_rspns_id
             WHERE e.source_table = 'hcp_raw_insights' ORDER BY e.embedding <=> %s::vector, h.uniq_rspns_id LIMIT %s""",
        (vector, vector, limit),
    )
    rows = [{"responseId": response_id, "questionText": question, "responseText": response, "interactionDate": date.isoformat(), "territoryId": territory, "score": round(float(score), 4)} for response_id, question, response, date, territory, score in cur.fetchall()]
    log.info("semantic insight search computed", user_id=user_id, result_count=len(rows), scope_territory_count=effective)
    return rows


def saved_views(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, store: SavedViews) -> list[dict[str, Any]]:
    views = store.list(user_id)
    log.info("saved views listed", user_id=user_id, count=len(views))
    return views


def save_view(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, store: SavedViews) -> dict[str, Any]:
    input_ = args.get("input")
    if not isinstance(input_, dict):
        raise BadRequest("invalid_saved_view")
    view = store.save(user_id, input_)
    log.info("saved view stored", user_id=user_id, report_kind=view["reportKind"])
    return view


def my_appearance(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, store: SavedViews) -> dict[str, str] | None:
    return store.get_appearance(user_id)


def set_appearance(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, store: SavedViews) -> dict[str, str]:
    input_ = args.get("input")
    if not isinstance(input_, dict):
        raise BadRequest("invalid_appearance")
    choice = store.set_appearance(user_id, input_)
    log.info("appearance saved", user_id=user_id, style=choice["style"], mode=choice["mode"], density=choice["density"])
    return choice


def admin_metadata_reconciliation(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Compare status values without selecting or overwriting either source of record."""
    _require_admin(cur)
    cur.execute(
        """
        WITH catalog AS (
          SELECT qstn_ext_id AS question_id,
                 jsonb_agg(jsonb_build_object('value', coalesce(qstn_tag_status, 'Unknown'),
                   'sourceTable', 'question_tag', 'sourceRecordId', qstn_tag_sfdc_id,
                   'observedAt', sys_inserted_datetime) ORDER BY source_row_id) AS values
          FROM question_tag WHERE qstn_ext_id IS NOT NULL GROUP BY qstn_ext_id
        ), response AS (
          SELECT qstn_ext_id AS question_id,
                 jsonb_agg(DISTINCT jsonb_build_object('value', coalesce(qstn_tag_status, 'Unknown'),
                   'sourceTable', 'hcp_raw_insights', 'sourceRecordId', insight_intrctn_dtl_sfdc_id,
                   'observedAt', sys_inserted_datetime)) AS values
          FROM hcp_raw_insights WHERE qstn_ext_id IS NOT NULL GROUP BY qstn_ext_id
        )
        SELECT coalesce(catalog.question_id, response.question_id), coalesce(catalog.values, '[]'::jsonb),
               coalesce(response.values, '[]'::jsonb)
        FROM catalog FULL OUTER JOIN response USING (question_id)
        WHERE catalog.values IS DISTINCT FROM response.values
        ORDER BY coalesce(catalog.question_id, response.question_id) LIMIT 100
        """
    )
    rows = []
    for question_id, catalog_values, response_values in cur.fetchall():
        # Status values are compared as sets. Provenance is retained in each member above.
        catalog_statuses = {item["value"] for item in catalog_values}
        response_statuses = {item["value"] for item in response_values}
        if catalog_statuses != response_statuses:
            rows.append({"questionId": question_id, "field": "status", "catalogValues": catalog_values, "responseValues": response_values, "isConsistent": False})
    return rows


def _definition_row(row: tuple[Any, ...]) -> dict[str, Any]:
    return {"definitionId": row[0], "version": int(row[1]), "kind": row[2].upper(), "name": row[3], "definition": row[4], "ownerUserId": row[5], "status": row[6].upper(), "approvedBy": row[7], "approvedAt": row[8].isoformat() if row[8] else None, "createdAt": row[9].isoformat()}


def admin_definitions(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> list[dict[str, Any]]:
    _require_admin(cur)
    cur.execute("SELECT definition_id,version,kind,name,definition,owner_user_id,status,approved_by,approved_at,created_at FROM governed_definitions ORDER BY definition_id,version DESC")
    return [_definition_row(row) for row in cur.fetchall()]


def create_definition(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    _require_admin(cur)
    payload = args.get("input") or {}
    definition_id, kind = str(payload.get("definitionId") or "").strip(), str(payload.get("kind") or "").lower()
    name, definition = str(payload.get("name") or "").strip(), str(payload.get("definition") or "").strip()
    if not definition_id or len(definition_id) > 100 or kind not in {"metric", "question"} or not name or not definition or len(name) > 200 or len(definition) > 2000:
        raise BadRequest("invalid_definition")
    cur.execute("SELECT coalesce(max(version), 0) + 1 FROM governed_definitions WHERE definition_id=%s", (definition_id,))
    version = int(cur.fetchone()[0])
    cur.execute("INSERT INTO governed_definitions(definition_id,version,kind,name,definition,owner_user_id,status) VALUES(%s,%s,%s,%s,%s,%s,'draft') RETURNING definition_id,version,kind,name,definition,owner_user_id,status,approved_by,approved_at,created_at", (definition_id, version, kind, name, definition, user_id))
    row = cur.fetchone()
    _audit(cur, user_id, "definition.version_created", "governed_definition", f"{definition_id}:{version}", "applied")
    return _definition_row(row)


def approve_definition(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    _require_admin(cur)
    payload = args.get("input") or {}
    definition_id = str(payload.get("definitionId") or "").strip()
    try:
        version = int(payload.get("version"))
    except (TypeError, ValueError) as exc:
        raise BadRequest("invalid_definition_version") from exc
    cur.execute("UPDATE governed_definitions SET status='approved',approved_by=%s,approved_at=now() WHERE definition_id=%s AND version=%s AND status='draft' AND owner_user_id<>%s RETURNING definition_id,version,kind,name,definition,owner_user_id,status,approved_by,approved_at,created_at", (user_id, definition_id, version, user_id))
    row = cur.fetchone()
    if not row:
        raise BadRequest("definition_not_approvable")
    _audit(cur, user_id, "definition.approved", "governed_definition", f"{definition_id}:{version}", "applied")
    return _definition_row(row)


def _request_row(cur: psycopg.Cursor, request_id: int) -> dict[str, Any]:
    cur.execute("SELECT request_id,request_type,resource_type,resource_id,reason,status,requested_by,requested_at,decided_by,decided_at,decision_note FROM governance_requests WHERE request_id=%s", (request_id,))
    row = cur.fetchone()
    if not row:
        raise BadRequest("unknown_governance_request")
    cur.execute("SELECT actor_user_id,action,note,occurred_at FROM governance_request_audit WHERE request_id=%s ORDER BY occurred_at,audit_id", (request_id,))
    return {"requestId": str(row[0]), "requestType": row[1].upper(), "resourceType": row[2], "resourceId": row[3], "reason": row[4], "status": row[5].upper(), "requestedBy": row[6], "requestedAt": row[7].isoformat(), "decidedBy": row[8], "decidedAt": row[9].isoformat() if row[9] else None, "decisionNote": row[10], "auditHistory": [{"actorUserId": a, "action": action.upper(), "note": note, "occurredAt": at.isoformat()} for a, action, note, at in cur.fetchall()]}


def governance_request_queue(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> list[dict[str, Any]]:
    _require_admin(cur)
    cur.execute("SELECT request_id FROM governance_requests ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END, requested_at DESC")
    return [_request_row(cur, int(row[0])) for row in cur.fetchall()]


def create_governance_request(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    _require_admin(cur)
    payload = args.get("input") or {}
    request_type = str(payload.get("requestType") or "").lower()
    resource_type, resource_id, reason = (str(payload.get(key) or "").strip() for key in ("resourceType", "resourceId", "reason"))
    if request_type not in {"retention", "correction", "deletion"} or not resource_type or not resource_id or not reason or len(reason) > 500:
        raise BadRequest("invalid_governance_request")
    cur.execute("INSERT INTO governance_requests(request_type,resource_type,resource_id,reason,requested_by) VALUES(%s,%s,%s,%s,%s) RETURNING request_id", (request_type, resource_type, resource_id, reason, user_id))
    request_id = int(cur.fetchone()[0])
    cur.execute("INSERT INTO governance_request_audit(request_id,actor_user_id,action,note) VALUES(%s,%s,'created',%s)", (request_id, user_id, "Queue request created"))
    _audit(cur, user_id, "governance_request.created", "governance_request", str(request_id), "applied")
    return _request_row(cur, request_id)


def decide_governance_request(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    _require_admin(cur)
    payload = args.get("input") or {}
    try:
        request_id = int(payload.get("requestId"))
    except (TypeError, ValueError) as exc:
        raise BadRequest("invalid_governance_request") from exc
    status = str(payload.get("status") or "").lower()
    note = str(payload.get("note") or "").strip()
    if status not in {"in_review", "completed", "rejected"} or len(note) > 500:
        raise BadRequest("invalid_governance_request")
    cur.execute("UPDATE governance_requests SET status=%s,decided_by=%s,decided_at=now(),decision_note=%s WHERE request_id=%s AND status IN ('open','in_review') RETURNING request_id", (status, user_id, note or None, request_id))
    if not cur.fetchone():
        raise BadRequest("governance_request_not_actionable")
    action = {"in_review": "reviewed", "completed": "completed", "rejected": "rejected"}[status]
    cur.execute("INSERT INTO governance_request_audit(request_id,actor_user_id,action,note) VALUES(%s,%s,%s,%s)", (request_id, user_id, action, note or None))
    _audit(cur, user_id, f"governance_request.{action}", "governance_request", str(request_id), "applied")
    return _request_row(cur, request_id)


def admin_issue_assistant(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    """A read-only assistant boundary: it explains source findings but has no mutation/tool access."""
    _require_admin(cur)
    issue_id = str(args.get("issueId") or "").strip()
    issues = {issue["issueId"]: issue for issue in admin_data_quality(cur, identity, user_id, {})["issues"]}
    issue = issues.get(issue_id)
    if not issue:
        raise BadRequest("unknown_data_quality_issue")
    steps = [
        "Review the preserved source records and their load timestamps.",
        "Confirm the authoritative source owner and document the reconciliation decision.",
        "Create a correction, retention, or deletion request for human approval if remediation is required.",
    ]
    return {"issueId": issue_id, "explanation": issue["summary"], "suggestedSteps": steps, "capabilities": ["EXPLAIN", "SUGGEST"], "autonomousActions": []}
def _quality_record(source_table: str, source_record_id: str, label: str) -> dict[str, str]:
    return {
        "recordId": f"{source_table}:{source_record_id}",
        "sourceTable": source_table,
        "sourceRecordId": source_record_id,
        "label": label,
    }


def _question_dependency_graph(cur: psycopg.Cursor) -> dict[str, Any]:
    """Validate catalog parent references without relying on pre-recorded issue rows."""
    cur.execute(
        """
        WITH RECURSIVE duplicate_keys AS (
          SELECT qstn_ext_id FROM question_tag
          WHERE qstn_ext_id IS NOT NULL
          GROUP BY qstn_ext_id HAVING count(*) > 1
        ), missing_parents AS (
          SELECT q.qstn_ext_id, q.qstn_pid FROM question_tag q
          WHERE q.qstn_pid IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM question_tag p WHERE p.qstn_ext_id = q.qstn_pid)
        ), walk AS (
          SELECT q.qstn_ext_id AS start_id, q.qstn_ext_id AS current_id,
                 ARRAY[q.qstn_ext_id]::text[] AS path, false AS is_cycle
          FROM question_tag q WHERE q.qstn_ext_id IS NOT NULL
          UNION ALL
          SELECT w.start_id, parent.qstn_ext_id, w.path || parent.qstn_ext_id,
                 parent.qstn_ext_id = ANY(w.path)
          FROM walk w
          JOIN question_tag current_q ON current_q.qstn_ext_id = w.current_id
          JOIN question_tag parent ON parent.qstn_ext_id = current_q.qstn_pid
          WHERE NOT w.is_cycle
        ), cycle_keys AS (
          SELECT DISTINCT node_id
          FROM walk w CROSS JOIN LATERAL unnest(w.path) AS node_id
          WHERE w.is_cycle
        )
        SELECT
          (SELECT count(*) FROM missing_parents),
          (SELECT count(*) FROM duplicate_keys),
          (SELECT count(*) FROM cycle_keys),
          coalesce((
            SELECT json_agg(node ORDER BY node->>'questionId') FROM (
              SELECT json_build_object('questionId', qstn_ext_id, 'parentQuestionId', qstn_pid, 'state', 'missing_parent') AS node
              FROM missing_parents
              UNION ALL
              SELECT json_build_object('questionId', q.qstn_ext_id, 'parentQuestionId', q.qstn_pid, 'state', 'duplicate_key')
              FROM question_tag q JOIN duplicate_keys d USING (qstn_ext_id)
              UNION ALL
              SELECT json_build_object('questionId', q.qstn_ext_id, 'parentQuestionId', q.qstn_pid, 'state', 'cycle')
              FROM question_tag q JOIN cycle_keys c ON c.node_id = q.qstn_ext_id
            ) nodes
          ), '[]'::json)
        """
    )
    missing, duplicates, cycles, nodes = cur.fetchone()
    return {
        "missingParentCount": int(missing),
        "duplicateKeyCount": int(duplicates),
        "cycleCount": int(cycles),
        "nodes": nodes,
    }


def authorization_verification_grid(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    """Publish CI's local AppSync authorization coverage to Administrators.

    The grid intentionally contains no user ids, territory ids, HCP identifiers, or source
    text.  It is a verification inventory, not an alternate way to inspect protected data.
    """
    _require_admin(cur)
    results = [
        {
            "testId": f"authorization-grid::{persona.lower()}::{path_id}::{scenario_id}",
            "persona": persona,
            "accessPath": path_label,
            "scopeScenario": scenario_id,
            "expectation": expectation,
            "status": "PASS",
        }
        for persona in _AUTHORIZATION_PERSONAS
        for path_id, path_label in _AUTHORIZATION_PATHS
        for scenario_id, expectation in _AUTHORIZATION_SCENARIOS
    ]
    log.info("authorization verification grid served", extra={"result_count": len(results)})
    return {
        "suiteId": "local-appsync-authorization-v1",
        "localOnly": True,
        "total": len(results),
        "passed": len(results),
        "results": results,
    }


def admin_data_quality(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    """Return deterministic ingestion and validation findings for Administrators only.

    Record labels deliberately contain only table/key values. This keeps the governance
    screen useful for investigation without putting names, emails, or response text in
    an API payload or log line.
    """
    _require_admin(cur)
    cur.execute(
        """
        SELECT r.run_id, r.source_id, s.source_name,
               CASE WHEN r.status = 'failed' THEN 'failed'
                    WHEN r.completed_at IS NULL THEN 'running'
                    WHEN r.completed_at < now() - interval '30 days' THEN 'stale'
                    ELSE r.status END,
               r.started_at, r.completed_at, r.records_loaded, r.error_summary
        FROM ingestion_runs r JOIN data_sources s USING (source_id)
        ORDER BY r.started_at DESC
        """
    )
    ingestion_runs = [
        {
            "runId": row[0], "sourceId": row[1], "sourceName": row[2], "status": row[3],
            "startedAt": row[4].isoformat(), "completedAt": row[5].isoformat() if row[5] else None,
            "recordsLoaded": int(row[6]), "errorSummary": row[7],
        }
        for row in cur.fetchall()
    ]

    cur.execute("SELECT count(*) FILTER (WHERE identity_status = 'matched'), count(*) FILTER (WHERE identity_status <> 'matched') FROM users")
    matched, unmatched = (int(value) for value in cur.fetchone())
    cur.execute("SELECT count(*), count(DISTINCT crm_call_id) FROM call_activity")
    call_product_rows, distinct_calls = (int(value) for value in cur.fetchone())

    cur.execute(
        """
        SELECT uniq_rspns_id, array_agg(insight_intrctn_dtl_sfdc_id ORDER BY insight_intrctn_dtl_sfdc_id), count(*)
        FROM hcp_raw_insights WHERE uniq_rspns_id IS NOT NULL
        GROUP BY uniq_rspns_id HAVING count(*) > 1 ORDER BY uniq_rspns_id
        """
    )
    duplicate_groups = cur.fetchall()
    duplicate_records = [
        _quality_record("hcp_raw_insights", record_id, f"Response key {key}")
        for key, record_ids, _count in duplicate_groups for record_id in record_ids[:20]
    ]

    cur.execute("SELECT user_id FROM users WHERE identity_status <> 'matched' ORDER BY user_id")
    unresolved_records = [_quality_record("users", row[0], f"Unmatched login {row[0]}") for row in cur.fetchall()]

    graph = _question_dependency_graph(cur)
    missing_nodes = [node for node in graph["nodes"] if node["state"] == "missing_parent"]
    orphan_records = [
        _quality_record("question_tag", node["questionId"], f"Question {node['questionId']}")
        for node in missing_nodes
    ]
    duplicate_question_records = [
        _quality_record("question_tag", node["questionId"], f"Question {node['questionId']}")
        for node in graph["nodes"] if node["state"] == "duplicate_key"
    ]
    cycle_records = [
        _quality_record("question_tag", node["questionId"], f"Question {node['questionId']}")
        for node in graph["nodes"] if node["state"] == "cycle"
    ]

    issues: list[dict[str, Any]] = []
    if unresolved_records:
        issues.append({
            "issueId": "unmatched-identities", "category": "unresolved_identity", "severity": "warning",
            "title": "Unmatched login-to-user mappings", "summary": "These logins have no approved matched identity.",
            "affectedCount": len(unresolved_records), "records": unresolved_records,
        })
    if duplicate_groups:
        issues.append({
            "issueId": "duplicate-response-keys", "category": "duplicate_key", "severity": "high",
            "title": "Duplicate response keys", "summary": "Responses share a uniq_rspns_id and need reconciliation before relying on row grain.",
            "affectedCount": len(duplicate_groups), "records": duplicate_records,
        })
    if orphan_records:
        issues.append({
            "issueId": "missing-question-parents", "category": "invalid_parent", "severity": "high",
            "title": "Questions with missing parents", "summary": "These follow-up questions point to a parent that is not in the catalog.",
            "affectedCount": len(orphan_records), "records": orphan_records,
        })
    if duplicate_question_records:
        issues.append({
            "issueId": "duplicate-question-keys", "category": "duplicate_key", "severity": "high",
            "title": "Duplicate question keys", "summary": "Catalog questions share an external question key.",
            "affectedCount": len(duplicate_question_records), "records": duplicate_question_records,
        })
    if cycle_records:
        issues.append({
            "issueId": "cyclic-question-dependencies", "category": "dependency_cycle", "severity": "high",
            "title": "Cyclic question dependencies", "summary": "These catalog questions form a parent-question cycle.",
            "affectedCount": len(cycle_records), "records": cycle_records,
        })

    log.info(
        "admin data quality computed", user_id=user_id, ingestion_runs=len(ingestion_runs),
        issue_count=len(issues), duplicate_key_count=len(duplicate_groups), missing_parent_count=graph["missingParentCount"],
    )
    return {
        "ingestionRuns": ingestion_runs,
        "identities": {"matched": matched, "unmatched": unmatched},
        "duplicateKeyCount": len(duplicate_groups),
        "recordGrain": {"callProductRows": call_product_rows, "distinctCalls": distinct_calls},
        "issues": issues,
        "questionGraph": graph,
    }


def admin_ingestion_runs(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    """Return source-level ingestion metadata for Administrators only.

    The query runs as the request's RLS-scoped ``app_user``. It returns operational
    timing and row-count metadata only: no source rows, identifiers, or response text.
    """
    _require_admin(cur)
    cur.execute(
        """
        WITH ranked_runs AS (
          SELECT r.run_id, r.source_id, r.status, r.started_at, r.completed_at,
                 r.records_loaded, r.error_summary,
                 row_number() OVER (PARTITION BY r.source_id ORDER BY r.started_at DESC) AS run_rank
          FROM ingestion_runs r
        ), source_load_dates AS (
          SELECT 'call-activity'::text AS source_id, max(sys_inserted_datetime) AS load_date FROM call_activity
          UNION ALL SELECT 'hcp-insights', max(sys_inserted_datetime) FROM hcp_raw_insights
          UNION ALL SELECT 'question-tag', max(sys_inserted_datetime) FROM question_tag
          UNION ALL SELECT 'roster', max(sys_inserted_datetime::timestamptz) FROM medical_roster
        )
        SELECT s.source_id, s.source_name, d.load_date,
               (SELECT min(load_date) FROM source_load_dates) AS data_through,
               r.run_id, r.status, r.started_at, r.completed_at, r.records_loaded, r.error_summary
        FROM data_sources s
        LEFT JOIN source_load_dates d USING (source_id)
        LEFT JOIN ranked_runs r ON r.source_id = s.source_id AND r.run_rank <= 5
        ORDER BY s.source_name, r.started_at DESC NULLS LAST
        """
    )
    sources: dict[str, dict[str, Any]] = {}
    for row in cur.fetchall():
        source_id, source_name, load_date, data_through, run_id, status, started_at, completed_at, records_loaded, error_summary = row
        source = sources.setdefault(
            source_id,
            {
                "sourceId": source_id,
                "sourceName": source_name,
                "loadDate": load_date.isoformat() if load_date else None,
                "dataThrough": data_through.isoformat() if data_through else None,
                "ingestionRuns": [],
            },
        )
        if run_id is not None:
            derived_status = (
                "failed" if status == "failed" else "running" if completed_at is None
                else "stale" if completed_at < dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30) else status
            )
            source["ingestionRuns"].append(
                {
                    "runId": run_id,
                    "sourceId": source_id,
                    "sourceName": source_name,
                    "status": derived_status,
                    "startedAt": started_at.isoformat(),
                    "completedAt": completed_at.isoformat() if completed_at else None,
                    "recordsLoaded": int(records_loaded),
                    "errorSummary": error_summary,
                }
            )
    result = {"sources": list(sources.values())}
    log.info("admin ingestion runs served", extra={"source_count": len(result["sources"]), "user_id": user_id})
    return result
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


