"""Director team/territory overview and side-by-side territory comparisons. Every number is SQL under RLS.

Access: ``team.overview.read`` (Directors; administrators pass through ``admin.manage``). The rows a
Director can read are decided by Postgres row-level security over effective-dated scope assignments
and the territory hierarchy (docs/adr/0003), so only approved descendant territories are ever seen.
Territory metadata comes from ``territory_geography``, whose policy applies the same scope.

Metric definitions (identical for the overview and for comparisons, version ``DEFINITION_VERSION``):

* distinctCalls: ``COUNT(DISTINCT crm_call_id)`` over Call Activity rows whose ``call_dt`` is in the
  window. ``crm_call_id`` repeats once per product, so raw rows are never called calls. The number
  of such rows is returned separately as ``callProductRows``.
* distinctEngagedHcps: ``COUNT(DISTINCT cust_mdm_id)`` over the same rows. Not additive across
  territories or months: an HCP engaged by two territories counts once in the scope total.
* responseCount: ``COUNT(DISTINCT uniq_rspns_id)`` of HCP insight rows with ``date_of_interaction``
  in the window, excluding ``excluded_rspns_flag`` rows.
* reportingMembers: ``COUNT(DISTINCT crm_call_user_id)`` over calls in the window. A call with no
  recorded team member is counted in ``unattributedCalls``, never silently dropped or guessed.
* reportingCompleteness: months in the window with at least one recorded call, divided by the
  months in the window that data-through has reached, per member; a territory pools its members.
  It measures whether reporting happened, not how well anyone performed.
* mix (channel, topic, disease state, product): distinct calls per value. A call recorded under
  several values counts once in each, so a dimension's values can sum to more than its distinct
  calls; ``valueTotal`` (the sum, i.e. "mentions") is returned apart from ``totalDistinctCalls``.
* coverage: engaged target HCPs divided by the approved, in-effect target population of the
  territory (``target_assignments``, status ``approved``, in effect at the end of the window). With
  no target population coverage is withheld (``NO_TARGET_POPULATION``), never estimated.
* Interaction date vs load date: ``call_dt`` is when the exchange happened;
  ``sys_inserted_datetime`` is when the record reached this system. ``dataThrough`` is a load date.
"""

from __future__ import annotations

import datetime as dt
import re
from collections import defaultdict
from collections.abc import Mapping
from typing import Any

import psycopg

from a2g_logging import get_logger

from .activity import UNSPECIFIED, _add_months, _as_date, _month_end, _month_start
from .errors import BadRequest, Forbidden, NoScope
from .identity import Identity
from .resolvers import _data_through, _parse_date, _scope

log = get_logger(__name__)

DEFINITION_VERSION = "team-overview-v1"
MAX_WINDOW_DAYS = 366
DEFAULT_WINDOW_DAYS = 90
MAX_MEMBERS = 200
MAX_MIX_VALUES = 8
MIN_COMPARE, MAX_COMPARE = 2, 6

DEFINITIONS = [
    ("distinctCalls", "Distinct calls", "Each call counted once by its call id, however many products it covers."),
    ("callProductRows", "Call-product rows", "Source rows: one per product discussed. Never reported as calls."),
    ("distinctEngagedHcps", "Distinct engaged HCPs", "Each HCP reached at least once in the period, counted once."),
    ("responseCount", "Responses", "Recorded insight responses in the period, excluding responses flagged as excluded."),
    ("reportingMembers", "Reporting team members", "Team members with at least one recorded call in the period."),
    (
        "reportingCompleteness",
        "Reporting completeness",
        "Months with at least one recorded call divided by the months in the period that data has reached. "
        "It describes reporting, not performance.",
    ),
    (
        "coverage",
        "Coverage",
        "Engaged target HCPs divided by the approved target population. Withheld when no approved target population exists.",
    ),
]

