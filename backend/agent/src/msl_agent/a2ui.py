"""A2UI v1.0 answer surfaces (docs/adr/0017).

The agent can attach small declarative UI surfaces to a chat answer: a table of recorded themes and an
"Adjust this answer" form. They follow the A2UI v1.0 protocol (https://a2ui.org/specification/v1.0-a2ui/) and use
only the agent2go answer catalog (``docs/a2ui/answer-catalog.json``), which the browser renders with its own
allow-listed Astryx components.

Rules this module enforces:

* The model never writes a surface. The runtime builds each one from tool results (SQL under RLS), the same way
  ``visuals.py`` builds charts.
* Every figure on a surface must pass the number guard: a number that no tool returned drops the whole surface.
* A surface is checked against the catalog contract before it streams; a surface that does not fit is dropped.
* Surfaces travel as the AG-UI binding for A2UI: an ``ACTIVITY_SNAPSHOT`` event with ``activityType``
  ``a2ui-surface`` whose content holds ``a2ui_operations`` (one ``createSurface`` carrying components and data).
* A user action comes back as an ordinary chat run (same AppSync path); :func:`parse_refine_action` validates it
  against closed lists, so an action can ask for nothing a typed question could not.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
from typing import Any, Literal

from . import ag_ui
from .numbers import allowed_numbers, numbers_in
from .repository import MAX_RANGE_DAYS

PROTOCOL_VERSION = "1.0"
CATALOG_ID = "urn:agent2go:a2ui:answer-catalog:v1"
ACTIVITY_TYPE = "a2ui-surface"
OPERATIONS_KEY = "a2ui_operations"
#: Where the browser places a surface in the answer: next to the charts, or with the follow-ups.
SLOT_EXTENSION = "com_agent2go_slot"
Slot = Literal["evidence", "follow_up"]

REFINE_ACTION = "refine_answer"
MAX_SURFACES = 4
MAX_TABLE_ROWS = 24
MAX_TABLE_COLUMNS = 6
#: The catalog's ChoicePicker holds at most 31 options: "all", 29 territories, and the answer's own if not among them.
MAX_OPTIONS = 31
MAX_TERRITORY_OPTIONS = MAX_OPTIONS - 2
#: The longest period an adjusted answer may ask for: the same limit the read queries apply.
MAX_PERIOD_DAYS = MAX_RANGE_DAYS

WITHHELD = "Withheld"

#: The catalog contract: each component and the properties it may carry (mirrors docs/a2ui/answer-catalog.json).
COMPONENT_PROPERTIES: dict[str, frozenset[str]] = {
    "Card": frozenset({"child"}),
    "Column": frozenset({"children"}),
    "Row": frozenset({"children"}),
    "Text": frozenset({"text", "variant"}),
    "Table": frozenset({"caption", "columns", "rows"}),
    "Form": frozenset({"title", "description", "children"}),
    "ChoicePicker": frozenset({"label", "variant", "options", "value", "@checks"}),
    "DateTimeInput": frozenset({"label", "value", "enableDate", "min", "max", "@checks"}),
    "Button": frozenset({"label", "variant", "action", "@checks"}),
}
FUNCTIONS = frozenset({"required", "isOnOrBefore", "formatString", "and", "or", "not"})
_ENVELOPE = frozenset({"id", "component"})
_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
_SURFACE_ID = re.compile(r"^[A-Za-z0-9_-]{1,96}$")
_TERRITORY = re.compile(r"^T\d{2}-\d{2}$")
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
#: Text a surface never carries: a URL scheme or markup. The catalog has no component that could use either.
_UNSAFE_TEXT = re.compile(r"(?i)\b(?:javascript|data|vbscript|file|https?):|<\s*[a-z!/?]")


# -- envelope ----------------------------------------------------------------------------------------
def surface_id(kind: str, run_id: str, index: int) -> str:
    """A surface id unique for the renderer's lifetime: the kind, the run and its position in the run."""
    safe_run = re.sub(r"[^A-Za-z0-9_-]", "", run_id)[:64] or "run"
    return f"{kind}_{index}_{safe_run}"


