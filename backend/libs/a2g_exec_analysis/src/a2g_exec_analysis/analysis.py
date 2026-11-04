"""Executive theme cards and the topic-by-region matrix (docs/adr/0013).

Both the API Lambda (dashboard, leadership summaries) and the agent (organisational chat) call this module with a
cursor already bound to the Executive's verified identity (``app.set_request_identity``). Every number comes from the
SECURITY DEFINER functions of migrations 009 and 011, which return counts for the EXPLICIT executive scope only and
nothing for anyone else. Small-group disclosure is applied here, once, so every consumer hides the same cells.

Definitions (``DEFINITION_VERSION``):

* A *free-text response* is a non-blank, non-excluded answer to an ``open_text`` question, counted once per
  ``uniq_rspns_id``. Its *theme* is ``app.theme_of(answer)``: a transparent keyword baseline, always shown as derived.
* A *trend* compares the window with the immediately preceding window of equal length using the approved rule
  (``app.emerging_thresholds`` / ``app.emerging_status``, the same rule the Director sees). RISING and FALLING are
  changes in what was recorded, never causes.
* A *facet* groups responses by portfolio (all), molecule, disease area (tumor type from the catalog) or study.

Disclosure: a count of 1 to 4 is withheld. A theme card's response count is withheld whenever any region cell of that
theme is withheld, because the card is the sum of its row of the matrix; a region's denominator keeps complementary
suppression against its column. With record-level permission (``record_level=True``) nothing is withheld.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field
from typing import Any

from .disclosure import MIN_CELL, count, disclosure_text, is_small, suppress_flags

DEFINITION_VERSION = "executive-themes-v1"
OTHER_THEME = "Other perspectives"
FACETS = {"PORTFOLIO": "Portfolio", "MOLECULE": "Molecule", "DISEASE_AREA": "Disease area", "STUDY": "Study"}
MAX_GROUPS = 6
CARDS_PER_GROUP = 5
RECORD_CITATIONS = 2
EXCERPT_CHARS = 280
MAX_WINDOW_DAYS = 731

_TREND = {"EMERGING": "RISING", "DECLINING": "FALLING", "STABLE": "STEADY", "INSUFFICIENT_SAMPLE": "INSUFFICIENT_SAMPLE"}
_SLUG = re.compile(r"[^a-z0-9]+")


class InvalidFacet(ValueError):
    """The facet is not one of ``FACETS``."""


class InvalidFacetValue(ValueError):
    """The facet value names no group in the Executive's scope (same answer for an unknown and an out-of-scope value)."""


class InvalidWindow(ValueError):
    """The window is empty, reversed or longer than ``MAX_WINDOW_DAYS``."""


class NoExecutiveScope(LookupError):
    """The session holds no in-effect explicit executive territory."""


@dataclass(frozen=True)
class Cnt:
    cur: int = 0
    pri: int = 0
    cur_hcps: int = 0
    pri_hcps: int = 0


@dataclass
class _Counts:
    groups: dict[str, Cnt] = field(default_factory=dict)
    regions: dict[tuple[str, str], Cnt] = field(default_factory=dict)
    themes: dict[tuple[str, str], Cnt] = field(default_factory=dict)
    cells: dict[tuple[str, str, str], Cnt] = field(default_factory=dict)


def slug(text: str) -> str:
    return _SLUG.sub("-", text.lower()).strip("-")[:48] or "x"


def check_facet(facet: str | None) -> str:
    value = (facet or "PORTFOLIO").upper()
    if value not in FACETS:
        raise InvalidFacet(value)
    return value


def windows(frm: dt.date, to: dt.date) -> tuple[dt.date, dt.date]:
    """The prior window: equal length, ending the day before ``frm``. Returns (prior_from, prior_to)."""
    days = (to - frm).days + 1
    if days < 1 or days > MAX_WINDOW_DAYS:
        raise InvalidWindow(f"{days}")
    prior_to = frm - dt.timedelta(days=1)
    return prior_to - dt.timedelta(days=days - 1), prior_to


def _iso(day: dt.date) -> str:
    return day.isoformat()


def _clip(text: str | None, limit: int = EXCERPT_CHARS) -> str:
    value = " ".join((text or "").split())
    return value if len(value) <= limit else value[: limit - 1] + "…"


# --------------------------------------------------------------------------------------------------
# Reading the counts