_CHANNEL = "coalesce(nullif(btrim(call_chnl), ''), 'Unspecified')"
_MIX = {
    "CHANNEL": ("Channel", _CHANNEL),
    "TOPIC": ("Topic (reason for visit)", "coalesce(nullif(btrim(reason_for_visit), ''), 'Unspecified')"),
    "DISEASE_STATE": ("Disease state", "coalesce(nullif(btrim(derived_disease_state), ''), 'Unspecified')"),
    "PRODUCT": ("Product (mentions)", "coalesce(nullif(btrim(prd_nm), ''), 'Unspecified')"),
}
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TERRITORY_ID = re.compile(r"^[A-Za-z0-9_.-]{1,40}$")


def _require_team_overview(cur: psycopg.Cursor, label: str, effective: int) -> bool:
    """Returns True for an administrator. Refuses callers without the team-overview permission."""
    cur.execute("SELECT app.has_permission('team.overview.read'), app.has_permission('admin.manage')")
    can_overview, is_admin = (bool(v) for v in cur.fetchone())
    if not (can_overview or is_admin):
        raise Forbidden("team_overview_required")
    cur.execute("SELECT app.has_permission('source.records.read')")
    if not cur.fetchone()[0]:
        raise Forbidden("team_overview_requires_records")
    if effective == 0 and not is_admin:
        raise NoScope("no_effective_scope")
    return is_admin


def _window(args: Mapping[str, Any], data_through: dt.datetime | None) -> tuple[dt.date, dt.date]:
    to = _parse_date(args.get("to"), "to") or (_as_date(data_through) if data_through else dt.date.today())
    frm = _parse_date(args.get("from"), "from") or (to - dt.timedelta(days=DEFAULT_WINDOW_DAYS - 1))
    if frm > to or (to - frm).days + 1 > MAX_WINDOW_DAYS:
        raise BadRequest("invalid_range")
    return frm, to


def _window_months(frm: dt.date, to: dt.date, through_day: dt.date) -> list[dict[str, Any]]:
    """Calendar months touched by the window that data-through has reached. A month is partial when
    the window or the load date cuts it short."""
    last = min(to, through_day)
    months: list[dict[str, Any]] = []
    cursor = _month_start(frm)
    while cursor <= last:
        start_cut = frm > cursor
        end_cut = last < _month_end(cursor)
        months.append({"month": cursor, "isPartial": start_cut or end_cut})
        cursor = _add_months(cursor, 1)
    return months


def _roster(cur: psycopg.Cursor, tids: list[str], frm: dt.date, to: dt.date):
    """Roster rows in effect during the window. Rows whose dates do not parse are counted apart."""
    cur.execute(
        "SELECT territory_id, vva_user_id, full_name, start_date, end_date FROM medical_roster WHERE territory_id = ANY(%s)",
        (tids,),
    )
    in_effect: dict[str, set[str]] = defaultdict(set)
    names: dict[str, str] = {}
    date_issues = 0
    for tid, vva, full_name, start, end in cur.fetchall():
        if not vva:
            continue
        try:
            start_d = dt.date.fromisoformat(start) if start and _ISO.match(start) else None
            end_d = dt.date.fromisoformat(end) if end and _ISO.match(end) else None
        except ValueError:
            start_d = end_d = None
        if (start and start_d is None) or (end and end_d is None):
            date_issues += 1
            continue
        if (start_d is None or start_d <= to) and (end_d is None or end_d >= frm):
            in_effect[tid].add(vva)
            if full_name:
                names[vva] = full_name
    return in_effect, names, date_issues


