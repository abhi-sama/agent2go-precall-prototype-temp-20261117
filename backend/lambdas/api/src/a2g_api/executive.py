"""Executive overview: aggregate-only enterprise view with small-group suppression, and a controlled drill-down.

Access (docs/adr/0009):

* Scope is the territories the Executive is explicitly authorized for: in-effect scope assignments of
  type ``executive`` and their descendants (``app.executive_scope_territories``). It is never inferred from
  roster labels, and a primary or temporary assignment grants no executive scope.
* An Executive holds ``aggregate.read`` and no ``source.records.read``, so RLS returns no source rows. Every
  number comes from the SECURITY DEFINER aggregate functions of migration 009, which return counts only.
* Small-group disclosure: any count below ``MIN_CELL`` is withheld (``suppressed``) with its value removed from
  the response. When exactly one component of a shown total is withheld, the next-smallest component is withheld
  too, so the hidden figure cannot be recovered by subtraction. An Executive who has been granted
  ``source.records.read`` (explicit record-level permission) is no longer aggregate-only: nothing is suppressed
  for them and ``executiveDrilldown`` opens.
* Drill-down needs that record-level permission *and* the territory to be in the Executive's explicit scope.
  An out-of-scope and a nonexistent territory get the same ``Forbidden``.

Metric definitions (version ``DEFINITION_VERSION``), identical for every unit and period shown:

* calls: ``COUNT(DISTINCT crm_call_id)``; responses: ``COUNT(DISTINCT uniq_rspns_id)`` excluding
  ``excluded_rspns_flag``; engagedHcps: ``COUNT(DISTINCT cust_mdm_id)`` over the same calls. Engaged HCPs are
  counted at each level, so they do not add up across months or regions.
* reportingCompleteness: territory-months with at least one recorded call divided by (territories in scope x months
  that data-through has reached). It describes whether reporting happened, not how well anyone performed.
* coverage: engaged target HCPs over the approved, in-effect target population; withheld without one.
* dataThrough is a load date (``sys_inserted_datetime``); months are interaction-date months.
"""

from __future__ import annotations

import datetime as dt
import re
from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Any

import psycopg

from a2g_logging import get_logger

from .activity import _add_months, _as_date, _int_arg, _month_end, _month_start, _parse_month
from .errors import BadRequest, Forbidden, NoScope
from .identity import Identity
from .resolvers import MIN_CELL, _parse_date

log = get_logger(__name__)

DEFINITION_VERSION = "executive-overview-v1"
MAX_WINDOW_DAYS = 731
DEFAULT_MONTHS = 12
MAX_DRILLDOWN = 100
DEFAULT_DRILLDOWN = 50
RANK_BY = ("CALLS", "RESPONSES", "ENGAGED_HCPS", "CALLS_PER_TERRITORY", "COMPLETENESS")
DRILLDOWN_KINDS = ("CALLS", "RESPONSES")
_SCOPE_ID = re.compile(r"^[A-Za-z0-9_.-]{1,40}$")

DEFINITIONS = [
    ("calls", "Distinct calls", "Each call counted once by its call id, however many products it covers."),
    ("responses", "Responses", "Recorded insight responses in the period, excluding responses flagged as excluded."),
    (
        "engagedHcps",
        "Engaged HCPs",
        "Each HCP reached at least once, counted once at every level. They do not add up across months or regions.",
    ),
    (
        "reportingCompleteness",
        "Reporting completeness",
        "Territory-months with at least one recorded call over the territories in scope times the months data has "
        "reached. It describes reporting, not performance.",
    ),
    (
        "coverage",
        "Coverage",
        "Engaged target HCPs divided by the approved target population. Withheld when no approved target population exists.",
    ),
]


def disclosure_text(min_cell: int = MIN_CELL) -> str:
    return (
        f"Counts below {min_cell} are withheld so no small group can be identified. When one value in a total is "
        "withheld, the next smallest is withheld as well, so it cannot be worked out by subtraction."
    )


# --------------------------------------------------------------------------- suppression


def suppress_flags(values: Sequence[int | None], total: int | None, *, additive: bool, min_cell: int = MIN_CELL) -> tuple[list[bool], bool]:
    """Which values to withhold, and whether the total must be withheld too.

    A value is a small group when ``0 < value < min_cell``; zero identifies nobody. For components that sum
    to a shown total (``additive``), exactly one withheld component could be recovered as total minus the others,
    so the smallest other positive component is withheld as well; with none to withhold, the total goes.
    """
    flags = [v is not None and 0 < v < min_cell for v in values]
    total_hidden = total is not None and 0 < total < min_cell
    if additive and not total_hidden and sum(flags) == 1:
        candidates = [(v, i) for i, (v, f) in enumerate(zip(values, flags)) if not f and v is not None and v > 0]
        if candidates:
            flags[min(candidates)[1]] = True
        else:
            total_hidden = True
    return flags, total_hidden