def regions_in_scope(cur: Any) -> list[dict[str, Any]]:
    cur.execute(
        "SELECT region_id, min(region_name), count(*) FROM app.exec_units() GROUP BY region_id ORDER BY region_id"
    )
    rows = [{"regionId": r, "regionName": n, "territoriesInScope": int(c)} for r, n, c in cur.fetchall()]
    if not rows:
        raise NoExecutiveScope("no_executive_territories")
    return rows


def _fetch(cur: Any, frm: dt.date, to: dt.date, prior_from: dt.date, facet: str) -> _Counts:
    cur.execute(
        "SELECT level, facet_value, region_id, topic, cur_n, pri_n, cur_hcps, pri_hcps "
        "FROM app.exec_theme_counts(%s, %s, %s, %s)",
        (frm, to, prior_from, facet),
    )
    out = _Counts()
    for level, fv, region, topic, cur_n, pri_n, cur_h, pri_h in cur.fetchall():
        c = Cnt(int(cur_n), int(pri_n), int(cur_h), int(pri_h))
        if level == "GROUP":
            out.groups[fv] = c
        elif level == "REGION":
            out.regions[(fv, region)] = c
        elif level == "THEME":
            out.themes[(fv, topic)] = c
        else:
            out.cells[(fv, region, topic)] = c
    return out


def _statuses(cur: Any, tuples: list[tuple[int, int, int, int]]) -> list[str]:
    """The approved emerging-topic rule, evaluated in the database, for many tuples in one round trip."""
    if not tuples:
        return []
    cur.execute(
        "SELECT idx, status FROM app.exec_trend_status(%s::bigint[], %s::bigint[], %s::bigint[], %s::bigint[]) ORDER BY idx",
        ([t[0] for t in tuples], [t[1] for t in tuples], [t[2] for t in tuples], [t[3] for t in tuples]),
    )
    found = {int(i): s for i, s in cur.fetchall()}
    return [_TREND[found[i + 1]] if i + 1 in found else "INSUFFICIENT_SAMPLE" for i in range(len(tuples))]


def thresholds(cur: Any) -> dict[str, Any]:
    cur.execute("SELECT min_window_responses, min_topic_responses, min_relative_increase, min_share_points FROM app.emerging_thresholds()")
    window, topic, rel, points = cur.fetchone()
    cur.execute("SELECT definition_id, version, approved_at FROM app.exec_threshold_definition()")
    approved = cur.fetchone()
    return {
        "minWindowResponses": int(window),
        "minTopicResponses": int(topic),
        "minRelativeIncrease": float(rel),
        "minSharePoints": float(points),
        "minCell": MIN_CELL,
        "rule": (
            f"A theme is rising when both periods hold at least {int(window)} free-text responses, the theme has at least "
            f"{int(topic)} responses in the latest period, its share of responses rose by at least {float(points):g} "
            f"percentage points, and that share is at least {1 + float(rel):g} times the earlier share (or it had none before). "
            f"Falling is the mirror image. Counts below {MIN_CELL} are withheld, so no arrow is drawn from them."
        ),
        "approved": approved is not None,
        "definitionId": approved[0] if approved else None,
        "version": int(approved[1]) if approved else None,
        "approvedAt": approved[2].isoformat() if approved and approved[2] else None,
    }


# --------------------------------------------------------------------------------------------------
# Disclosure for one facet value


@dataclass
class _Flags:
    """Which counts of one facet value are withheld, per window ('cur' / 'pri')."""

    group: dict[str, bool]
    region: dict[tuple[str, str], bool]  # (window, region)
    cell: dict[tuple[str, str, str], bool]  # (window, region, topic)
    row: dict[tuple[str, str], bool]  # (window, topic): any cell of the row is withheld


def _window_value(c: Cnt, window: str) -> int:
    return c.cur if window == "cur" else c.pri


