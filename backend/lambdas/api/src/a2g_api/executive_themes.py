"""Executive themes and the topic-by-region matrix: AppSync fields over the shared aggregate-only analysis.

The numbers, the small-group disclosure and the citations are computed by ``a2g_exec_analysis`` (one library for
this Lambda and the agent) on top of the SECURITY DEFINER functions of migrations 009 and 011. This module only
decides who may ask (an Executive with ``aggregate.read`` and at least one in-effect explicit executive
assignment), picks the window, and adds the screen-level fields (scope label, data-through, access level).
Nothing here calls a model, and nothing is logged beyond ids, counts and enums (docs/adr/0013).
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Mapping
from typing import Any

import psycopg
from a2g_exec_analysis import (
    InvalidFacet,
    InvalidFacetValue,
    InvalidWindow,
    NoExecutiveScope,
    executive_themes as _themes,
    executive_topic_matrix as _matrix,
)
from a2g_logging import get_logger

from .activity import _as_date
from .errors import BadRequest, NoScope
from .executive import MAX_WINDOW_DAYS, _require_executive_scope, _scope_label, _units
from .identity import Identity
from .resolvers import _parse_date

log = get_logger(__name__)

DEFAULT_THEME_DAYS = 90
MAX_FACET_VALUE_CHARS = 80


def exec_data_through(cur: psycopg.Cursor) -> dt.datetime | None:
    """The earlier of the two latest loads in the Executive's scope (a load date, never an interaction date)."""
    cur.execute("SELECT calls_loaded, responses_loaded FROM app.exec_loads()")
    loaded = [v for v in cur.fetchone() if v is not None]
    return min(loaded) if len(loaded) == 2 else None


def theme_window(args: Mapping[str, Any], through_day: dt.date | None) -> tuple[dt.date, dt.date]:
    """The window defaults to the last 90 days of loaded data: a trend needs an equal period before it."""
    to = _parse_date(args.get("to"), "to") or through_day or dt.date.today()
    frm = _parse_date(args.get("from"), "from") or to - dt.timedelta(days=DEFAULT_THEME_DAYS - 1)
    if frm > to or (to - frm).days + 1 > MAX_WINDOW_DAYS:
        raise BadRequest("invalid_range")
    return frm, to


def _facet_value(args: Mapping[str, Any]) -> str | None:
    value = args.get("facetValue")
    if value in (None, ""):
        return None
    if not isinstance(value, str) or len(value) > MAX_FACET_VALUE_CHARS or any(ord(ch) < 32 for ch in value):
        raise BadRequest("invalid_facet_value")
    return value.strip()


def _run(call: Any, *a: Any, **kw: Any) -> dict[str, Any]:
    try:
        return call(*a, **kw)
    except InvalidFacet as exc:
        raise BadRequest("invalid_facet") from exc
    except InvalidFacetValue as exc:
        raise BadRequest("invalid_facet_value") from exc
    except InvalidWindow as exc:
        raise BadRequest("invalid_range") from exc
    except NoExecutiveScope as exc:
        raise NoScope("no_executive_territories") from exc


def _screen(
    cur: psycopg.Cursor, assigned: list[str], can_records: bool, data_through: dt.datetime | None
) -> dict[str, Any]:
    return {
        "dataThrough": data_through.isoformat() if data_through else None,
        "scopeLabel": _scope_label(assigned, len(_units(cur))),
        "accessLevel": "RECORD_DRILLDOWN" if can_records else "AGGREGATE_ONLY",
    }


def executive_themes(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    assigned, can_records = _require_executive_scope(cur, identity)
    data_through = exec_data_through(cur)
    frm, to = theme_window(args, _as_date(data_through) if data_through else None)
    result = _run(_themes, cur, frm, to, str(args.get("facet") or "PORTFOLIO"), record_level=can_records)
    log.info(
        "executive themes served",
        user_id=user_id,
        facet=result["facet"],
        count=sum(len(g["cards"]) for g in result["groups"]),
        suppressed_cells=result["disclosure"]["suppressedCells"],
        aggregate_only=not can_records,
    )
    return {**result, **_screen(cur, assigned, can_records, data_through)}


def executive_topic_matrix(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    assigned, can_records = _require_executive_scope(cur, identity)
    data_through = exec_data_through(cur)
    frm, to = theme_window(args, _as_date(data_through) if data_through else None)
    result = _run(
        _matrix, cur, frm, to, str(args.get("facet") or "PORTFOLIO"), _facet_value(args), record_level=can_records
    )
    log.info(
        "executive topic matrix served",
        user_id=user_id,
        facet=result["facet"],
        count=len(result["rows"]),
        region_count=len(result["regions"]),
        suppressed_cells=result["disclosure"]["suppressedCells"],
        aggregate_only=not can_records,
    )
    return {**result, **_screen(cur, assigned, can_records, data_through)}


__all__ = ["executive_themes", "executive_topic_matrix", "exec_data_through", "theme_window"]