def _count(value: int | None, hidden: bool) -> dict[str, Any]:
    return {"value": None if hidden or value is None else int(value), "suppressed": bool(hidden)}


# --------------------------------------------------------------------------- access


def _require_executive_scope(cur: psycopg.Cursor, identity: Identity) -> tuple[list[str], bool]:
    """Explicit executive assignments only. Returns (assigned scope ids, record-level permission held)."""
    if identity.persona != "executive":
        raise Forbidden("executive_only")
    cur.execute("SELECT app.can_read_aggregate(), app.has_permission('source.records.read')")
    can_aggregate, can_records = (bool(v) for v in cur.fetchone())
    if not can_aggregate:
        raise Forbidden("aggregate_access_required")
    cur.execute(
        """
        SELECT DISTINCT territory_id FROM user_scope_assignments
        WHERE user_id = app.request_user_id() AND assignment_type = 'executive'
          AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
        ORDER BY territory_id
        """
    )
    assigned = [r[0] for r in cur.fetchall()]
    if not assigned:
        raise NoScope("no_executive_assignment")
    return assigned, can_records


def _units(cur: psycopg.Cursor) -> list[dict[str, Any]]:
    cur.execute(
        "SELECT territory_id, territory_name, region_id, region_name, country_code FROM app.exec_units() ORDER BY region_id, territory_id"
    )
    return [
        {"territoryId": t, "name": n, "regionId": r, "regionName": rn, "countryCode": c}
        for t, n, r, rn, c in cur.fetchall()
    ]


def _scope_label(assigned: list[str], unit_count: int) -> str:
    names = ", ".join(assigned)
    return names if unit_count <= len(assigned) else f"{names} · {unit_count} territories"


def _window(args: Mapping[str, Any], through_day: dt.date | None) -> tuple[dt.date, dt.date]:
    to = _parse_date(args.get("to"), "to") or through_day or dt.date.today()
    frm = _parse_date(args.get("from"), "from") or _add_months(_month_start(to), -(DEFAULT_MONTHS - 1))
    if frm > to or (to - frm).days + 1 > MAX_WINDOW_DAYS:
        raise BadRequest("invalid_range")
    return frm, to


def _months(frm: dt.date, to: dt.date, through_day: dt.date | None) -> list[dict[str, Any]]:
    """Months of the window that data-through has reached; later months are not shown as zero activity."""
    last = min(to, through_day) if through_day else to
    months: list[dict[str, Any]] = []
    cursor = _month_start(frm)
    while cursor <= last:
        months.append({"month": cursor, "isPartial": frm > cursor or last < _month_end(cursor)})
        cursor = _add_months(cursor, 1)
    return months


# --------------------------------------------------------------------------- overview


def _cells(cur: psycopg.Cursor, frm: dt.date, to: dt.date) -> dict[str, Any]:
    cur.execute("SELECT level, territory_id, region_id, month, calls, responses, hcps FROM app.exec_cells(%s, %s)", (frm, to))
    out: dict[str, Any] = {"total": (0, 0, 0), "month": {}, "region": {}, "territory": {}, "territory_month": {}}
    for level, tid, rid, month, calls, responses, hcps in cur.fetchall():
        value = (int(calls), int(responses), int(hcps))
        if level == "TOTAL":
            out["total"] = value
        elif level == "MONTH":
            out["month"][month] = value
        elif level == "REGION":
            out["region"][rid] = value
        elif level == "TERRITORY" and month is None:
            out["territory"][tid] = value
    return out