def _flags_for(
    fv: str, region_ids: list[str], topics: list[str], counts: _Counts, *, suppress: bool
) -> _Flags:
    flags = _Flags(group={}, region={}, cell={}, row={})
    for window in ("cur", "pri"):
        group_total = _window_value(counts.groups.get(fv, Cnt()), window)
        region_totals = [_window_value(counts.regions.get((fv, r), Cnt()), window) for r in region_ids]
        if not suppress:
            flags.group[window] = False
            for r in region_ids:
                flags.region[(window, r)] = False
                for t in topics:
                    flags.cell[(window, r, t)] = False
            for t in topics:
                flags.row[(window, t)] = False
            continue
        region_hidden, group_hidden = suppress_flags(region_totals, group_total, additive=True)
        flags.group[window] = group_hidden
        for r, hidden, total in zip(region_ids, region_hidden, region_totals):
            values = [_window_value(counts.cells.get((fv, r, t), Cnt()), window) for t in topics]
            cell_hidden, total_hidden = suppress_flags(values, total, additive=True)
            flags.region[(window, r)] = hidden or total_hidden
            for t, h in zip(topics, cell_hidden):
                flags.cell[(window, r, t)] = h
        for t in topics:
            flags.row[(window, t)] = any(flags.cell[(window, r, t)] for r in region_ids)
    return flags


def _count_cells(flags: _Flags) -> int:
    return (
        sum(1 for v in flags.group.values() if v)
        + sum(1 for v in flags.region.values() if v)
        + sum(1 for v in flags.cell.values() if v)
    )


def _topic_order(counts: _Counts, fv: str) -> list[str]:
    totals = {t: c.cur for (v, t), c in counts.themes.items() if v == fv}
    prior = {t: c.pri for (v, t), c in counts.themes.items() if v == fv}
    names = set(totals) | set(prior)
    return sorted(names, key=lambda t: (t == OTHER_THEME, -(totals.get(t, 0)), -(prior.get(t, 0)), t))


def _facet_values(counts: _Counts) -> list[str]:
    return sorted(counts.groups, key=lambda v: (-(counts.groups[v].cur + counts.groups[v].pri), v))


# --------------------------------------------------------------------------------------------------
# Citations


def _label_size(n: int | None, hcps: int | None, regions: int | None) -> str:
    if n is None:
        return ""
    parts = [f"{n} response{'s' if n != 1 else ''}"]
    if hcps is not None:
        parts[0] += f" from {hcps} HCP{'s' if hcps != 1 else ''}"
    if regions is not None:
        parts.append(f"{regions} region{'s' if regions != 1 else ''}")
    return ": " + " in ".join(parts)


def aggregate_citation(
    facet: str, fv: str, topic: str, frm: dt.date, to: dt.date, *, responses: int | None, hcps: int | None, regions: int | None
) -> dict[str, Any]:
    """A citation that names a SET of responses by its filters and size. It opens no record."""
    where = "" if facet == "PORTFOLIO" else f" · {FACETS[facet].lower()} {fv}"
    return {
        "citationId": f"agg:theme:{facet.lower()}:{slug(fv)}:{slug(topic)}:{_iso(frm)}:{_iso(to)}",
        "kind": "AGGREGATE",
        "dataset": "hcp_raw_insights",
        "label": f"Free-text responses on “{topic}”{where} · {_iso(frm)} to {_iso(to)}{_label_size(responses, hcps, regions)}",
        "responses": count(responses, responses is None),
        "recordId": None,
        "excerpt": None,
        "interactionDate": None,
    }


def _record_citations(cur: Any, frm: dt.date, to: dt.date, facet: str, fv: str, topic: str) -> list[dict[str, Any]]:
    cur.execute(
        "SELECT record_id, territory_id, interaction_date, excerpt, question_text "
        "FROM app.exec_theme_records(%s, %s, %s, %s, %s, %s)",
        (frm, to, facet, fv, topic, RECORD_CITATIONS),
    )
    return [
        {
            "citationId": f"rsp:{rid}",
            "kind": "RECORD",
            "dataset": "hcp_raw_insights",
            "label": f"Recorded response · {day.isoformat() if day else 'undated'} · {territory}",
            "responses": None,
            "recordId": rid,
            "excerpt": _clip(excerpt),
            "interactionDate": day.isoformat() if day else None,
        }
        for rid, territory, day, excerpt, _question in cur.fetchall()
    ]


# --------------------------------------------------------------------------------------------------
# Sample limitations


