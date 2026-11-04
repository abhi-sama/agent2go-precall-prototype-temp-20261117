"""Leadership summaries: generate, reopen, list and export (docs/adr/0013).

The flow follows the approved route (docs/adr/0001): the browser calls FE AppSync, which calls this Lambda, which
calls the AgentCore agent, which calls Bedrock. Deterministic code does everything that must not be generated:

* access: the caller must be an Executive holding ``aggregate.read`` with an in-effect explicit scope, at generation
  and again every time a saved summary is opened, listed or exported;
* evidence: this module gathers the figures (already small-group-suppressed by the shared analysis library) and turns
  them into plain facts the agent restates, each tied to a citation. The model never sees a withheld value;
* freshness: the data-through date and the territories the summary covers.

The agent writes the prose, may cite nothing but the evidence it was handed, and saves the finished summary to FE
DynamoDB itself (docs/adr/0005) under ``SUMMARY#<id>``; this Lambda reads it back through the same narrow role.

Logs carry ids, counts and enums only. Summary text and scope names are never logged.
"""

from __future__ import annotations

import datetime as dt
import re
import uuid
from collections.abc import Callable, Mapping
from typing import Any, Protocol

import psycopg
from a2g_exec_analysis import (
    executive_themes as _themes,
    executive_topic_matrix as _matrix,
    count,
    disclosure_text,
    thresholds,
)
from a2g_logging import get_logger

from .activity import _as_date
from .agent_client import AgentRuntime
from .errors import BadRequest, Forbidden, NoScope, NotFound, Unavailable
from .executive import DEFINITIONS, DEFINITION_VERSION as OVERVIEW_VERSION, _require_executive_scope, _scope_label, _units, executive_overview
from .executive_themes import _run, exec_data_through, theme_window
from .identity import Identity

log = get_logger(__name__)

ID = re.compile(r"^ls-[0-9]{14}-[0-9a-f]{8}$")
MAX_LISTED = 25
TOP_CARDS = 5
TOP_CROSS_REGION = 3
#: AppSync cuts a resolver off at 30 seconds, so the agent call must give up before that.
AGENT_TIMEOUT_SECONDS = 25.0
SUMMARY_PREFIX = "SUMMARY#"


