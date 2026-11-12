"""Executive trends: monthly distinct calls, engaged HCPs and responses by the Executive's explicit regions.

Access, scope and disclosure follow the overview and themes (docs/adr/0009, 0013, 0016):

* Scope is the Executive's explicit executive assignments (``app.exec_units``); an Executive holds ``aggregate.read``
  and no ``source.records.read``, so every number comes from the SECURITY DEFINER functions of migration 013, which
  return counts and never rows. There is no record-level drill-down from this view.
* Small-group disclosure (``MIN_CELL``): a count of 1 to 4 is withheld and carries no value. Months are cut two ways
  (by region and by month) and both cuts are shown beside a total elsewhere (the overview), so withholding is
  complementary in both directions until it is stable: no withheld cell can be recovered by subtraction. An
  Executive who also holds record-level permission has nothing withheld.
* The arrow compares the latest ``TREND_DAYS`` days with the equal period before, region by region, judged in the
  database by the approved thresholds (``app.exec_activity_trend_status``). A region with too few responses in
  either period gets no trend (``INSUFFICIENT_SAMPLE``); a figure behind an arrow that is itself a small group gets
  ``WITHHELD``. An arrow reports a change in what was recorded, never a cause.

Metric definitions are those of the overview: calls ``COUNT(DISTINCT crm_call_id)``, engaged HCPs
``COUNT(DISTINCT cust_mdm_id)`` over the same calls, responses ``COUNT(DISTINCT uniq_rspns_id)`` excluding excluded
responses. Nothing here calls a model, and nothing is logged beyond ids, counts and enums.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Any

import psycopg
from a2g_exec_analysis import NoExecutiveScope, regions_in_scope, thresholds
from a2g_exec_analysis.disclosure import count, disclosure_text, is_small
from a2g_logging import get_logger

from .activity import _as_date
from .errors import NoScope
from .executive import _months, _require_executive_scope, _scope_label, _window
from .executive_themes import exec_data_through
from .identity import Identity
from .resolvers import MIN_CELL

log = get_logger(__name__)

DEFINITION_VERSION = "executive-trends-v1"
TREND_DAYS = 90
METRICS = ("CALLS", "ENGAGED_HCPS", "RESPONSES")
_VERDICT = {"RISING", "FALLING", "STEADY", "INSUFFICIENT_SAMPLE"}

Cells = dict[tuple[str, dt.date], tuple[int, int, int]]


def _complement(values: Sequence[int | None], total: int | None, hidden: Sequence[bool], *, additive: bool) -> list[bool]:
    """``suppress_flags`` that also honours cells already withheld by the other cut of the same table."""
    flags = [h or is_small(v) for v, h in zip(values, hidden)]
    if additive and total is not None and not is_small(total) and sum(flags) == 1:
        candidates = [(v, i) for i, (v, f) in enumerate(zip(values, flags)) if not f and v is not None and v > 0]
        if candidates:
            flags[min(candidates)[1]] = True
    return flags


def withheld_cells(
    regions: Sequence[str],
    months: Sequence[dt.date],
    cells: Mapping[tuple[str, dt.date], tuple[int, int, int]],
    region_totals: Mapping[str, tuple[int, int, int]],
    month_totals: Mapping[dt.date, tuple[int, int, int]],
) -> dict[tuple[str, dt.date], tuple[bool, bool, bool]]:
    """Which region-month cells to withhold: (calls, responses, engaged HCPs) per cell.

    Calls and responses add up across months to the region total and across regions to the month total, so each cut is
    made complementary and the two are repeated until stable (flags only ever grow, so this ends). Engaged HCPs are
    distinct per cell and do not add up, but they ride on the same call rows: a cell whose calls are withheld has its
    engaged HCPs withheld too (an HCP count is a lower bound on calls).
    """
    out: dict[tuple[str, dt.date], list[bool]] = {(r, m): [False, False, False] for r in regions for m in months}
    value = lambda r, m, k: cells.get((r, m), (0, 0, 0))[k]  # noqa: E731
    for k in (0, 1):
        changed = True
        while changed:
            changed = False
            for r in regions:
                before = [out[(r, m)][k] for m in months]
                after = _complement([value(r, m, k) for m in months], region_totals.get(r, (0, 0, 0))[k], before, additive=True)
                for m, flag in zip(months, after):
                    if flag and not out[(r, m)][k]:
                        out[(r, m)][k], changed = True, True
            for m in months:
                before = [out[(r, m)][k] for r in regions]
                after = _complement([value(r, m, k) for r in regions], month_totals.get(m, (0, 0, 0))[k], before, additive=True)
                for r, flag in zip(regions, after):
                    if flag and not out[(r, m)][k]:
                        out[(r, m)][k], changed = True, True
    for r in regions:
        for m in months:
            flags = out[(r, m)]
            flags[2] = is_small(value(r, m, 2)) or flags[0]
    return {key: (f[0], f[1], f[2]) for key, f in out.items()}


def _read_months(cur: psycopg.Cursor, frm: dt.date, to: dt.date) -> tuple[Cells, dict[str, tuple[int, int, int]], dict[dt.date, tuple[int, int, int]]]:
    cur.execute("SELECT level, region_id, month, calls, responses, hcps FROM app.exec_region_months(%s, %s)", (frm, to))
    cells: Cells = {}
    by_region: dict[str, tuple[int, int, int]] = {}
    by_month: dict[dt.date, tuple[int, int, int]] = {}
    for level, region, month, calls, responses, hcps in cur.fetchall():
        value = (int(calls), int(responses), int(hcps))
        if level == "REGION_MONTH":
            cells[(region, month)] = value
        elif level == "REGION":
            by_region[region] = value
        elif level == "MONTH":
            by_month[month] = value
    return cells, by_region, by_month


def _read_windows(cur: psycopg.Cursor, cur_from: dt.date, cur_to: dt.date, prior_from: dt.date) -> dict[str, dict[str, tuple[int, int]]]:
    """Per region: {metric: (latest, prior)}."""
    cur.execute(
        "SELECT region_id, cur_calls, pri_calls, cur_hcps, pri_hcps, cur_responses, pri_responses "
        "FROM app.exec_region_windows(%s, %s, %s)",
        (cur_from, cur_to, prior_from),
    )
    return {
        region: {"CALLS": (int(cc), int(pc)), "ENGAGED_HCPS": (int(ch), int(ph)), "RESPONSES": (int(cr), int(pr))}
        for region, cc, pc, ch, ph, cr, pr in cur.fetchall()
    }


def _verdicts(cur: psycopg.Cursor, tuples: list[tuple[int, int, int, int]]) -> list[str]:
    """The approved thresholds, evaluated in the database, for many (latest, prior, latest sample, prior sample) at once."""
    if not tuples:
        return []
    cur.execute(
        "SELECT idx, status FROM app.exec_activity_trend_status(%s::bigint[], %s::bigint[], %s::bigint[], %s::bigint[]) ORDER BY idx",
        ([t[0] for t in tuples], [t[1] for t in tuples], [t[2] for t in tuples], [t[3] for t in tuples]),
    )
    found = {int(i): s for i, s in cur.fetchall()}
    return [found[i + 1] if found.get(i + 1) in _VERDICT else "INSUFFICIENT_SAMPLE" for i in range(len(tuples))]


def trend_rule(cur: psycopg.Cursor) -> dict[str, Any]:
    """The approved thresholds, worded for this view. Whether they are an approved governed definition comes from the DB."""
    base = thresholds(cur)
    window, change, rel = base["minWindowResponses"], base["minTopicResponses"], base["minRelativeIncrease"]
    return {
        "minWindowResponses": window,
        "minChange": change,
        "minRelativeChange": rel,
        "minCell": MIN_CELL,
        "trendDays": TREND_DAYS,
        "rule": (
            f"Each region compares the latest {TREND_DAYS} days with the {TREND_DAYS} days before. Both periods must hold at "
            f"least {window} responses, or the region gets no trend. A figure is rising when it grew by at least {change} and by "
            f"at least {rel * 100:g}% of the earlier figure; falling is the mirror image; anything else is steady. Counts "
            f"below {MIN_CELL} are withheld, so no arrow is drawn from them."
        ),
        "approved": base["approved"],
        "definitionId": base["definitionId"],
        "version": base["version"],
        "approvedAt": base["approvedAt"],
    }


def _change_percent(latest: int, prior: int, hidden: bool) -> float | None:
    return None if hidden or prior <= 0 else round(100.0 * (latest - prior) / prior, 1)


def executive_trends(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    assigned, can_records = _require_executive_scope(cur, identity)
    suppress = not can_records
    try:
        regions = regions_in_scope(cur)
    except NoExecutiveScope as exc:
        raise NoScope("no_executive_territories") from exc
    data_through = exec_data_through(cur)
    through_day = _as_date(data_through) if data_through else None
    frm, to = _window(args, through_day)
    months = _months(frm, to, through_day)
    month_days = [m["month"] for m in months]

    # The latest window ends where the data does, so a trend never reads months after data-through as zero activity.
    last = min(to, through_day) if through_day else to
    trend_to = last
    trend_from = trend_to - dt.timedelta(days=TREND_DAYS - 1)
    prior_to = trend_from - dt.timedelta(days=1)
    prior_from = prior_to - dt.timedelta(days=TREND_DAYS - 1)

    cells, region_totals, month_totals = _read_months(cur, frm, to)
    windows = _read_windows(cur, trend_from, trend_to, prior_from)
    rule = trend_rule(cur)
    region_ids = [r["regionId"] for r in regions]
    hidden = (
        withheld_cells(region_ids, month_days, cells, region_totals, month_totals)
        if suppress
        else {(r, m): (False, False, False) for r in region_ids for m in month_days}
    )

    # One verdict query for every region and metric. The sample gate is the region's responses in both periods.
    keys = [(r, metric) for r in region_ids for metric in METRICS]
    tuples = []
    for r, metric in keys:
        latest, prior = windows.get(r, {}).get(metric, (0, 0))
        sample = windows.get(r, {}).get("RESPONSES", (0, 0))
        tuples.append((latest, prior, sample[0], sample[1]))
    verdicts = dict(zip(keys, _verdicts(cur, tuples)))

    region_rows: list[dict[str, Any]] = []
    suppressed = 0
    for region in regions:
        rid = region["regionId"]
        series = []
        for m in months:
            c, rs, h = cells.get((rid, m["month"]), (0, 0, 0))
            hc, hr, hh = hidden[(rid, m["month"])]
            suppressed += int(hc) + int(hr) + int(hh)
            series.append(
                {
                    "month": m["month"].isoformat(),
                    "isPartial": m["isPartial"],
                    "calls": count(c, hc),
                    "responses": count(rs, hr),
                    "engagedHcps": count(h, hh),
                }
            )
        metrics = []
        sample = windows.get(rid, {}).get("RESPONSES", (0, 0))
        sufficient = sample[0] >= rule["minWindowResponses"] and sample[1] >= rule["minWindowResponses"]
        calls_window = windows.get(rid, {}).get("CALLS", (0, 0))
        for metric in METRICS:
            latest, prior = windows.get(rid, {}).get(metric, (0, 0))
            latest_hidden = suppress and is_small(latest)
            prior_hidden = suppress and is_small(prior)
            # Engaged HCPs ride on the same call rows, so a withheld call count withholds them too.
            if suppress and metric == "ENGAGED_HCPS":
                latest_hidden = latest_hidden or is_small(calls_window[0])
                prior_hidden = prior_hidden or is_small(calls_window[1])
            verdict = verdicts[(rid, metric)]
            trend = verdict if verdict == "INSUFFICIENT_SAMPLE" else ("WITHHELD" if latest_hidden or prior_hidden else verdict)
            suppressed += int(latest_hidden) + int(prior_hidden)
            metrics.append(
                {
                    "metric": metric,
                    "latest": count(latest, latest_hidden),
                    "prior": count(prior, prior_hidden),
                    "changePercent": _change_percent(latest, prior, latest_hidden or prior_hidden),
                    "trend": trend,
                }
            )
        region_rows.append({**region, "sampleSufficient": sufficient, "months": series, "metrics": metrics})

    small = [r["regionName"] for r in region_rows if not r["sampleSufficient"]]
    limitations = [
        f"Trends compare the latest {TREND_DAYS} days ({trend_from.isoformat()} to {trend_to.isoformat()}) with the {TREND_DAYS} days before "
        f"({prior_from.isoformat()} to {prior_to.isoformat()}). They describe what was recorded, never why.",
        "Engaged HCPs are counted at each level, so they do not add up across months or regions.",
    ]
    if small:
        limitations.append(f"Too few responses to judge a trend in {', '.join(small)}: both periods need at least {rule['minWindowResponses']}.")
    if suppressed:
        limitations.append(f"{suppressed} counts between 1 and {MIN_CELL - 1} are withheld, together with the next-smallest value where one would reveal them.")
    if through_day is not None and to > through_day:
        limitations.append("Months after the data-through date are not shown, so they are not read as zero activity.")
    if any(m["isPartial"] for m in months):
        limitations.append("A month marked partial is cut short by the selected dates or the data-through date.")

    log.info(
        "executive trends served",
        user_id=user_id,
        region_count=len(region_rows),
        month_count=len(months),
        suppressed_cells=suppressed,
        aggregate_only=suppress,
    )
    return {
        "from": frm.isoformat(),
        "to": to.isoformat(),
        "trendFrom": trend_from.isoformat(),
        "trendTo": trend_to.isoformat(),
        "priorFrom": prior_from.isoformat(),
        "priorTo": prior_to.isoformat(),
        "dataThrough": data_through.isoformat() if data_through else None,
        "scopeLabel": _scope_label(assigned, sum(r["territoriesInScope"] for r in regions)),
        "accessLevel": "RECORD_DRILLDOWN" if can_records else "AGGREGATE_ONLY",
        "definitionVersion": DEFINITION_VERSION,
        "disclosure": {"minCell": MIN_CELL, "text": disclosure_text(), "suppressedCells": suppressed, "applied": suppress},
        "thresholds": rule,
        "regions": region_rows,
        "sampleLimitations": limitations,
        "note": (
            f"Monthly distinct calls, engaged HCPs and responses for each region you are explicitly authorized for. Arrows compare "
            f"the latest {TREND_DAYS} days with the {TREND_DAYS} before against the approved thresholds."
        ),
    }


__all__ = ["executive_trends", "withheld_cells", "trend_rule", "DEFINITION_VERSION", "TREND_DAYS"]