def _limitations(
    *,
    frm: dt.date,
    to: dt.date,
    prior_from: dt.date,
    prior_to: dt.date,
    thresholds_: dict[str, Any],
    group_totals: list[tuple[str, int | None, int | None]],
    small_regions: list[str],
    anything_withheld: bool,
    record_level: bool,
) -> list[str]:
    minimum = thresholds_["minWindowResponses"]
    out: list[str] = []
    sized = [(fv, c, p) for fv, c, p in group_totals if c is not None and p is not None]
    if len(sized) == 1:
        fv, c, p = sized[0]
        out.append(
            f"Based on {c} free-text responses between {_iso(frm)} and {_iso(to)}, compared with {p} in the equal period "
            f"{_iso(prior_from)} to {_iso(prior_to)}. Only answers to open-text questions are included."
        )
    elif sized:
        total_c, total_p = sum(c for _f, c, _p in sized), sum(p for _f, _c, p in sized)
        out.append(
            f"Based on {total_c} free-text responses between {_iso(frm)} and {_iso(to)}, compared with {total_p} in the "
            f"equal period {_iso(prior_from)} to {_iso(prior_to)}. Only answers to open-text questions are included."
        )
    else:
        out.append(
            f"Based on the free-text responses between {_iso(frm)} and {_iso(to)}, compared with the equal period "
            f"{_iso(prior_from)} to {_iso(prior_to)}; the totals are small and withheld. Only answers to open-text questions are included."
        )
    out.append(
        "HCPs reached by field teams are not a random sample: responses reflect who was engaged and who answered, "
        "so they describe what was recorded, not what all HCPs think."
    )
    out.append(
        "Themes group free text by keyword and each response counts under one theme, so a theme can miss wording it "
        "does not recognise. They are derived groupings, not source facts."
    )
    if small_regions:
        names = ", ".join(small_regions[:4]) + (f" and {len(small_regions) - 4} more" if len(small_regions) > 4 else "")
        out.append(
            f"{names} hold fewer than {minimum} free-text responses in at least one of the two periods, so no trend "
            "is judged there."
        )
    if anything_withheld and not record_level:
        out.append(
            f"Counts below {MIN_CELL} are withheld to protect small groups, and where a withheld count could be worked "
            "out by subtraction another count is withheld too."
        )
    out.append("Changes between the two periods show that more or fewer responses mention a theme, not why.")
    return out


# --------------------------------------------------------------------------------------------------
# Theme cards