class SummaryStore(Protocol):
    def get(self, user_id: str, summary_id: str) -> dict[str, Any] | None: ...

    def list_for(self, user_id: str) -> list[dict[str, Any]]: ...


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _iso(value: dt.datetime | dt.date | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value.astimezone(dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    return value.isoformat()


def _parse_dt(value: Any) -> dt.datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.UTC)


def _summary_id(args: Mapping[str, Any], name: str = "summaryId") -> str:
    value = args.get(name)
    if not isinstance(value, str) or not ID.match(value):
        raise BadRequest("invalid_summary_id")
    return value


def _new_summary_id(now: dt.datetime) -> str:
    return f"ls-{now.strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"


# --------------------------------------------------------------------------------------------------
# Evidence: plain, suppression-safe facts the agent restates


def _n(cnt: Mapping[str, Any]) -> int | None:
    return None if cnt.get("suppressed") else cnt.get("value")


def _fmt(value: int) -> str:
    return f"{value:,}"


_TREND_WORDS = {
    "RISING": "rising under the approved alert threshold",
    "FALLING": "falling under the approved alert threshold",
    "STEADY": "steady against the period before",
    "INSUFFICIENT_SAMPLE": "too few responses in a period to judge a trend",
    "WITHHELD": "trend withheld because a count behind it is a small group",
}


def _kpi_citation(cid: str, dataset: str, label: str, cnt: Mapping[str, Any]) -> dict[str, Any]:
    value = _n(cnt)
    return {
        "citationId": cid,
        "kind": "AGGREGATE",
        "dataset": dataset,
        "label": f"{label}: {_fmt(value)}" if value is not None else f"{label}: withheld (small group)",
        "responses": count(value, value is None),
        "recordId": None,
        "excerpt": None,
        "interactionDate": None,
    }


def gather_evidence(
    cur: psycopg.Cursor, identity: Identity, user_id: str, frm: dt.date, to: dt.date, *, record_level: bool, scope_label: str
) -> dict[str, Any]:
    """The key figures, facts and citations a leadership summary may rest on. Withheld values are absent."""
    overview = executive_overview(cur, identity, user_id, {"from": frm.isoformat(), "to": to.isoformat()})
    themes = _run(_themes, cur, frm, to, "PORTFOLIO", record_level=record_level)
    matrix = _run(_matrix, cur, frm, to, "PORTFOLIO", None, record_level=record_level)
    window = f"{frm.isoformat()} to {to.isoformat()}"

    kpis = overview["kpis"]
    citations: dict[str, dict[str, Any]] = {}
    key_figures: list[dict[str, Any]] = []
    facts: list[dict[str, Any]] = []

    def add_figure(label: str, cnt: Mapping[str, Any], cid: str, dataset: str, sentence: str) -> None:
        citations[cid] = _kpi_citation(cid, dataset, f"{label} · {scope_label} · {window}", cnt)
        key_figures.append({"label": label, "value": dict(cnt), "citationIds": [cid]})
        value = _n(cnt)
        if value is not None:
            facts.append({"fact_id": f"k-{cid.split(':')[1]}", "section": "overview", "text": sentence.format(n=_fmt(value)), "citation_ids": [cid]})

    add_figure("Distinct calls", kpis["calls"], "kpi:calls", "call_activity", f"{{n}} distinct calls were recorded between {window}.")
    add_figure("Responses", kpis["responses"], "kpi:responses", "hcp_raw_insights", f"{{n}} insight responses were recorded between {window}.")
    add_figure("Engaged HCPs", kpis["engagedHcps"], "kpi:hcps", "call_activity", f"{{n}} distinct HCPs were engaged by calls between {window}.")
    if kpis["reportingCompleteness"] is not None:
        facts.append(
            {
                "fact_id": "k-completeness",
                "section": "overview",
                "text": f"Reporting completeness was {kpis['reportingCompleteness']:g}% of territory-months with a recorded call across {kpis['territoriesInScope']} territories in {kpis['regionsInScope']} regions.",
                "citation_ids": ["kpi:calls"],
            }
        )

    group = themes["groups"][0] if themes["groups"] else None
    if group is not None:
        total, prior_total = _n(group["freeTextResponses"]), _n(group["priorFreeTextResponses"])
        if total is not None:
            key_figures.append({"label": "Free-text responses", "value": dict(group["freeTextResponses"]), "citationIds": []})
        for card in group["cards"][:TOP_CARDS]:
            for citation in card["citations"]:
                citations[citation["citationId"]] = citation
            responses, prior = _n(card["responses"]), _n(card["priorResponses"])
            if responses is None:
                continue
            parts = [f"“{card['topic']}” appears in {_fmt(responses)}"]
            if total is not None:
                parts[0] += f" of {_fmt(total)} free-text responses"
            if card["share"] is not None:
                parts[0] += f" ({card['share']:g}%)"
            if prior is not None and prior_total is not None:
                parts.append(f"against {_fmt(prior)} of {_fmt(prior_total)} in the period before")
            parts.append(_TREND_WORDS[card["trend"]])
            facts.append(
                {
                    "fact_id": f"t-{len(facts)}",
                    "section": "themes",
                    "text": "; ".join(parts) + ".",
                    "citation_ids": [c["citationId"] for c in card["citations"]],
                }
            )

    cross = [row for row in matrix["rows"] if row["crossRegion"]][:TOP_CROSS_REGION]
    region_names = {r["regionId"]: r["regionName"] for r in matrix["regions"]}
    for row in cross:
        listed = [
            f"{region_names[c['regionId']]} ({_fmt(_n(c['responses']))} responses, {c['share']:g}% of its free text)"
            for c in row["cells"]
            if c["trend"] == "RISING" and _n(c["responses"]) is not None and c["share"] is not None
        ]
        cid = f"agg:cells:{row['topic'][:40].lower().replace(' ', '-')}:{frm.isoformat()}:{to.isoformat()}"
        citations[cid] = {
            "citationId": cid,
            "kind": "AGGREGATE",
            "dataset": "hcp_raw_insights",
            "label": f"Free-text responses on “{row['topic']}” by region · {window}",
            "responses": None,
            "recordId": None,
            "excerpt": None,
            "interactionDate": None,
        }
        facts.append(
            {
                "fact_id": f"x-{len(facts)}",
                "section": "crossRegion",
                "text": f"“{row['topic']}” is rising in {row['regionsRising']} regions at once: " + "; ".join(listed) + ".",
                "citation_ids": [cid],
            }
        )
    if not cross:
        cid = f"agg:matrix:{frm.isoformat()}:{to.isoformat()}"
        citations[cid] = {
            "citationId": cid,
            "kind": "AGGREGATE",
            "dataset": "hcp_raw_insights",
            "label": f"Topic-by-region matrix · {scope_label} · {window}",
            "responses": None,
            "recordId": None,
            "excerpt": None,
            "interactionDate": None,
        }
        facts.append(
            {
                "fact_id": f"x-{len(facts)}",
                "section": "crossRegion",
                "text": "No theme meets the approved alert threshold in two or more regions at once in this period.",
                "citation_ids": [cid],
            }
        )

    limitations: list[str] = []
    for text in [*themes["sampleLimitations"], *matrix["sampleLimitations"]]:
        if text not in limitations:
            limitations.append(text)
    rule = thresholds(cur)
    definitions = [
        *({"key": k, "label": label, "text": text} for k, label, text in DEFINITIONS),
        {"key": "theme", "label": "Themes", "text": "A keyword grouping of free-text answers; each response counts under one theme. Derived, not a source fact."},
        {"key": "trend", "label": "Trend arrows", "text": rule["rule"]},
    ]
    return {
        "key_figures": key_figures,
        "facts": facts,
        "evidence": list(citations.values()),
        "sample_limitations": limitations,
        "definitions": definitions,
        "disclosure": themes["disclosure"],
        "definition_version": f"{OVERVIEW_VERSION}+{themes['definitionVersion']}",
        "data_through": overview["dataThrough"],
    }


# --------------------------------------------------------------------------------------------------
# Re-checking access and presenting a saved summary


def _recheck(cur: psycopg.Cursor, identity: Identity, item: Mapping[str, Any]) -> tuple[list[str], bool, list[str]]:
    """Authorize the caller against the summary's own scope NOW. Returns (assigned, record_level, current territories)."""
    assigned, can_records = _require_executive_scope(cur, identity)
    current = [u["territoryId"] for u in _units(cur)]
    saved = set(item.get("scopeTerritoryIds") or [])
    if not saved or not saved <= set(current):
        # A territory left the explicit scope: nothing the summary says about it may be shown again.
        raise Forbidden("scope_changed")
    if item.get("accessLevel") == "RECORD_DRILLDOWN" and not can_records:
        raise Forbidden("record_level_permission_withdrawn")
    return assigned, can_records, current


def _stale_reasons(item: Mapping[str, Any], current_through: dt.datetime | None, current: list[str]) -> list[str]:
    reasons: list[str] = []
    saved_through = _parse_dt(item.get("dataThrough"))
    through = current_through.replace(microsecond=0) if current_through is not None else None
    if through is not None and (saved_through is None or through > saved_through):
        reasons.append("NEWER_DATA_LOADED")
    if set(current) != set(item.get("scopeTerritoryIds") or []):
        reasons.append("SCOPE_CHANGED")
    return reasons


def _statements(items: Any) -> list[dict[str, Any]]:
    return [
        {"statementId": s["statementId"], "section": s.get("section", "overview"), "text": s["text"], "citationIds": list(s.get("citationIds") or [])}
        for s in (items or [])
    ]


def _figures(items: Any) -> list[dict[str, Any]]:
    return [
        {"label": f["label"], "value": {"value": (f.get("value") or {}).get("value"), "suppressed": bool((f.get("value") or {}).get("suppressed"))}, "citationIds": list(f.get("citationIds") or [])}
        for f in (items or [])
    ]


def _citations(items: Any) -> list[dict[str, Any]]:
    out = []
    for c in items or []:
        responses = c.get("responses")
        out.append(
            {
                "citationId": c["citationId"],
                "kind": c.get("kind", "AGGREGATE"),
                "dataset": c.get("dataset", "hcp_raw_insights"),
                "label": c["label"],
                "responses": None if responses is None else {"value": responses.get("value"), "suppressed": bool(responses.get("suppressed"))},
                "recordId": c.get("recordId"),
                "excerpt": c.get("excerpt"),
                "interactionDate": c.get("interactionDate"),
            }
        )
    return out


def present(cur: psycopg.Cursor, identity: Identity, user_id: str, item: Mapping[str, Any]) -> dict[str, Any]:
    """Re-check access, then describe a saved summary with its current staleness."""
    if item.get("ownerUserId") != user_id:
        raise NotFound("summary_not_owned")
    _assigned, _records, current = _recheck(cur, identity, item)
    through = exec_data_through(cur)
    reasons = _stale_reasons(item, through, current)
    return {
        "summaryId": item["summaryId"],
        "title": item["title"],
        "from": item["from"],
        "to": item["to"],
        "dataThrough": item.get("dataThrough"),
        "generatedAt": item["generatedAt"],
        "scopeLabel": item.get("scopeLabel", ""),
        "scopeTerritoryIds": list(item.get("scopeTerritoryIds") or []),
        "accessLevel": item.get("accessLevel", "AGGREGATE_ONLY"),
        "definitionVersion": item.get("definitionVersion", ""),
        "modelMode": item.get("modelMode", "claude"),
        "numberCheck": item.get("numberCheck", "unchecked"),
        "droppedStatements": int(item.get("droppedStatements", 0)),
        "stale": bool(reasons),
        "staleReasons": reasons,
        "currentDataThrough": _iso(through),
        "keyFigures": _figures(item.get("keyFigures")),
        "statements": _statements(item.get("statements")),
        "sampleLimitations": list(item.get("sampleLimitations") or []),
        "definitions": [{"key": d["key"], "label": d["label"], "text": d["text"]} for d in item.get("definitions") or []],
        "citations": _citations(item.get("citations")),
        "disclosure": _disclosure(item.get("disclosure")),
        "regeneratesSummaryId": item.get("regeneratesSummaryId"),
    }


def _disclosure(raw: Any) -> dict[str, Any]:
    raw = raw or {}
    return {
        "minCell": int(raw.get("minCell", 5)),
        "text": raw.get("text") or disclosure_text(),
        "suppressedCells": int(raw.get("suppressedCells", 0)),
        "applied": bool(raw.get("applied", True)),
    }


# --------------------------------------------------------------------------------------------------
# Resolvers


def generate_leadership_summary(
    cur: psycopg.Cursor,
    identity: Identity,
    user_id: str,
    args: Mapping[str, Any],
    *,
    store: SummaryStore,
    runtime: AgentRuntime,
    correlation_id: str,
    now: Callable[[], dt.datetime] = _now,
) -> dict[str, Any]:
    assigned, can_records = _require_executive_scope(cur, identity)
    regenerates = args.get("regeneratesSummaryId")
    if regenerates not in (None, ""):
        _summary_id(args, "regeneratesSummaryId")
    through = exec_data_through(cur)
    frm, to = theme_window(args, _as_date(through) if through else None)
    units = _units(cur)
    scope_label = _scope_label(assigned, len(units))
    evidence = gather_evidence(cur, identity, user_id, frm, to, record_level=can_records, scope_label=scope_label)

    started = now()
    summary_id = _new_summary_id(started)
    task = {
        "type": "leadership_summary",
        "summary_id": summary_id,
        "title": f"Leadership summary · {frm.isoformat()} to {to.isoformat()}",
        "from_date": frm.isoformat(),
        "to_date": to.isoformat(),
        "scope_label": scope_label,
        "scope_territory_ids": sorted(u["territoryId"] for u in units),
        "access_level": "RECORD_DRILLDOWN" if can_records else "AGGREGATE_ONLY",
        "data_through": _iso(through),
        "definition_version": evidence["definition_version"],
        "regenerates_summary_id": regenerates or None,
        "key_figures": evidence["key_figures"],
        "facts": evidence["facts"],
        "sample_limitations": evidence["sample_limitations"],
        "definitions": evidence["definitions"],
        "disclosure": evidence["disclosure"],
        "evidence": evidence["evidence"],
    }
    payload = {
        "identity": {
            "user_id": user_id,
            "persona": identity.db_persona,
            "full_name": identity.full_name,
            "email": identity.email,
            "correlation_id": correlation_id,
        },
        "thread_id": summary_id,
        "run_id": summary_id,
        "messages": [{"role": "user", "content": "Write the leadership summary."}],
        "task": task,
    }
    saved = False
    try:
        for event in runtime.invoke(payload, timeout=AGENT_TIMEOUT_SECONDS):
            kind = event.get("type")
            if kind == "RUN_ERROR":
                raise Unavailable("summary_generation_failed")
            if kind == "CUSTOM" and event.get("name") == "summary_saved":
                saved = bool((event.get("value") or {}).get("saved"))
            if kind == "RUN_FINISHED":
                break
    except Unavailable:
        raise
    except Exception as exc:
        log.error("summary agent call failed", summary_id=summary_id, error_type=type(exc).__name__)
        raise Unavailable("summary_agent") from exc
    if not saved:
        raise Unavailable("summary_not_saved")
    item = store.get(user_id, summary_id)
    if item is None:
        raise Unavailable("summary_not_persisted")
    log.info(
        "leadership summary generated",
        summary_id=summary_id,
        user_id=user_id,
        count=len(item.get("citations") or []),
        outcome="ok",
    )
    return present(cur, identity, user_id, item)


def get_leadership_summary(
    cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, store: SummaryStore
) -> dict[str, Any]:
    summary_id = _summary_id(args)
    item = store.get(user_id, summary_id)
    if item is None:
        raise NotFound("unknown_summary")
    result = present(cur, identity, user_id, item)  # raises Forbidden when the scope or permission changed
    log.info("leadership summary opened", summary_id=summary_id, user_id=user_id, outcome="stale" if result["stale"] else "current")
    return result


def my_leadership_summaries(
    cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, store: SummaryStore
) -> list[dict[str, Any]]:
    if identity.persona != "executive":
        raise Forbidden("executive_only")  # nobody else has leadership summaries, not even an empty list
    out: list[dict[str, Any]] = []
    through = None
    try:
        through = exec_data_through(cur)
    except psycopg.Error:
        through = None
    for item in store.list_for(user_id):
        if item.get("ownerUserId") != user_id:
            continue
        accessible, stale = True, False
        try:
            _assigned, _records, current = _recheck(cur, identity, item)
            stale = bool(_stale_reasons(item, through, current))
        except (Forbidden, NotFound, NoScope):
            accessible = False  # kept in the list so the owner sees why it cannot be opened; nothing else is revealed
        out.append(
            {
                "summaryId": item["summaryId"],
                "title": item["title"] if accessible else None,
                "from": item["from"] if accessible else None,
                "to": item["to"] if accessible else None,
                "generatedAt": item["generatedAt"],
                "dataThrough": item.get("dataThrough") if accessible else None,
                "accessible": accessible,
                "stale": stale,
            }
        )
    log.info("leadership summaries listed", user_id=user_id, count=len(out))
    return out


def export_leadership_summary(
    cur: psycopg.Cursor,
    identity: Identity,
    user_id: str,
    args: Mapping[str, Any],
    *,
    store: SummaryStore,
    now: Callable[[], dt.datetime] = _now,
) -> dict[str, Any]:
    """Authorize a printable snapshot and record only its id-level audit trail.

    ``present`` deliberately runs first: it owns the owner check and the CURRENT scope and permission re-check, so a
    territory change or a withdrawn permission refuses the export before any document or audit event exists.
    """
    summary_id = _summary_id(args)
    item = store.get(user_id, summary_id)
    if item is None:
        raise NotFound("unknown_summary")
    summary = present(cur, identity, user_id, item)
    exported_at = _iso(now())
    cur.execute(
        "INSERT INTO audit_events(actor_user_id, action, resource_type, resource_id, outcome, correlation_id) "
        "VALUES (%s, %s, %s, %s, %s, current_setting('app.correlation_id', true))",
        (user_id, "leadership_summary.exported", "leadership_summary", summary_id, "allowed"),
    )
    log.info("leadership summary exported", summary_id=summary_id, user_id=user_id, citation_count=len(summary["citations"]), outcome="allowed")
    return {
        "summaryId": summary_id,
        "title": summary["title"],
        "scopeLabel": summary["scopeLabel"],
        "from": summary["from"],
        "to": summary["to"],
        "dataThrough": summary["dataThrough"],
        "generatedAt": summary["generatedAt"],
        "exportedAt": exported_at,
        "accessLevel": summary["accessLevel"],
        "definitionVersion": summary["definitionVersion"],
        "keyFigures": summary["keyFigures"],
        "statements": summary["statements"],
        "sampleLimitations": summary["sampleLimitations"],
        "definitions": summary["definitions"],
        "citations": summary["citations"],
        "disclosureText": summary["disclosure"]["text"],
    }


__all__ = [
    "export_leadership_summary",
    "gather_evidence",
    "generate_leadership_summary",
    "get_leadership_summary",
    "my_leadership_summaries",
    "present",
]
