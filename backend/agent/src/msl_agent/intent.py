"""Deterministic floor for the "every trend or comparison gets a chart" rule.

The model normally picks a chart itself (``show_chart``). If it answered a clearly quantitative comparison or
trend question without one, the runtime runs the same deterministic chart query from the question's own words.
This only chooses *which* query to run; every plotted number still comes from SQL under RLS.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class ChartRequest:
    metric: str
    group_by: str
    chart_type: str = "auto"
    topic: str = ""


_TREND = re.compile(
    r"\b(trend|trends|over time|by month|per month|monthly|each month|by week|per week|weekly|week by week|month by month)\b",
    re.I,
)
_COMPARE = re.compile(
    r"\b(compare|comparison|versus|vs\.?|by territory|per territory|each territory|across territories|which territory|"
    r"by product|per product|by molecule|per molecule|by program|per program|rank|ranking|top \d+|breakdown|break down|split)\b",
    re.I,
)
_HEATMAP = re.compile(r"\b(heat ?map|matrix|grid)\b", re.I)
_TABLE = re.compile(r"\b(table|tabulate)\b", re.I)
_TIMELINE = re.compile(r"\b(timeline|day by day|daily)\b", re.I)


def _metric(question: str) -> str:
    q = question.lower()
    if re.search(r"\b(hcps?|doctors?|physicians?|engaged)\b", q) and "recorded" not in q:
        return "engaged_hcps"
    if re.search(r"\b(responses?|insights?|said|recorded|feedback|themes?|answers?)\b", q):
        return "responses"
    return "calls"


def _group(question: str, metric: str) -> str:
    q = question.lower()
    if re.search(r"\b(product|molecule|drug)s?\b", q):
        return "product"
    if re.search(r"\bprogram\b|\bsurvey\b", q) and metric == "responses":
        return "program"
    return "territory"


def infer_chart_request(question: str) -> ChartRequest | None:
    metric = _metric(question)
    if _HEATMAP.search(question):
        return ChartRequest(metric, _group(question, metric), "heatmap")
    if _TIMELINE.search(question):
        return ChartRequest(metric, "week", "timeline")
    if _TABLE.search(question):
        return ChartRequest(metric, _group(question, metric), "table")
    if _TREND.search(question):
        return ChartRequest(metric, "week" if re.search(r"\b(week|weekly)\b", question, re.I) else "month")
    if _COMPARE.search(question):
        return ChartRequest(metric, _group(question, metric), "bar")
    return None


_REGIONAL = re.compile(r"\b(regions?|regional|cross[- ]region|matrix|across|emerging|rising|which regions?)\b", re.I)


def wants_region_matrix(question: str) -> bool:
    """Whether an Executive question is about topics across regions (so the matrix is the right evidence)."""
    return bool(_REGIONAL.search(question))


def infer_executive_facet(question: str) -> str:
    """Which grouping of themes an Executive question names. Only chooses *which* deterministic query to run."""
    q = question.lower()
    if re.search(r"\b(molecules?|drugs?|products?)\b", q):
        return "MOLECULE"
    if re.search(r"\b(disease areas?|landscapes?|tumou?rs?)\b", q):
        return "DISEASE_AREA"
    if re.search(r"\b(stud(?:y|ies)|trials?)\b", q):
        return "STUDY"
    return "PORTFOLIO"