def create_surface(
    sid: str, components: list[dict[str, Any]], data_model: dict[str, Any], *, slot: Slot
) -> dict[str, Any]:
    """One v1.0 ``createSurface`` that carries its components and data (single-message instantiation)."""
    return {
        "version": PROTOCOL_VERSION,
        "createSurface": {
            "surfaceId": sid,
            "catalogId": CATALOG_ID,
            "components": components,
            "dataModel": data_model,
            "metadata": {"extensions": {SLOT_EXTENSION: slot}},
        },
    }


def activity_event(sid: str, operations: list[dict[str, Any]]) -> ag_ui.Event:
    """The AG-UI binding for A2UI: an activity snapshot that replaces the surface's previous paint."""
    return ag_ui.activity_snapshot(
        f"a2ui-surface-{sid}", ACTIVITY_TYPE, {OPERATIONS_KEY: operations}, replace=True
    )


# -- contract checks ---------------------------------------------------------------------------------
def _walk_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in _walk_strings(v)]
    if isinstance(value, list):
        return [s for v in value for s in _walk_strings(v)]
    return []


def _walk_numbers(value: Any) -> list[int | float]:
    if isinstance(value, bool):
        return []
    if isinstance(value, int | float):
        return [value]
    if isinstance(value, dict):
        return [n for v in value.values() for n in _walk_numbers(v)]
    if isinstance(value, list):
        return [n for v in value for n in _walk_numbers(v)]
    return []


def _calls(value: Any) -> list[str]:
    """Every function a dynamic value invokes, however deeply nested.

    v1.0 spells a call ``{"@call": name}``; the renderer SDK also accepts the pre-1.0 ``{"call": name}``, so both count.
    """
    if isinstance(value, dict):
        own = [str(value[key]) for key in ("@call", "call") if key in value]
        return own + [c for v in value.values() for c in _calls(v)]
    if isinstance(value, list):
        return [c for v in value for c in _calls(v)]
    return []


def contract_errors(operations: list[dict[str, Any]]) -> list[str]:
    """Reasons a surface does not fit the answer catalog; empty when it does."""
    errors: list[str] = []
    for op in operations:
        if op.get("version") != PROTOCOL_VERSION or set(op) - {"version"} != {"createSurface"}:
            errors.append("only v1.0 createSurface messages are emitted")
            continue
        body = op["createSurface"]
        if body.get("catalogId") != CATALOG_ID or not _SURFACE_ID.match(str(body.get("surfaceId", ""))):
            errors.append("unknown catalog or malformed surface id")
        if body.get("sendDataModel") or "theme" in body:
            errors.append("sendDataModel and theme are not used")
        ids: set[str] = set()
        for component in body.get("components") or []:
            name, cid = component.get("component"), str(component.get("id", ""))
            allowed = COMPONENT_PROPERTIES.get(str(name))
            if allowed is None:
                errors.append(f"component {name!r} is not in the catalog")
                continue
            if not _IDENT.match(cid) or cid in ids:
                errors.append(f"component id {cid!r} is not a unique identifier")
            ids.add(cid)
            extra = set(component) - _ENVELOPE - allowed
            if extra:
                errors.append(f"{name} carries unknown properties {sorted(extra)}")
            # The catalog's size limits, so the browser's own validation never rejects a surface the agent sent.
            if (
                len(component.get("options") or []) > MAX_OPTIONS
                or len(component.get("columns") or []) > MAX_TABLE_COLUMNS
            ):
                errors.append(f"{name} {cid!r} has more options or columns than the catalog allows")
        if "root" not in ids:
            errors.append("a surface needs a root component")
        unknown = set(_calls(body)) - FUNCTIONS
        if unknown:
            errors.append(f"functions outside the catalog: {sorted(unknown)}")
        if any(_UNSAFE_TEXT.search(text) for text in _walk_strings(body)):
            errors.append("surfaces carry no URLs or markup")
    return errors


def unverified_figures(operations: list[dict[str, Any]], tool_results: list[str]) -> list[str]:
    """Figures on a surface that no tool returned (the number guard of docs/adr/0007, applied to UI)."""
    allowed = allowed_numbers(tool_results)
    found: list[str] = []
    for op in operations:
        body = op.get("createSurface") or {}
        texts = _walk_strings(body.get("dataModel")) + _walk_strings(body.get("components"))
        figures = [n for text in texts for n in numbers_in(text)]
        # A numeric cell is a claim whatever it looks like, so it is normalised the same way and checked too.
        figures += [
            figure for n in _walk_numbers(body.get("dataModel")) for figure in allowed_numbers([str(n)])
        ]
        found += [f for f in figures if f not in allowed and f not in found]
    return found