def _territory_metrics(
    cur: psycopg.Cursor, tids: list[str], frm: dt.date, to: dt.date, through_day: dt.date
) -> dict[str, Any]:
    """Per-territory metrics for the requested territories, under one window and one set of definitions."""
    params = {"frm": frm, "to": to, "tids": tids}
    cur.execute(
        """
        SELECT territory_id, count(DISTINCT crm_call_id), count(DISTINCT cust_mdm_id), count(*),
               count(DISTINCT crm_call_user_id), max(sys_inserted_datetime)
        FROM call_activity
        WHERE call_dt BETWEEN %(frm)s AND %(to)s AND territory_id = ANY(%(tids)s)
        GROUP BY territory_id
        """,
        params,
    )
    calls = {r[0]: r[1:] for r in cur.fetchall()}
    cur.execute(
        """
        SELECT territory_id, count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights
        WHERE date_of_interaction BETWEEN %(frm)s AND %(to)s AND excluded_rspns_flag IS NOT TRUE
          AND territory_id = ANY(%(tids)s)
        GROUP BY territory_id
        """,
        params,
    )
    responses = dict(cur.fetchall())
    cur.execute(
        """
        SELECT territory_id, crm_call_user_id, date_trunc('month', call_dt)::date, count(DISTINCT crm_call_id)
        FROM call_activity
        WHERE call_dt BETWEEN %(frm)s AND %(to)s AND territory_id = ANY(%(tids)s) AND crm_call_user_id IS NOT NULL
        GROUP BY 1, 2, 3
        """,
        params,
    )
    member_months: dict[str, dict[str, set[dt.date]]] = defaultdict(lambda: defaultdict(set))
    for tid, uid, month, _n in cur.fetchall():
        member_months[tid][uid].add(month)
    expected = len(_window_months(frm, to, through_day))

    in_effect, _names, _issues = _roster(cur, tids, frm, to)
    asof = dt.datetime.combine(to, dt.time(23, 59, 59), tzinfo=dt.UTC)
    cur.execute(
        """
        WITH tgt AS (
          SELECT DISTINCT entity_id, scope_id FROM target_assignments
          WHERE status = 'approved' AND scope_id = ANY(%(tids)s)
            AND effective_from <= %(asof)s AND (effective_to IS NULL OR effective_to > %(asof)s)
        ), engaged AS (
          SELECT DISTINCT cust_mdm_id, territory_id FROM call_activity
          WHERE call_dt BETWEEN %(frm)s AND %(to)s AND territory_id = ANY(%(tids)s) AND cust_mdm_id IS NOT NULL
        )
        SELECT t.scope_id, count(*), count(e.cust_mdm_id)
        FROM tgt t LEFT JOIN engaged e ON e.cust_mdm_id = t.entity_id AND e.territory_id = t.scope_id
        GROUP BY t.scope_id
        """,
        {**params, "asof": asof},
    )
    targets = {r[0]: (int(r[1]), int(r[2])) for r in cur.fetchall()}

    out: dict[str, Any] = {}
    for tid in tids:
        c = calls.get(tid)
        n_calls, n_hcps, n_rows, n_members, loaded = (int(c[0]), int(c[1]), int(c[2]), int(c[3]), c[4]) if c else (0, 0, 0, 0, None)
        members = member_months.get(tid, {})
        active = sum(len(months) for months in members.values())
        completeness = round(active / (len(members) * expected), 4) if members and expected else None
        target_n, target_engaged = targets.get(tid, (0, 0))
        out[tid] = {
            "distinctCalls": n_calls,
            "distinctEngagedHcps": n_hcps,
            "callProductRows": n_rows,
            "responseCount": int(responses.get(tid, 0)),
            "reportingMembers": n_members,
            "rosteredMembers": len(in_effect.get(tid, ())),
            "callsPerReportingMember": round(n_calls / n_members, 1) if n_members else None,
            "reportingCompleteness": completeness,
            "latestLoadDate": loaded.astimezone(dt.UTC).date().isoformat() if loaded else None,
            "coverage": _coverage(target_n, target_engaged),
        }
    return out


def _coverage(target: int, engaged: int) -> dict[str, Any]:
    if target <= 0:
        return {"status": "NO_TARGET_POPULATION", "targetHcps": None, "engagedTargetHcps": None, "percentage": None}
    return {
        "status": "AVAILABLE",
        "targetHcps": target,
        "engagedTargetHcps": engaged,
        "percentage": round(100.0 * engaged / target, 1),
    }