def _sorted_units(rows: list[dict[str, Any]], rank_by: str) -> list[dict[str, Any]]:
    """Rank by one metric. Withheld values are unranked and listed last, in a stable order."""
    key = {
        "CALLS": lambda r: r["calls"]["value"],
        "RESPONSES": lambda r: r["responses"]["value"],
        "ENGAGED_HCPS": lambda r: r["engagedHcps"]["value"],
        "CALLS_PER_TERRITORY": lambda r: r["callsPerTerritory"],
        "COMPLETENESS": lambda r: r["reportingCompleteness"],
    }[rank_by]
    ranked = sorted((r for r in rows if key(r) is not None), key=lambda r: (-key(r), r["name"], r["id"]))
    unranked = sorted((r for r in rows if key(r) is None), key=lambda r: (r["name"], r["id"]))
    out, rank, previous = [], 0, object()
    for position, row in enumerate(ranked, 1):
        if key(row) != previous:
            rank, previous = position, key(row)
        out.append({**row, "rank": rank})
    return out + [{**r, "rank": None} for r in unranked]


def _rank_rows(
    metrics: Mapping[str, tuple[int, int, int]],
    reporting: Mapping[str, int],
    month_count: int,
    *,
    level: str,
    ids: dict[str, str],
    territory_counts: dict[str, int],
    hidden: Mapping[str, tuple[bool, bool, bool]],
    rank_by: str,
) -> list[dict[str, Any]]:
    rows = []
    for key, name in ids.items():
        calls, responses, hcps = metrics.get(key, (0, 0, 0))
        calls_hidden, responses_hidden, hcps_hidden = hidden.get(key, (False, False, False))
        n_territories = territory_counts[key]
        possible = n_territories * month_count
        rows.append(
            {
                "id": key,
                "name": name,
                "level": level,
                "territoriesInScope": n_territories,
                "calls": _count(calls, calls_hidden),
                "responses": _count(responses, responses_hidden),
                "engagedHcps": _count(hcps, hcps_hidden),
                "callsPerTerritory": None if calls_hidden or not n_territories else round(calls / n_territories, 1),
                "reportingCompleteness": round(100.0 * reporting.get(key, 0) / possible, 1) if possible else None,
            }
        )
    return _sorted_units(rows, rank_by)


def _hidden_cells(
    keys: Sequence[str], metrics: Mapping[str, tuple[int, int, int]], total: tuple[int, int, int]
) -> dict[str, tuple[bool, bool, bool]]:
    """Withhold small groups among sibling units whose calls and responses add up to ``total``."""
    calls, _ = suppress_flags([metrics.get(k, (0, 0, 0))[0] for k in keys], total[0], additive=True)
    responses, _ = suppress_flags([metrics.get(k, (0, 0, 0))[1] for k in keys], total[1], additive=True)
    hcps, _ = suppress_flags([metrics.get(k, (0, 0, 0))[2] for k in keys], None, additive=False)
    # Engaged HCPs are measured on the same call rows: a unit whose calls are withheld must not leak them
    # through its HCP count (an HCP count is a lower bound on calls).
    return {k: (calls[i], responses[i], hcps[i] or calls[i]) for i, k in enumerate(keys)}


