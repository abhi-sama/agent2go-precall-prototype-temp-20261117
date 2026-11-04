"""Visual specs for the chat: the AG-UI ``visual`` event payload, built only from deterministic query results.

A visual is data, not markup. The browser draws it with the shared chart components; the model never sees or
writes a plotted value. Builders here take a ``ChartResult`` (SQL under RLS) and return a ``Visual``; the same
numbers go back to the model as a short summary so its prose can quote them (and ``numbers.py`` checks that it did).
"""

from __future__ import annotations

import datetime as dt
import json
from typing import Any, Literal

from pydantic import BaseModel, Field

from . import chart_data
from .chart_data import GROUP_LABELS, METRIC_DEFINITIONS, METRIC_LABELS, METRIC_UNITS
from .repository import ChartResult

VisualKind = Literal["bar", "line", "distribution", "heatmap", "timeline", "table"]
ChartType = Literal["auto", "line", "bar", "timeline", "heatmap", "table"]
CHART_TYPES = ("auto", "line", "bar", "timeline", "heatmap", "table")


class VisualPoint(BaseModel):
    key: str
    label: str
    value: int
    #: Share of the period total, to one decimal; only where the groups cannot overlap (never for HCPs).
    share_pct: float | None = None
    #: A time bucket the period only partly covers (first or last month or week).
    partial: bool = False


class VisualRow(BaseModel):
    key: str
    label: str
    values: list[int]


class Visual(BaseModel):
    visual_id: str
    kind: VisualKind
    title: str
    subtitle: str = ""
    metric: str = ""
    unit: str = ""
    period: str = ""
    scope: str = ""
    definition: str = ""
    data_through: str | None = None
    total: int | None = None
    left_out: int = 0
    points: list[VisualPoint] = Field(default_factory=list)
    columns: list[str] = Field(default_factory=list)
    column_units: list[str] = Field(default_factory=list)
    rows: list[VisualRow] = Field(default_factory=list)
    #: Key of the highest point (timeline/line), computed here so the browser never derives a figure.
    peak_key: str | None = None

    def event_value(self) -> dict[str, Any]:
        return {"phase": "ready", **self.model_dump(exclude_none=True)}


def pending_event_value(visual_id: str, tool_name: str) -> dict[str, Any]:
    return {"phase": "pending", "visual_id": visual_id, "tool": tool_name}


# -- labels ------------------------------------------------------------------------------------------
def _month_name(key: str) -> str:
    return dt.date.fromisoformat(key + "-01").strftime("%b %Y")


def _day_name(key: str) -> str:
    return dt.date.fromisoformat(key).strftime("%b %-d")


def _label(group_by: str, key: str) -> str:
    if group_by == "month":
        return _month_name(key)
    if group_by in ("week", "day"):
        return _day_name(key)
    return key.replace("_", " ") if group_by == "question_type" else key


def _period_text(start: dt.date, end: dt.date) -> str:
    return f"{start.isoformat()} to {end.isoformat()}"


def _scope_text(result: ChartResult) -> str:
    p = result.params
    parts = [p.territory_id if p and p.territory_id else "your scope"]
    if p and p.product:
        parts.append(p.product)
    if p and p.topic:
        parts.append(f"“{p.topic}”")
    return " · ".join(parts)


def _through(result: ChartResult) -> str | None:
    return result.data_through.isoformat() if result.data_through else None


def _partial(group_by: str, key: str, start: dt.date, end: dt.date) -> bool:
    if group_by == "month":
        first = dt.date.fromisoformat(key + "-01")
        nxt = dt.date(first.year + (first.month == 12), first.month % 12 + 1, 1)
        return start > first or end < nxt - dt.timedelta(days=1)
    if group_by == "week":
        first = dt.date.fromisoformat(key)
        return start > first or end < first + dt.timedelta(days=6)
    return False


def _share(metric: str, value: int, total: int) -> float | None:
    if metric == "engaged_hcps" or total <= 0:
        return None
    return round(100 * value / total, 1)


# -- builders ----------------------------------------------------------------------------------------
def series_visual(visual_id: str, result: ChartResult, chart_type: str) -> Visual:
    p = result.params
    assert p is not None
    time_dim = p.group_by in chart_data.TIME_DIMS
    if chart_type == "timeline" and p.group_by in ("week", "day"):
        kind: VisualKind = "timeline"
    elif time_dim and chart_type in ("auto", "line"):
        kind = "line"
    else:
        kind = "bar"
    metric_label = METRIC_LABELS[p.metric]
    points = [
        VisualPoint(
            key=row.key,
            label=_label(p.group_by, row.key),
            value=row.value,
            share_pct=None if time_dim else _share(p.metric, row.value, result.total),
            partial=_partial(p.group_by, row.key, p.period_from, p.period_to) if time_dim else False,
        )
        for row in result.rows
    ]
    peak = max(points, key=lambda pt: (pt.value, pt.key), default=None) if time_dim else None
    top = f", top {len(points)}" if result.left_out else ""
    return Visual(
        visual_id=visual_id,
        kind=kind,
        title=f"{metric_label} by {GROUP_LABELS[p.group_by]}{top}",
        subtitle=f"{_period_text(p.period_from, p.period_to)} · {_scope_text(result)}",
        metric=p.metric,
        unit=METRIC_UNITS[p.metric],
        period=_period_text(p.period_from, p.period_to),
        scope=_scope_text(result),
        definition=METRIC_DEFINITIONS[p.metric],
        data_through=_through(result),
        total=result.total,
        left_out=result.left_out,
        points=points,
        peak_key=peak.key if peak and peak.value > 0 else None,
    )


