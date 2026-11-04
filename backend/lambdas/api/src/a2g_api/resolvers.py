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