# -- surfaces ----------------------------------------------------------------------------------------
@dataclass(frozen=True)
class TableColumn:
    key: str
    label: str
    numeric: bool = False


def table_surface(
    sid: str, *, title: str, caption: str, columns: list[TableColumn], rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """A titled card with a small table. Cells are plain text or numbers computed by a tool."""
    components = [
        {"id": "root", "component": "Card", "child": "body"},
        {"id": "body", "component": "Column", "children": ["title", "caption", "table"]},
        {"id": "title", "component": "Text", "text": title, "variant": "title"},
        {"id": "caption", "component": "Text", "text": caption, "variant": "caption"},
        {
            "id": "table",
            "component": "Table",
            "caption": title,
            "columns": [
                {"key": c.key, "label": c.label, **({"numeric": True} if c.numeric else {})} for c in columns
            ],
            "rows": {"@path": "/rows"},
        },
    ]
    return [create_surface(sid, components, {"rows": rows[:MAX_TABLE_ROWS]}, slot="evidence")]


#: Labels for the closed lists the Adjust form offers. Keys are the tools' own argument values.
MEASURES = {"calls": "Distinct calls", "engaged_hcps": "Engaged HCPs", "responses": "Insight responses"}
RECORD_GROUPS = {
    "total": "Total only",
    "month": "By month",
    "week": "By week",
    "territory": "By territory",
    "product": "By product",
}
EXECUTIVE_GROUPS = {
    "total": "Total only",
    "month": "By month",
    "region": "By region",
    "territory": "By territory",
}
ALL_TERRITORIES = "all"


@dataclass(frozen=True)
class RefineRequest:
    """One answer the Adjust form can ask for: a measure, a grouping, a period and (record access) a territory."""

    metric: str
    group_by: str
    from_date: str
    to_date: str
    territory_id: str = ""
    executive: bool = False

    def question(self) -> str:
        """The question this adjustment asks, in words the tools and the scope check understand."""
        measure = {"calls": "calls", "engaged_hcps": "engaged HCPs", "responses": "insight responses"}[
            self.metric
        ]
        grouping = "in total" if self.group_by == "total" else f"by {self.group_by}"
        where = f" in territory {self.territory_id}" if self.territory_id else ""
        return f"How many {measure} {grouping}{where} from {self.from_date} to {self.to_date}?"


def refine_surface(
    sid: str, request: RefineRequest, *, territories: list[str], data_through: str | None
) -> list[dict[str, Any]]:
    """The "Adjust this answer" form, pre-filled with what this answer covered.

    Its options come from closed lists and the caller's own scope (read under RLS). Submitting it sends the
    ``refine_answer`` action with the chosen values; the agent validates them again before any query runs.
    """
    groups = EXECUTIVE_GROUPS if request.executive else RECORD_GROUPS
    fields = ["measure", "group"] + ([] if request.executive else ["territory"]) + ["dates", "submit"]
    components: list[dict[str, Any]] = [
        {"id": "root", "component": "Card", "child": "form"},
        {
            "id": "form",
            "component": "Form",
            "title": "Adjust this answer",
            "description": "Change the measure, grouping, period"
            + ("" if request.executive else " or territory")
            + ", then update. Counts come from database queries under your access.",
            "children": fields,
        },
        {
            "id": "measure",
            "component": "ChoicePicker",
            "label": "Measure",
            "variant": "mutuallyExclusive",
            "options": [{"label": label, "value": key} for key, label in MEASURES.items()],
            "value": {"@path": "/measure"},
        },
        {
            "id": "group",
            "component": "ChoicePicker",
            "label": "Grouping",
            "variant": "mutuallyExclusive",
            "options": [{"label": label, "value": key} for key, label in groups.items()],
            "value": {"@path": "/group"},
        },
        {"id": "dates", "component": "Row", "children": ["from", "to"]},
        {
            "id": "from",
            "component": "DateTimeInput",
            "label": "From",
            "enableDate": True,
            "value": {"@path": "/from"},
            "max": {"@path": "/to"},
            "@checks": [
                {
                    "condition": {"@call": "required", "args": {"value": {"@path": "/from"}}},
                    "message": "Choose a start date.",
                },
            ],
        },
        {
            "id": "to",
            "component": "DateTimeInput",
            "label": "To",
            "enableDate": True,
            "value": {"@path": "/to"},
            "min": {"@path": "/from"},
            **({"max": data_through} if data_through else {}),
            "@checks": [
                {
                    "condition": {"@call": "required", "args": {"value": {"@path": "/to"}}},
                    "message": "Choose an end date.",
                },
                {
                    "condition": {
                        "@call": "isOnOrBefore",
                        "args": {"value": {"@path": "/from"}, "limit": {"@path": "/to"}},
                    },
                    "message": "Choose an end date on or after the start date.",
                },
            ],
        },
        {
            "id": "submit",
            "component": "Button",
            "label": "Update answer",
            "variant": "primary",
            "action": {
                "event": {
                    "name": REFINE_ACTION,
                    "userMessage": "Update this answer",
                    "context": {
                        "measure": {"@path": "/measure"},
                        "group": {"@path": "/group"},
                        **({} if request.executive else {"territory": {"@path": "/territory"}}),
                        "from": {"@path": "/from"},
                        "to": {"@path": "/to"},
                    },
                }
            },
        },
    ]
    if not request.executive:
        options = [ALL_TERRITORIES, *sorted(territories)[:MAX_TERRITORY_OPTIONS]]
        if request.territory_id and request.territory_id not in options:
            options.append(request.territory_id)
        components.insert(
            4,
            {
                "id": "territory",
                "component": "ChoicePicker",
                "label": "Territory",
                "variant": "mutuallyExclusive",
                "options": [
                    {"label": "All of my scope" if t == ALL_TERRITORIES else t, "value": t} for t in options
                ],
                "value": {"@path": "/territory"},
            },
        )
    data = {
        "measure": [request.metric],
        "group": [request.group_by],
        "from": request.from_date,
        "to": request.to_date,
        **({} if request.executive else {"territory": [request.territory_id or ALL_TERRITORIES]}),
    }
    return [create_surface(sid, components, data, slot="follow_up")]


# -- actions -----------------------------------------------------------------------------------------
def _single(value: Any) -> str | None:
    """A ChoicePicker value: a list holding exactly one string (or, leniently, that string)."""
    if isinstance(value, list) and len(value) == 1 and isinstance(value[0], str):
        return value[0]
    return value if isinstance(value, str) else None


def parse_refine_action(name: str, context: dict[str, Any], *, executive: bool) -> RefineRequest | None:
    """The validated request behind a ``refine_answer`` action, or ``None`` when any part is outside the lists.

    The context arrives from the browser, so it is untrusted: every value is checked against a closed list or a
    strict pattern here, and the territory is still checked against the caller's scope before anything is read.
    """
    if name != REFINE_ACTION or not isinstance(context, dict):
        return None
    allowed_keys = {"measure", "group", "from", "to"} | (set() if executive else {"territory"})
    if not set(context) <= allowed_keys:
        return None
    metric, group = _single(context.get("measure")), _single(context.get("group"))
    groups = EXECUTIVE_GROUPS if executive else RECORD_GROUPS
    if metric not in MEASURES or group not in groups:
        return None
    from_date, to_date = context.get("from"), context.get("to")
    if not (
        isinstance(from_date, str)
        and isinstance(to_date, str)
        and _ISO_DATE.match(from_date)
        and _ISO_DATE.match(to_date)
    ):
        return None
    try:
        start, end = dt.date.fromisoformat(from_date), dt.date.fromisoformat(to_date)
    except ValueError:
        return None
    if start > end or (end - start).days > MAX_PERIOD_DAYS:
        return None
    if executive and start == end:
        # A single day is refused to an aggregate-only Executive when typed ("on 2026-10-05"); the form asks no less.
        return None
    territory = ""
    if not executive:
        chosen = _single(context.get("territory")) or ALL_TERRITORIES
        if chosen != ALL_TERRITORIES:
            if not _TERRITORY.match(chosen):
                return None
            territory = chosen
    return RefineRequest(metric, group, from_date, to_date, territory, executive)


__all__ = [
    "ACTIVITY_TYPE",
    "CATALOG_ID",
    "REFINE_ACTION",
    "RefineRequest",
    "TableColumn",
    "activity_event",
    "contract_errors",
    "parse_refine_action",
    "refine_surface",
    "surface_id",
    "table_surface",
    "unverified_figures",
]