def executive_themes(
    cur: Any, frm: dt.date, to: dt.date, facet: str = "PORTFOLIO", *, record_level: bool = False
) -> dict[str, Any]:
    """Theme cards per facet value with trend arrows, counts and citations."""
    facet = check_facet(facet)
    prior_from, prior_to = windows(frm, to)
    regions = regions_in_scope(cur)
    region_ids = [r["regionId"] for r in regions]
    counts = _fetch(cur, frm, to, prior_from, facet)
    rule = thresholds(cur)
    suppress = not record_level
    values = _facet_values(counts)

    groups: list[dict[str, Any]] = []
    limitation_totals: list[tuple[str, int | None, int | None]] = []
    withheld_cells = 0
    small_regions: set[str] = set()
    pending: list[tuple[int, dict[str, Any], tuple[int, int, int, int], bool]] = []
    tuples: list[tuple[int, int, int, int]] = []

    for fv in values[:MAX_GROUPS]:
        topics = _topic_order(counts, fv)
        flags = _flags_for(fv, region_ids, topics, counts, suppress=suppress)
        withheld_cells += _count_cells(flags)
        group = counts.groups[fv]
        cur_hidden, pri_hidden = flags.group["cur"], flags.group["pri"]
        limitation_totals.append((fv, None if cur_hidden else group.cur, None if pri_hidden else group.pri))
        for r in regions:
            rc = counts.regions.get((fv, r["regionId"]), Cnt())
            if rc.cur < rule["minWindowResponses"] or rc.pri < rule["minWindowResponses"]:
                small_regions.add(r["regionName"])
        cards: list[dict[str, Any]] = []
        for topic in topics:
            theme = counts.themes.get((fv, topic), Cnt())
            row_cur, row_pri = flags.row[("cur", topic)], flags.row[("pri", topic)]
            hcps_cur_hidden = row_cur or is_small(theme.cur_hcps) and suppress
            cell_regions = [r for r in region_ids if counts.cells.get((fv, r, topic), Cnt()).cur > 0 and not flags.cell[("cur", r, topic)]]
            card = {
                "cardId": f"{facet}:{slug(fv)}:{slug(topic)}",
                "facetValue": fv,
                "topic": topic,
                "responses": count(theme.cur, row_cur),
                "priorResponses": count(theme.pri, row_pri),
                "distinctHcps": count(theme.cur_hcps, hcps_cur_hidden),
                "share": None
                if row_cur or cur_hidden or not group.cur
                else round(100.0 * theme.cur / group.cur, 1),
                "regionCount": len(cell_regions),
                "trend": "WITHHELD",
                "citations": [],
                "_isOther": topic == OTHER_THEME,
            }
            cards.append(card)
            tuples.append((theme.cur, theme.pri, group.cur, group.pri))
            pending.append((len(tuples) - 1, card, (theme.cur, theme.pri, group.cur, group.pri), row_cur or row_pri or cur_hidden or pri_hidden))
        shown = [c for c in cards if not c["responses"]["suppressed"] and c["responses"]["value"]]
        shown.sort(key=lambda c: (c["_isOther"], -c["responses"]["value"], c["topic"]))
        groups.append(
            {
                "facetValue": fv,
                "freeTextResponses": count(group.cur, cur_hidden),
                "priorFreeTextResponses": count(group.pri, pri_hidden),
                "regionCount": sum(1 for r in region_ids if counts.regions.get((fv, r), Cnt()).cur > 0 and not flags.region[("cur", r)]),
                "cards": shown[:CARDS_PER_GROUP],
            }
        )

    statuses = _statuses(cur, tuples)
    for index, card, _tuple, hidden in pending:
        status = statuses[index]
        card["trend"] = "INSUFFICIENT_SAMPLE" if status == "INSUFFICIENT_SAMPLE" else ("WITHHELD" if hidden else status)

    for group in groups:
        fv = group["facetValue"]
        for card in group["cards"]:
            theme = counts.themes[(fv, card["topic"])]
            visible = not card["responses"]["suppressed"]
            card["citations"] = [
                aggregate_citation(
                    facet, fv, card["topic"], frm, to,
                    responses=theme.cur if visible else None,
                    hcps=None if card["distinctHcps"]["suppressed"] else theme.cur_hcps,
                    regions=card["regionCount"] if visible else None,
                )
            ]
            if record_level:
                card["citations"].extend(_record_citations(cur, frm, to, facet, fv, card["topic"]))
            card.pop("_isOther", None)

    return {
        "from": _iso(frm),
        "to": _iso(to),
        "priorFrom": _iso(prior_from),
        "priorTo": _iso(prior_to),
        "facet": facet,
        "facetLabel": FACETS[facet],
        "definitionVersion": DEFINITION_VERSION,
        "groups": groups,
        "groupsLeftOut": max(0, len(values) - MAX_GROUPS),
        "sampleLimitations": _limitations(
            frm=frm, to=to, prior_from=prior_from, prior_to=prior_to, thresholds_=rule,
            group_totals=limitation_totals, small_regions=sorted(small_regions),
            anything_withheld=withheld_cells > 0, record_level=record_level,
        ),
        "disclosure": {
            "minCell": MIN_CELL,
            "text": disclosure_text(),
            "suppressedCells": withheld_cells,
            "applied": suppress,
        },
        "note": (
            "Themes group free-text answers by keyword. They are derived, not source facts. "
            "Each card cites the set of responses behind it."
        ),
    }


# --------------------------------------------------------------------------------------------------
# Topic-by-region matrix