def matrix_visual(visual_id: str, result: ChartResult) -> Visual:
    p = result.params
    assert p is not None and result.matrix is not None
    metric_label = METRIC_LABELS[p.metric]
    return Visual(
        visual_id=visual_id,
        kind="heatmap",
        title=f"{metric_label} by {GROUP_LABELS[p.group_by]} and month",
        subtitle=f"{_period_text(p.period_from, p.period_to)} · {_scope_text(result)}",
        metric=p.metric,
        unit=METRIC_UNITS[p.metric],
        period=_period_text(p.period_from, p.period_to),
        scope=_scope_text(result),
        definition=METRIC_DEFINITIONS[p.metric],
        data_through=_through(result),
        total=result.total,
        left_out=result.left_out,
        columns=[_month_name(m) for m in result.matrix.columns],
        rows=[VisualRow(key=label, label=label, values=list(values)) for label, values in result.matrix.rows],
    )


def table_visual(visual_id: str, result: ChartResult) -> Visual:
    p = result.params
    assert p is not None
    return Visual(
        visual_id=visual_id,
        kind="table",
        title=f"Activity by {GROUP_LABELS[p.group_by]}",
        subtitle=f"{_period_text(p.period_from, p.period_to)} · {_scope_text(result)}",
        metric="activity",
        unit="",
        period=_period_text(p.period_from, p.period_to),
        scope=_scope_text(result),
        definition="Counts per row: distinct calls, engaged HCPs and insight responses. Totals are not sums of rows.",
        data_through=_through(result),
        total=result.total,
        left_out=result.left_out,
        columns=[GROUP_LABELS[p.group_by].capitalize(), *(METRIC_LABELS[m] for m in chart_data.METRICS)],
        column_units=["", *(METRIC_UNITS[m] for m in chart_data.METRICS)],
        rows=[
            VisualRow(key=row.label, label=_label(p.group_by, row.label), values=list(row.values))
            for row in result.table
        ],
    )


ANSWER_TITLES = {
    "likert_5": "Likert answers (1 to 5)",
    "rating_0_10": "0 to 10 ratings",
    "yes_no": "Yes / No / Unsure answers",
    "single_choice": "Single-choice answers",
}


def distribution_visual(visual_id: str, result: ChartResult) -> Visual:
    p = result.params
    assert p is not None
    points = [
        VisualPoint(
            key=row.key,
            label=row.label,
            value=row.value,
            share_pct=_share("responses", row.value, result.total),
        )
        for row in result.rows
    ]
    topic = f" about “{p.topic}”" if p.topic else ""
    return Visual(
        visual_id=visual_id,
        kind="distribution",
        title=f"{ANSWER_TITLES.get(p.answer_type or '', 'Answers')}{topic}",
        subtitle=f"{_period_text(p.period_from, p.period_to)} · {_scope_text(result)}",
        metric="responses",
        unit="responses",
        period=_period_text(p.period_from, p.period_to),
        scope=_scope_text(result),
        definition="Recorded answers, each response counted once; the share is of all answers of this type shown.",
        data_through=_through(result),
        total=result.total,
        points=points,
    )


# -- what the model reads back ----------------------------------------------------------------------------
def summary_for_model(visual: Visual) -> str:
    """The plotted numbers as compact JSON so the model can quote them. Same values the browser draws."""
    body: dict[str, Any] = {
        "status": "ok",
        "chart": visual.kind,
        "title": visual.title,
        "period": visual.period,
        "scope": visual.scope,
        "total": visual.total,
    }
    if visual.points:
        body["points"] = [
            {
                "label": pt.label,
                "value": pt.value,
                **({"share_percent": pt.share_pct} if pt.share_pct is not None else {}),
            }
            for pt in visual.points
        ]
    if visual.rows:
        body["columns"] = visual.columns
        body["rows"] = [{"label": r.label, "values": r.values} for r in visual.rows]
    if visual.peak_key:
        body["peak"] = next((pt.label for pt in visual.points if pt.key == visual.peak_key), None)
    if visual.left_out:
        body["groups_not_shown"] = visual.left_out
    body["instruction"] = (
        "The chart is already shown to the user with exactly these values. Describe it in one or two plain "
        "sentences and copy any figure exactly from here. Do not compute totals, differences or percentages."
    )
    return json.dumps(body, default=str, separators=(",", ":"))