def executive_overview(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    assigned, can_records = _require_executive_scope(cur, identity)
    rank_by = str(args.get("rankBy") or "CALLS")
    if rank_by not in RANK_BY:
        raise BadRequest("invalid_rank_by")
    suppress = not can_records

    units = _units(cur)
    if not units:
        raise NoScope("no_executive_territories")
    cur.execute("SELECT calls_loaded, responses_loaded FROM app.exec_loads()")
    calls_loaded, responses_loaded = cur.fetchone()
    loaded = [v for v in (calls_loaded, responses_loaded) if v is not None]
    data_through = min(loaded) if len(loaded) == 2 else None
    through_day = _as_date(data_through) if data_through else None
    frm, to = _window(args, through_day)

    months = _months(frm, to, through_day)
    cells = _cells(cur, frm, to)
    cur.execute("SELECT territory_id, month FROM app.exec_reporting(%s, %s)", (frm, to))
    reporting_pairs = {(t, m) for t, m in cur.fetchall()}
    reached = {m["month"] for m in months}
    reporting_by_territory: dict[str, int] = defaultdict(int)
    reporting_by_month: dict[dt.date, int] = defaultdict(int)
    for tid, month in reporting_pairs:
        if month in reached:
            reporting_by_territory[tid] += 1
            reporting_by_month[month] += 1
    region_of = {u["territoryId"]: u["regionId"] for u in units}
    reporting_by_region: dict[str, int] = defaultdict(int)
    for tid, n in reporting_by_territory.items():
        reporting_by_region[region_of[tid]] += n

    total = cells["total"]
    n_territories = len(units)
    possible = n_territories * len(months)
    overall_completeness = round(100.0 * sum(reporting_by_territory.values()) / possible, 1) if possible else None

    # KPI cards
    total_hidden = [False, False, False]
    if suppress:
        total_hidden = [0 < total[0] < MIN_CELL, 0 < total[1] < MIN_CELL, 0 < total[2] < MIN_CELL]

    # Monthly trend: complementary suppression within the shown months so no cell is recoverable from the total.
    month_values = [cells["month"].get(m["month"], (0, 0, 0)) for m in months]
    if suppress:
        calls_hidden, calls_total_hidden = suppress_flags([v[0] for v in month_values], total[0], additive=True)
        responses_hidden, responses_total_hidden = suppress_flags([v[1] for v in month_values], total[1], additive=True)
        hcps_hidden, _ = suppress_flags([v[2] for v in month_values], None, additive=False)
        hcps_hidden = [h or c for h, c in zip(hcps_hidden, calls_hidden)]
        total_hidden[0] = total_hidden[0] or calls_total_hidden
        total_hidden[1] = total_hidden[1] or responses_total_hidden
    else:
        calls_hidden = responses_hidden = hcps_hidden = [False] * len(months)
    month_rows = []
    for i, m in enumerate(months):
        r = reporting_by_month.get(m["month"], 0)
        month_rows.append(
            {
                "month": m["month"].isoformat(),
                "isPartial": m["isPartial"],
                "calls": _count(month_values[i][0], calls_hidden[i]),
                "responses": _count(month_values[i][1], responses_hidden[i]),
                "engagedHcps": _count(month_values[i][2], hcps_hidden[i]),
                "territoriesReporting": r,
                "territoriesInScope": n_territories,
                "reportingCompleteness": round(100.0 * r / n_territories, 1),
            }
        )

    # Regional and territory comparison: one window, one definition set, for every unit.
    region_ids = {u["regionId"]: u["regionName"] for u in units}
    region_counts: dict[str, int] = defaultdict(int)
    for u in units:
        region_counts[u["regionId"]] += 1
    territory_ids = {u["territoryId"]: f'{u["territoryId"]} \u00b7 {u["name"]}' for u in units}
    region_hidden: dict[str, tuple[bool, bool, bool]] = {}
    territory_hidden: dict[str, tuple[bool, bool, bool]] = {}
    if suppress:
        region_hidden = _hidden_cells(list(region_ids), cells["region"], total)
        for rid in region_ids:
            members = [u["territoryId"] for u in units if u["regionId"] == rid]
            group_total = cells["region"].get(rid, (0, 0, 0))
            inner = _hidden_cells(members, cells["territory"], group_total)
            hidden_region = region_hidden[rid]
            # A withheld region must not be recoverable by adding up its territories.
            territory_hidden.update(
                {
                    t: (
                        inner[t][0] or hidden_region[0],
                        inner[t][1] or hidden_region[1],
                        inner[t][2] or hidden_region[2],
                    )
                    for t in members
                }
            )
    regions = _rank_rows(
        cells["region"], reporting_by_region, len(months), level="REGION",
        ids=region_ids, territory_counts=region_counts, hidden=region_hidden, rank_by=rank_by,
    )
    territories = _rank_rows(
        cells["territory"], reporting_by_territory, len(months), level="TERRITORY",
        ids=territory_ids, territory_counts={u["territoryId"]: 1 for u in units}, hidden=territory_hidden, rank_by=rank_by,
    )
    region_of_name = {u["territoryId"]: u["regionName"] for u in units}
    for row in territories:
        row["regionId"], row["regionName"] = region_of[row["id"]], region_of_name[row["id"]]
    for row in regions:
        row["regionId"], row["regionName"] = row["id"], row["name"]
    region_suppressed = sum(sum(v) for v in region_hidden.values())
    territory_suppressed = sum(sum(v) for v in territory_hidden.values())

    # Engagement patterns
    cur.execute("SELECT band, sort_order, hcps FROM app.exec_hcp_depth(%s, %s) ORDER BY sort_order", (frm, to))
    bands = [(b, int(h)) for b, _o, h in cur.fetchall()]
    cur.execute("SELECT channel, calls FROM app.exec_channel_mix(%s, %s) ORDER BY calls DESC, channel", (frm, to))
    channel_rows = [(c, int(n)) for c, n in cur.fetchall()]
    band_hidden, band_total_hidden = (
        suppress_flags([n for _b, n in bands], total[2], additive=True) if suppress else ([False] * len(bands), False)
    )
    total_hidden[2] = total_hidden[2] or band_total_hidden
    channel_hidden, channel_total_hidden = (
        suppress_flags([n for _c, n in channel_rows], total[0], additive=True) if suppress else ([False] * len(channel_rows), False)
    )
    total_hidden[0] = total_hidden[0] or channel_total_hidden
    total_hidden[2] = total_hidden[2] or total_hidden[0]
    cur.execute("SELECT target_hcps, engaged_targets, territories_with_targets, territories_in_scope FROM app.exec_coverage(%s, %s)", (frm, to))
    target, engaged_targets, with_targets, in_scope = (int(v) for v in cur.fetchone())
    if target <= 0:
        coverage = {"status": "NO_TARGET_POPULATION", "percentage": None}
    elif suppress and target < MIN_CELL:
        coverage = {"status": "SUPPRESSED", "percentage": None}
    else:
        coverage = {"status": "AVAILABLE", "percentage": round(100.0 * engaged_targets / target, 1)}
    coverage.update({"territoriesWithTargets": with_targets, "territoriesInScope": in_scope})
    calls_per_hcp = None if total_hidden[0] or total_hidden[2] or not total[2] else round(total[0] / total[2], 2)

    suppressed_cells = (
        sum(1 for f in total_hidden if f) + sum(calls_hidden) + sum(responses_hidden) + sum(hcps_hidden)
        + region_suppressed + territory_suppressed + sum(band_hidden) + sum(channel_hidden)
    )
    notes: list[dict[str, str]] = []
    if suppress:
        notes.append({"code": "AGGREGATE_ONLY", "message": "This view shows aggregates only. Individual records are not available to your role."})
    if coverage["status"] == "NO_TARGET_POPULATION":
        notes.append({"code": "COVERAGE_WITHHELD", "message": "Coverage is not shown: no approved target population exists for these territories."})
    if through_day is not None and to > through_day:
        notes.append({"code": "AFTER_DATA_THROUGH", "message": "Months after the data-through date are not shown, so they are not read as zero activity."})
    if any(m["isPartial"] for m in months):
        notes.append({"code": "PARTIAL_MONTH", "message": "A month marked partial is cut short by the selected dates or the data-through date."})
    sizes = sorted(set(region_counts.values()))
    if len(sizes) > 1:
        notes.append({"code": "REGION_SIZES_DIFFER", "message": f"Regions differ in size ({sizes[0]} to {sizes[-1]} territories); compare calls per territory."})
    lag_days = (
        abs((_as_date(calls_loaded) - _as_date(responses_loaded)).days) if calls_loaded and responses_loaded else None
    )
    if lag_days:
        notes.append({"code": "SOURCES_LOADED_AT_DIFFERENT_TIMES", "message": f"Calls and responses were last loaded {lag_days} days apart."})

    freshness_status = "NO_DATA" if through_day is None else ("PARTIAL" if to > through_day else "CURRENT")
    log.info(
        "executive overview served",
        user_id=user_id,
        territory_count=n_territories,
        region_count=len(region_ids),
        month_count=len(months),
        suppressed_cells=suppressed_cells,
        aggregate_only=suppress,
        rank_by=rank_by,
    )
    return {
        "from": frm.isoformat(),
        "to": to.isoformat(),
        "dataThrough": data_through.isoformat() if data_through else None,
        "scopeLabel": _scope_label(assigned, n_territories),
        "accessLevel": "AGGREGATE_ONLY" if suppress else "RECORD_DRILLDOWN",
        "drilldownAllowed": can_records,
        "definitionVersion": DEFINITION_VERSION,
        "definitions": [{"key": k, "label": label, "text": text} for k, label, text in DEFINITIONS],
        "disclosure": {"minCell": MIN_CELL, "text": disclosure_text(), "suppressedCells": suppressed_cells, "applied": suppress},
        "rankBy": rank_by,
        "kpis": {
            "calls": _count(total[0], total_hidden[0]),
            "responses": _count(total[1], total_hidden[1]),
            "engagedHcps": _count(total[2], total_hidden[2]),
            "regionsInScope": len(region_ids),
            "territoriesInScope": n_territories,
            "reportingCompleteness": overall_completeness,
        },
        "freshness": {
            "status": freshness_status,
            "callsLoadedThrough": calls_loaded.isoformat() if calls_loaded else None,
            "responsesLoadedThrough": responses_loaded.isoformat() if responses_loaded else None,
            "sourceLagDays": lag_days,
            "monthsShown": len(months),
        },
        "months": month_rows,
        "regions": regions,
        "territories": territories,
        "engagement": {
            "engagedHcps": _count(total[2], total_hidden[2]),
            "callsPerEngagedHcp": calls_per_hcp,
            "depth": [{"band": b, "hcps": _count(n, band_hidden[i])} for i, (b, n) in enumerate(bands)],
            "channels": [{"channel": c, "calls": _count(n, channel_hidden[i])} for i, (c, n) in enumerate(channel_rows)],
            "coverage": coverage,
        },
        "notes": notes,
    }


# --------------------------------------------------------------------------- drill-down


def executive_drilldown(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    """The calls or responses behind one chart point. Only for an Executive holding record-level permission."""
    assigned, can_records = _require_executive_scope(cur, identity)
    if not can_records:
        # Explicit record-level permission is separate from aggregate access: no grant, no records.
        raise Forbidden("record_level_permission_required")
    scope_id = str(args.get("scopeId") or "")
    if not _SCOPE_ID.match(scope_id):
        raise BadRequest("invalid_scope_id")
    kind = str(args.get("kind") or "")
    if kind not in DRILLDOWN_KINDS:
        raise BadRequest("invalid_kind")
    month = _parse_month(args.get("month"))
    limit = _int_arg(args.get("limit"), "limit", DEFAULT_DRILLDOWN, 1, MAX_DRILLDOWN)

    units = _units(cur)
    territory_ids = [u["territoryId"] for u in units if scope_id in (u["territoryId"], u["regionId"])]
    if not territory_ids:
        # Out of scope and nonexistent are the same answer.
        raise Forbidden("scope_not_authorized")
    params = {"tids": territory_ids, "frm": month, "to": _month_end(month), "limit": limit}

    if kind == "CALLS":
        where = "territory_id = ANY(%(tids)s) AND call_dt BETWEEN %(frm)s AND %(to)s AND crm_call_id IS NOT NULL"
        cur.execute(f"SELECT count(DISTINCT crm_call_id) FROM call_activity WHERE {where}", params)
        total = int(cur.fetchone()[0])
        cur.execute(
            f"""
            SELECT crm_call_id, min(territory_id), min(cust_mdm_id), min(cust_full_nm),
                   min(coalesce(nullif(btrim(call_chnl), ''), 'Unspecified')), NULL::text,
                   min(call_dt), max(sys_inserted_datetime)
            FROM call_activity WHERE {where}
            GROUP BY crm_call_id ORDER BY min(call_dt) DESC, crm_call_id LIMIT %(limit)s
            """,
            params,
        )
    else:
        where = (
            "territory_id = ANY(%(tids)s) AND date_of_interaction BETWEEN %(frm)s AND %(to)s "
            "AND uniq_rspns_id IS NOT NULL AND excluded_rspns_flag IS NOT TRUE"
        )
        cur.execute(f"SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE {where}", params)
        total = int(cur.fetchone()[0])
        cur.execute(
            f"""
            SELECT uniq_rspns_id, min(territory_id), min(cust_mdm_id), min(cust_nm),
                   min(qstn_ext_id), min(rspns_txt), min(date_of_interaction), max(sys_inserted_datetime)
            FROM hcp_raw_insights WHERE {where}
            GROUP BY uniq_rspns_id ORDER BY min(date_of_interaction) DESC, uniq_rspns_id LIMIT %(limit)s
            """,
            params,
        )
    records = [
        {
            "recordId": rid,
            "kind": "CALL" if kind == "CALLS" else "RESPONSE",
            "territoryId": tid,
            "hcpId": hcp_id,
            "hcpName": hcp_name,
            "detail": detail,
            "responseText": text,
            "interactionDate": interaction.isoformat() if interaction else None,
            "loadedAt": loaded.isoformat() if loaded else None,
        }
        for rid, tid, hcp_id, hcp_name, detail, text, interaction, loaded in cur.fetchall()
    ]
    cur.execute("SELECT calls_loaded, responses_loaded FROM app.exec_loads()")
    loads = [v for v in cur.fetchone() if v is not None]
    log.info(
        "executive drilldown served",
        user_id=user_id,
        kind=kind,
        territory_count=len(territory_ids),
        record_count=len(records),
        total=total,
    )
    return {
        "scopeId": scope_id,
        "kind": kind,
        "month": month.isoformat(),
        "total": total,
        "truncated": total > len(records),
        "dataThrough": min(loads).isoformat() if len(loads) == 2 else None,
        "scopeLabel": _scope_label(assigned, len(units)),
        "records": records,
    }