def executive_topic_matrix(
    cur: Any,
    frm: dt.date,
    to: dt.date,
    facet: str = "PORTFOLIO",
    facet_value: str | None = None,
    *,
    record_level: bool = False,
) -> dict[str, Any]:
    """Topics (rows) by regions (columns): counts, shares, trend arrows and the approved alert thresholds."""
    facet = check_facet(facet)
    prior_from, prior_to = windows(frm, to)
    regions = regions_in_scope(cur)
    region_ids = [r["regionId"] for r in regions]
    counts = _fetch(cur, frm, to, prior_from, facet)
    rule = thresholds(cur)
    suppress = not record_level

    # PORTFOLIO is the whole scope as one group; any other facet reads one of its values (the largest by default).
    available = _facet_values(counts)
    if facet == "PORTFOLIO":
        if facet_value not in (None, "", "Portfolio"):
            raise InvalidFacetValue(facet_value)
        fv = "Portfolio"
    else:
        fv = facet_value or (available[0] if available else "")
        if available and fv not in counts.groups:
            raise InvalidFacetValue(fv)
        if not available and facet_value:
            raise InvalidFacetValue(facet_value)
    topics = _topic_order(counts, fv) if fv in counts.groups else []
    flags = _flags_for(fv, region_ids, topics, counts, suppress=suppress)
    group = counts.groups.get(fv, Cnt())

    tuples: list[tuple[int, int, int, int]] = []
    for topic in topics:
        for r in region_ids:
            cell = counts.cells.get((fv, r, topic), Cnt())
            reg = counts.regions.get((fv, r), Cnt())
            tuples.append((cell.cur, cell.pri, reg.cur, reg.pri))
    statuses = _statuses(cur, tuples)

    region_rows: list[dict[str, Any]] = []
    small_regions: list[str] = []
    for r in regions:
        reg = counts.regions.get((fv, r["regionId"]), Cnt())
        sufficient = reg.cur >= rule["minWindowResponses"] and reg.pri >= rule["minWindowResponses"]
        if not sufficient:
            small_regions.append(r["regionName"])
        region_rows.append(
            {
                **r,
                "freeTextResponses": count(reg.cur, flags.region[("cur", r["regionId"])]),
                "priorFreeTextResponses": count(reg.pri, flags.region[("pri", r["regionId"])]),
                "sampleSufficient": sufficient,
            }
        )

    rows: list[dict[str, Any]] = []
    index = 0
    for topic in topics:
        cells: list[dict[str, Any]] = []
        for r in region_ids:
            cell = counts.cells.get((fv, r, topic), Cnt())
            reg = counts.regions.get((fv, r), Cnt())
            status = statuses[index]
            index += 1
            cur_hidden, pri_hidden = flags.cell[("cur", r, topic)], flags.cell[("pri", r, topic)]
            reg_cur_hidden, reg_pri_hidden = flags.region[("cur", r)], flags.region[("pri", r)]
            hidden_any = cur_hidden or pri_hidden or reg_cur_hidden or reg_pri_hidden
            trend = "INSUFFICIENT_SAMPLE" if status == "INSUFFICIENT_SAMPLE" else ("WITHHELD" if hidden_any else status)
            share = None if cur_hidden or reg_cur_hidden or not reg.cur else round(100.0 * cell.cur / reg.cur, 1)
            prior_share = None if pri_hidden or reg_pri_hidden or not reg.pri else round(100.0 * cell.pri / reg.pri, 1)
            cells.append(
                {
                    "regionId": r,
                    "responses": count(cell.cur, cur_hidden),
                    "priorResponses": count(cell.pri, pri_hidden),
                    "share": share,
                    "priorShare": prior_share,
                    "sharePointChange": round(share - prior_share, 1) if share is not None and prior_share is not None else None,
                    "trend": trend,
                    "alert": trend == "RISING",
                }
            )
        rising = sum(1 for c in cells if c["trend"] == "RISING")
        rows.append(
            {
                "topic": topic,
                "isOther": topic == OTHER_THEME,
                "cells": cells,
                "regionsRising": rising,
                "regionsFalling": sum(1 for c in cells if c["trend"] == "FALLING"),
                "crossRegion": rising >= 2,
            }
        )

    withheld_cells = _count_cells(flags)
    group_cur_hidden, group_pri_hidden = flags.group["cur"], flags.group["pri"]
    return {
        "from": _iso(frm),
        "to": _iso(to),
        "priorFrom": _iso(prior_from),
        "priorTo": _iso(prior_to),
        "facet": facet,
        "facetValue": None if facet == "PORTFOLIO" else fv,
        "definitionVersion": DEFINITION_VERSION,
        "thresholds": rule,
        "regions": region_rows,
        "rows": rows,
        "sampleLimitations": _limitations(
            frm=frm, to=to, prior_from=prior_from, prior_to=prior_to, thresholds_=rule,
            group_totals=[(fv, None if group_cur_hidden else group.cur, None if group_pri_hidden else group.pri)],
            small_regions=small_regions, anything_withheld=withheld_cells > 0, record_level=record_level,
        ),
        "disclosure": {
            "minCell": MIN_CELL,
            "text": disclosure_text(),
            "suppressedCells": withheld_cells,
            "applied": suppress,
        },
        "note": (
            "Each cell compares a theme's share of a region's free-text responses with the equal period before. "
            "Arrows follow the approved alert thresholds shown here; they describe recorded responses, not causes."
        ),
    }


__all__ = [
    "DEFINITION_VERSION",
    "FACETS",
    "InvalidFacet",
    "InvalidFacetValue",
    "InvalidWindow",
    "NoExecutiveScope",
    "aggregate_citation",
    "check_facet",
    "executive_themes",
    "executive_topic_matrix",
    "regions_in_scope",
    "thresholds",
    "windows",
]