def _scope_territories(cur: psycopg.Cursor) -> list[dict[str, Any]]:
    """Leaf territories the caller is allowed to see, with their region. RLS decides which rows exist."""
    cur.execute(
        """
        WITH region AS (
          SELECT DISTINCT ON (r.child_territory_id) r.child_territory_id AS territory_id,
                 r.parent_territory_id AS region_id, coalesce(r.region_name, r.parent_territory_id) AS region_name
          FROM territory_scope_relationships r
          WHERE r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now())
          ORDER BY r.child_territory_id, (r.parent_territory_id LIKE 'REGION-%') DESC, r.parent_territory_id
        )
        SELECT g.territory_id, g.city, coalesce(rg.region_id, ''), coalesce(rg.region_name, '')
        FROM territory_geography g LEFT JOIN region rg ON rg.territory_id = g.territory_id
        ORDER BY rg.region_id, g.territory_id
        """
    )
    return [
        {"territoryId": tid, "name": name, "regionId": region_id, "regionName": region_name}
        for tid, name, region_id, region_name in cur.fetchall()
    ]


def _definitions() -> list[dict[str, str]]:
    return [{"key": k, "label": label, "text": text} for k, label, text in DEFINITIONS]


def director_overview(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    _assigned, effective, label = _scope(cur, identity)
    _require_team_overview(cur, label, effective)
    data_through = _data_through(cur)
    through_day = _as_date(data_through)
    frm, to = _window(args, data_through)

    territories = _scope_territories(cur)
    tids = [t["territoryId"] for t in territories]
    if not tids:
        raise NoScope("no_effective_scope")
    months = _window_months(frm, to, through_day)
    params = {"frm": frm, "to": to, "tids": tids}

    metrics = _territory_metrics(cur, tids, frm, to, through_day)
    rows = [{**t, **metrics[t["territoryId"]]} for t in territories]

    cur.execute(
        """
        SELECT count(DISTINCT crm_call_id), count(DISTINCT cust_mdm_id), count(*), count(DISTINCT crm_call_user_id),
               count(DISTINCT crm_call_id) FILTER (WHERE crm_call_user_id IS NULL)
        FROM call_activity WHERE call_dt BETWEEN %(frm)s AND %(to)s AND territory_id = ANY(%(tids)s)
        """,
        params,
    )
    total_calls, total_hcps, total_rows, total_members, unattributed = (int(v) for v in cur.fetchone())
    cur.execute(
        """
        SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights
        WHERE date_of_interaction BETWEEN %(frm)s AND %(to)s AND excluded_rspns_flag IS NOT TRUE AND territory_id = ANY(%(tids)s)
        """,
        params,
    )
    total_responses = int(cur.fetchone()[0])

    # Team monthly trend (distinct within each month, so months do not add up to the window totals).
    cur.execute(
        """
        SELECT date_trunc('month', call_dt)::date, count(DISTINCT crm_call_id), count(DISTINCT cust_mdm_id)
        FROM call_activity WHERE call_dt BETWEEN %(frm)s AND %(to)s AND territory_id = ANY(%(tids)s) GROUP BY 1
        """,
        params,
    )
    monthly = {r[0]: (int(r[1]), int(r[2])) for r in cur.fetchall()}
    month_series = [
        {
            "month": m["month"].isoformat(),
            "isPartial": m["isPartial"],
            "distinctCalls": monthly.get(m["month"], (0, 0))[0],
            "distinctEngagedHcps": monthly.get(m["month"], (0, 0))[1],
        }
        for m in months
    ]

    members, member_notes = _members(cur, tids, frm, to, months, params)
    mix = _mix(cur, params, months, total_calls)

    pooled = [r["reportingCompleteness"] for r in rows if r["reportingCompleteness"] is not None]
    weights = [r["reportingMembers"] for r in rows if r["reportingCompleteness"] is not None]
    completeness = round(sum(p * w for p, w in zip(pooled, weights, strict=True)) / sum(weights), 4) if pooled and sum(weights) else None

    asof = to.isoformat()
    cov_rows = [r["coverage"] for r in rows if r["coverage"]["status"] == "AVAILABLE"]
    scope_coverage = _scope_coverage(cur, tids, frm, to, len(tids), len(cov_rows))

    notes = list(member_notes)
    if unattributed:
        notes.append({"code": "UNATTRIBUTED_CALLS", "message": f"{unattributed} calls have no recorded team member and are not in the member view."})
    notes.append(
        {
            "code": "MIX_MULTIVALUE",
            "message": "A call recorded under several channels, topics, disease states or products counts once in each, "
            "so mix values can add up to more than the distinct calls.",
        }
    )

    log.info(
        "director overview computed",
        user_id=user_id,
        territory_count=len(rows),
        member_count=len(members),
        range_days=(to - frm).days + 1,
        kpi_distinct_calls=total_calls,
        kpi_distinct_hcps=total_hcps,
        coverage_available=scope_coverage["status"] == "AVAILABLE",
    )
    return {
        "from": frm.isoformat(),
        "to": to.isoformat(),
        "dataThrough": data_through.isoformat() if data_through else None,
        "scopeLabel": label,
        "definitionVersion": DEFINITION_VERSION,
        "definitions": _definitions(),
        "kpis": {
            "distinctCalls": total_calls,
            "distinctEngagedHcps": total_hcps,
            "callProductRows": total_rows,
            "responseCount": total_responses,
            "reportingMembers": total_members,
            "territoriesInScope": len(rows),
            "territoriesWithActivity": sum(1 for r in rows if r["distinctCalls"] > 0),
            "unattributedCalls": unattributed,
            "reportingCompleteness": completeness,
        },
        "months": month_series,
        "territories": rows,
        "members": members,
        "mix": mix,
        "coverage": {**scope_coverage, "asOf": asof},
        "notes": notes,
    }


def _scope_coverage(cur, tids, frm, to, territory_count, with_targets) -> dict[str, Any]:
    """Coverage for the whole scope: each target HCP counted once, engaged if reached in a territory they target."""
    asof = dt.datetime.combine(to, dt.time(23, 59, 59), tzinfo=dt.UTC)
    cur.execute(
        """
        WITH tgt AS (
          SELECT DISTINCT entity_id, scope_id FROM target_assignments
          WHERE status = 'approved' AND scope_id = ANY(%(tids)s)
            AND effective_from <= %(asof)s AND (effective_to IS NULL OR effective_to > %(asof)s)
        )
        SELECT count(DISTINCT t.entity_id),
               count(DISTINCT t.entity_id) FILTER (WHERE EXISTS (
                 SELECT 1 FROM call_activity c WHERE c.cust_mdm_id = t.entity_id AND c.territory_id = t.scope_id
                   AND c.call_dt BETWEEN %(frm)s AND %(to)s))
        FROM tgt t
        """,
        {"tids": tids, "asof": asof, "frm": frm, "to": to},
    )
    target, engaged = (int(v) for v in cur.fetchone())
    return {**_coverage(target, engaged), "territoriesWithTargets": with_targets, "territoriesInScope": territory_count}


def _members(cur, tids, frm, to, months, params) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Activity by team member: distinct calls per month and reporting completeness."""
    cur.execute(
        """
        SELECT crm_call_user_id, min(rep_nm), date_trunc('month', call_dt)::date, count(DISTINCT crm_call_id),
               array_agg(DISTINCT territory_id)
        FROM call_activity
        WHERE call_dt BETWEEN %(frm)s AND %(to)s AND territory_id = ANY(%(tids)s) AND crm_call_user_id IS NOT NULL
        GROUP BY crm_call_user_id, 3
        """,
        params,
    )
    per_member: dict[str, dict[str, Any]] = {}
    for uid, rep_nm, month, n, territories in cur.fetchall():
        m = per_member.setdefault(uid, {"name": rep_nm, "months": {}, "territories": set()})
        m["months"][month] = int(n)
        m["territories"].update(territories)
    cur.execute(
        """
        SELECT crm_call_user_id, count(DISTINCT crm_call_id) FROM call_activity
        WHERE call_dt BETWEEN %(frm)s AND %(to)s AND territory_id = ANY(%(tids)s) AND crm_call_user_id IS NOT NULL
        GROUP BY 1
        """,
        params,
    )
    totals = {uid: int(n) for uid, n in cur.fetchall()}
    in_effect, roster_names, date_issues = _roster(cur, tids, frm, to)
    rostered = {v for vs in in_effect.values() for v in vs}
    unlinked_roster = len(rostered - set(per_member))

    expected = len(months)
    members = []
    for uid, m in per_member.items():
        active = sum(1 for month in months if m["months"].get(month["month"], 0) > 0)
        linked = uid in roster_names
        members.append(
            {
                "memberId": uid,
                "name": roster_names.get(uid) or m["name"] or uid,
                "linkedToRoster": linked,
                "territoryIds": sorted(m["territories"]),
                "distinctCalls": totals.get(uid, 0),
                "activeMonths": active,
                "expectedMonths": expected,
                "reportingCompleteness": round(active / expected, 4) if expected else 0.0,
                "months": [{"month": mo["month"].isoformat(), "distinctCalls": m["months"].get(mo["month"], 0)} for mo in months],
            }
        )
    members.sort(key=lambda r: (-r["distinctCalls"], r["memberId"]))
    notes: list[dict[str, str]] = []
    if len(members) > MAX_MEMBERS:
        notes.append({"code": "MEMBERS_TRUNCATED", "message": f"Showing the {MAX_MEMBERS} team members with the most calls of {len(members)}."})
        members = members[:MAX_MEMBERS]
    if unlinked_roster:
        notes.append(
            {
                "code": "ROSTER_NOT_LINKED",
                "message": f"{unlinked_roster} rostered staff in these territories could not be linked to a call-feed user, "
                "so completeness covers call-feed reporters only.",
            }
        )
    if date_issues:
        notes.append({"code": "ROSTER_DATES_UNREADABLE", "message": f"{date_issues} roster rows have unreadable dates and are left out of rostered counts."})
    return members, notes


def _mix(cur, params, months, total_calls) -> list[dict[str, Any]]:
    out = []
    for kind, (label, expr) in _MIX.items():
        cur.execute(
            f"""
            SELECT {expr}, count(DISTINCT crm_call_id), count(*) FROM call_activity
            WHERE call_dt BETWEEN %(frm)s AND %(to)s AND territory_id = ANY(%(tids)s) GROUP BY 1
            ORDER BY 2 DESC, 1 LIMIT {MAX_MIX_VALUES}
            """,
            params,
        )
        values = [(v, int(c), int(r)) for v, c, r in cur.fetchall()]
        cur.execute(
            f"""
            SELECT {expr}, date_trunc('month', call_dt)::date, count(DISTINCT crm_call_id) FROM call_activity
            WHERE call_dt BETWEEN %(frm)s AND %(to)s AND territory_id = ANY(%(tids)s) GROUP BY 1, 2
            """,
            params,
        )
        by_value: dict[str, dict[dt.date, int]] = defaultdict(dict)
        for v, month, n in cur.fetchall():
            by_value[v][month] = int(n)
        cur.execute(
            f"""
            SELECT count(DISTINCT crm_call_id), count(*) FROM (
              SELECT crm_call_id, {expr} AS v FROM call_activity
              WHERE call_dt BETWEEN %(frm)s AND %(to)s AND territory_id = ANY(%(tids)s) GROUP BY 1, 2) x
            """,
            params,
        )
        _calls, pairs = (int(v) for v in cur.fetchone())
        out.append(
            {
                "dimension": kind,
                "label": label,
                "totalDistinctCalls": total_calls,
                "valueTotal": pairs,
                "valuesOverlap": pairs > total_calls,
                "values": [
                    {
                        "value": v if v else UNSPECIFIED,
                        "distinctCalls": calls,
                        "callProductRows": rows,
                        "months": [{"month": m["month"].isoformat(), "distinctCalls": by_value[v].get(m["month"], 0)} for m in months],
                    }
                    for v, calls, rows in values
                ],
            }
        )
    return out


def territory_comparison(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    """Side-by-side territories over one window and one set of definitions, disclosing unequal populations."""
    _assigned, effective, label = _scope(cur, identity)
    _require_team_overview(cur, label, effective)
    raw = args.get("territoryIds")
    if not isinstance(raw, list) or not all(isinstance(t, str) and _TERRITORY_ID.fullmatch(t) for t in raw):
        raise BadRequest("invalid_territory_ids")
    requested = list(dict.fromkeys(raw))
    if not MIN_COMPARE <= len(requested) <= MAX_COMPARE:
        raise BadRequest("invalid_territory_ids")

    data_through = _data_through(cur)
    through_day = _as_date(data_through)
    frm, to = _window(args, data_through)

    visible = {t["territoryId"]: t for t in _scope_territories(cur)}
    # One refusal for "outside your scope" and "does not exist": neither is confirmed to the caller.
    if any(t not in visible for t in requested):
        raise Forbidden("territory_not_in_scope")

    metrics = _territory_metrics(cur, requested, frm, to, through_day)
    rows = [{**visible[t], **metrics[t]} for t in requested]
    disclosures = _disclosures(rows, frm, to, through_day)
    unequal = any(d["code"] in UNEQUAL_CODES for d in disclosures)
    log.info(
        "territory comparison computed",
        user_id=user_id,
        territory_count=len(rows),
        range_days=(to - frm).days + 1,
        disclosure_count=len(disclosures),
        populations_unequal=unequal,
    )
    return {
        "from": frm.isoformat(),
        "to": to.isoformat(),
        "dataThrough": data_through.isoformat() if data_through else None,
        "scopeLabel": label,
        "definitionVersion": DEFINITION_VERSION,
        "definitions": _definitions(),
        "territories": rows,
        "populationsUnequal": unequal,
        "disclosures": disclosures,
    }


UNEQUAL_CODES = frozenset(
    {"REPORTING_MEMBERS_DIFFER", "ROSTER_SIZE_DIFFERS", "TARGET_POPULATION_DIFFERS", "TARGET_DATA_UNEVEN", "COMPLETENESS_DIFFERS"}
)


def _disclosures(rows: list[dict[str, Any]], frm: dt.date, to: dt.date, through_day: dt.date) -> list[dict[str, str]]:
    """Deterministic statements about why two territories may not be directly comparable. Counts only."""
    out: list[dict[str, str]] = []

    def values(key: str) -> list[Any]:
        return [r[key] for r in rows]

    def show(vals: list[Any]) -> str:
        return ", ".join("n/a" if v is None else str(v) for v in vals)

    if len(set(values("reportingMembers"))) > 1:
        out.append(
            {
                "code": "REPORTING_MEMBERS_DIFFER",
                "message": f"Reporting team sizes differ ({show(values('reportingMembers'))}). Calls per reporting member is shown for a like-for-like read.",
            }
        )
    if len(set(values("rosteredMembers"))) > 1:
        out.append({"code": "ROSTER_SIZE_DIFFERS", "message": f"Rostered staff counts differ ({show(values('rosteredMembers'))})."})
    completeness = [r["reportingCompleteness"] for r in rows]
    if len({None if c is None else round(c, 2) for c in completeness}) > 1:
        pct = [None if c is None else f"{round(c * 100)}%" for c in completeness]
        out.append({"code": "COMPLETENESS_DIFFERS", "message": f"Reporting completeness differs ({show(pct)}); a lower figure may reflect missing reporting rather than less activity."})
    has_target = [r["coverage"]["status"] == "AVAILABLE" for r in rows]
    if any(has_target) and not all(has_target):
        out.append(
            {
                "code": "TARGET_DATA_UNEVEN",
                "message": "Only some of these territories have an approved target population, so coverage is shown for those alone and is not compared.",
            }
        )
    elif all(has_target) and len({r["coverage"]["targetHcps"] for r in rows}) > 1:
        out.append(
            {
                "code": "TARGET_POPULATION_DIFFERS",
                "message": f"Target populations differ in size ({show([r['coverage']['targetHcps'] for r in rows])}); compare coverage percentages, not counts.",
            }
        )
    elif not any(has_target):
        out.append({"code": "COVERAGE_WITHHELD", "message": "No approved target population exists for these territories, so coverage is not shown."})
    loads = {r["latestLoadDate"] for r in rows}
    if len(loads) > 1:
        out.append({"code": "LOAD_DATES_DIFFER", "message": "The latest records were loaded on different dates for these territories."})
    if _window_months(frm, to, through_day) and any(m["isPartial"] for m in _window_months(frm, to, through_day)):
        out.append({"code": "PARTIAL_PERIOD", "message": "The period includes a partial month, applied identically to every territory."})
    return out
