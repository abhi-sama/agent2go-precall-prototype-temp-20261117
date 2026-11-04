"""Show rows: the exact rows behind a number in a chat answer, read under the caller's RLS session (docs/adr/0015).

The agent describes the rows behind each figure it computed as a *row set* (kind of row plus the filters its count
used) and streams it as a ``row_sets`` event into the run's event log. The browser never sends a description back: it
names a row set by id, and this module reads the description from the caller's own run, validates it again, and runs
a parameterised query under the caller's RLS session. So the table lists the rows the answer counted, limited by RLS,
and cannot be widened from the client.

Two fields are served from here:

* ``chatAnswerRows``: one sorted page of the rows, with their total and the figure the answer stated.
* ``exportChatRows``: a CSV of the same rows. It re-checks run ownership, record-level access and the export
  permission, and writes an id-level audit event before anything is returned.

Aggregate-only callers (Executive) are refused with ``Forbidden("aggregate_only")``: they read suppressed aggregates
elsewhere and never see rows. Nothing here interpolates a request value into SQL: sort columns come from a closed list
per kind, and dates, territory, product, topic and question id are bound parameters.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import psycopg

from a2g_logging import get_logger

from .chat import _ID, _require_record_access
from .errors import BadRequest, Forbidden, NotFound
from .identity import Identity

log = get_logger(__name__)

PAGE_DEFAULT = 25
PAGE_MAX = 100
OFFSET_MAX = 100_000
#: A CSV carries at most this many rows; a larger set says so in its header and in the response.
EXPORT_MAX_ROWS = 5_000

_TERRITORY = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
_QUESTION = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
_ROW_SET = re.compile(r"^rs[0-9]{1,3}$")
_TEXT = re.compile(r"^[^\x00-\x1f]{1,240}$")
_ANSWER_TYPES = frozenset({"likert_5", "rating_0_10", "yes_no", "single_choice"})
_KINDS = ("calls", "hcps", "responses")

# Same wording and escaping as the agent's chart queries (backend/agent chart_data.py), so a count and its rows agree.
_TOPIC_FILTER = """(qstn_txt ILIKE %(like)s ESCAPE '\\' OR rspns_txt ILIKE %(like)s ESCAPE '\\'
    OR molecule_type ILIKE %(like)s ESCAPE '\\' OR landscape_type ILIKE %(like)s ESCAPE '\\'
    OR study_name ILIKE %(like)s ESCAPE '\\' OR survey_type ILIKE %(like)s ESCAPE '\\')"""


def _like(text: str) -> str:
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@dataclass(frozen=True)
class Column:
    key: str
    label: str
    #: ``text``, ``date`` or ``number``: how the table aligns and sorts it.
    type: str
    #: SQL aggregate producing the cell (constants of this module, never request data).
    expr: str


@dataclass(frozen=True)
class Kind:
    table: str
    group_by: str
    id_label: str
    definition: str
    columns: tuple[Column, ...]
    default_sort: str
    default_dir: str


_CALLS = Kind(
    table="call_activity",
    group_by="crm_call_id",
    id_label="Call",
    definition="One row per distinct call in the period and filters. A call that covered several products is one row.",
    columns=(
        Column("id", "Call", "text", "crm_call_id"),
        Column("date", "Date", "date", "min(call_dt)"),
        Column("type", "Type", "text", "min(call_type)"),
        Column("channel", "Channel", "text", "min(call_chnl)"),
        Column("minutes", "Minutes", "number", "max(call_dur)"),
        Column("territory", "Territory", "text", "min(territory_id)"),
        Column("hcp", "HCP", "text", "min(cust_mdm_id)"),
        Column("products", "Products", "text", "string_agg(DISTINCT prd_nm, ', ' ORDER BY prd_nm)"),
    ),
    default_sort="date",
    default_dir="DESC",
)
_HCPS = Kind(
    table="call_activity",
    group_by="cust_mdm_id",
    id_label="HCP",
    definition="One row per distinct HCP engaged by at least one call in the period and filters.",
    columns=(
        Column("id", "HCP", "text", "cust_mdm_id"),
        Column("specialty", "Specialty", "text", "min(cust_sub_typ)"),
        Column("territory", "Territory", "text", "string_agg(DISTINCT territory_id, ', ' ORDER BY territory_id)"),
        Column("calls", "Calls", "number", "count(DISTINCT crm_call_id)"),
        Column("first", "First call", "date", "min(call_dt)"),
        Column("last", "Latest call", "date", "max(call_dt)"),
    ),
    default_sort="calls",
    default_dir="DESC",
)
_RESPONSES = Kind(
    table="hcp_raw_insights",
    group_by="uniq_rspns_id",
    id_label="Response",
    definition="One row per recorded response in the period and filters; excluded responses are left out.",
    columns=(
        Column("id", "Response", "text", "uniq_rspns_id"),
        Column("date", "Date", "date", "min(date_of_interaction)"),
        Column("territory", "Territory", "text", "min(territory_id)"),
        Column("hcp", "HCP", "text", "min(cust_mdm_id)"),
        Column("product", "Product", "text", "min(molecule_type)"),
        Column("question", "Question", "text", "min(qstn_txt)"),
        Column("answer", "Recorded answer", "text", "min(btrim(rspns_txt))"),
    ),
    default_sort="date",
    default_dir="DESC",
)
KINDS: dict[str, Kind] = {"calls": _CALLS, "hcps": _HCPS, "responses": _RESPONSES}


@dataclass(frozen=True)
class RowSet:
    row_set_id: str
    kind: str
    label: str
    count: int
    period_from: dt.date
    period_to: dt.date
    scope: str
    territory_id: str | None
    product: str | None
    specialty: str | None
    topic: str | None
    question_id: str | None
    answer_type: str | None
    answer_label: str | None
    free_text: bool


def _opt(raw: Mapping[str, Any], key: str, pattern: re.Pattern[str]) -> str | None:
    value = raw.get(key)
    if value in (None, ""):
        return None
    if not isinstance(value, str) or not pattern.match(value):
        raise BadRequest(f"invalid_row_set_{key}")
    return value


def parse_row_set(raw: Mapping[str, Any]) -> RowSet:
    """Re-validate a description read back from the event log: it is trusted data, but it is still checked."""
    kind = raw.get("kind")
    if kind not in _KINDS:
        raise BadRequest("invalid_row_set_kind")
    try:
        frm, to = dt.date.fromisoformat(str(raw.get("period_from"))), dt.date.fromisoformat(str(raw.get("period_to")))
    except ValueError as exc:
        raise BadRequest("invalid_row_set_period") from exc
    count = raw.get("count")
    if not isinstance(count, int) or isinstance(count, bool) or count < 0:
        raise BadRequest("invalid_row_set_count")
    answer_type = _opt(raw, "answer_type", re.compile("^[a-z0-9_]{1,24}$"))
    if answer_type is not None and answer_type not in _ANSWER_TYPES:
        raise BadRequest("invalid_row_set_answer_type")
    return RowSet(
        row_set_id=str(raw.get("row_set_id")),
        kind=kind,
        label=(_opt(raw, "label", _TEXT) or "Rows")[:120],
        count=count,
        period_from=frm,
        period_to=to,
        scope=(_opt(raw, "scope", _TEXT) or "your scope")[:80],
        territory_id=_opt(raw, "territory_id", _TERRITORY),
        product=_opt(raw, "product", _TEXT),
        specialty=_opt(raw, "specialty", _TEXT),
        topic=_opt(raw, "topic", _TEXT),
        question_id=_opt(raw, "question_id", _QUESTION),
        answer_type=answer_type,
        answer_label=_opt(raw, "answer_label", _TEXT),
        free_text=raw.get("free_text") is True,
    )


def load_row_set(cur: psycopg.Cursor, run_id: str, row_set_id: str) -> RowSet:
    """The description of one row set, from the caller's own run. Another user's run reads as 'unknown'."""
    cur.execute("SELECT 1 FROM chat_runs WHERE run_id = %s", (run_id,))
    if cur.fetchone() is None:
        raise NotFound("unknown_run")
    cur.execute(
        "SELECT event -> 'value' -> 'row_sets' FROM chat_run_events "
        "WHERE run_id = %s AND event ->> 'name' = 'row_sets' ORDER BY seq",
        (run_id,),
    )
    for (sets,) in cur.fetchall():
        for raw in sets or []:
            if isinstance(raw, Mapping) and raw.get("row_set_id") == row_set_id:
                return parse_row_set(raw)
    raise NotFound("unknown_row_set")


# -- queries ------------------------------------------------------------------------------------------
def _predicate(rs: RowSet) -> tuple[str, dict[str, Any]]:
    """The WHERE clause that counted this set, mirroring the agent's SQL for the same figure."""
    params: dict[str, Any] = {"frm": rs.period_from, "to": rs.period_to}
    if rs.kind == "responses":
        clauses = [
            "date_of_interaction BETWEEN %(frm)s AND %(to)s",
            "excluded_rspns_flag IS NOT TRUE",
            "uniq_rspns_id IS NOT NULL",
        ]
        product_col = "molecule_type"
    else:
        clauses = ["call_dt BETWEEN %(frm)s AND %(to)s"]
        product_col = "prd_nm"
        clauses.append("crm_call_id IS NOT NULL" if rs.kind == "calls" else "cust_mdm_id IS NOT NULL")
    if rs.territory_id:
        clauses.append("territory_id = %(territory)s")
        params["territory"] = rs.territory_id
    if rs.product:
        clauses.append(f"{product_col} ILIKE %(product_like)s ESCAPE '\\'")
        params["product_like"] = _like(rs.product)
    if rs.kind != "responses" and rs.specialty:
        clauses.append("cust_sub_typ ILIKE %(specialty_like)s ESCAPE '\\'")
        params["specialty_like"] = _like(rs.specialty)
    if rs.kind == "responses":
        if rs.topic:
            clauses.append(_TOPIC_FILTER)
            params["like"] = _like(rs.topic)
        if rs.question_id:
            clauses.append("qstn_ext_id = %(qid)s")
            params["qid"] = rs.question_id
        if rs.answer_type:
            clauses += ["qstn_type = %(answer_type)s", "rspns_txt IS NOT NULL"]
            params["answer_type"] = rs.answer_type
        if rs.free_text:
            clauses.append("qstn_type = 'open_text' AND nullif(btrim(rspns_txt), '') IS NOT NULL")
    where = " AND ".join(clauses)
    if rs.kind == "responses" and rs.answer_label:
        # The responses that chose one answer of a question: the same option logic as the question breakdown
        # (a select-all response counts once per option chosen; open text is grouped by theme; ranking by first choice).
        where += f""" AND uniq_rspns_id IN (
            SELECT o.uniq_rspns_id FROM (
              SELECT r.uniq_rspns_id,
                     CASE WHEN r.qstn_type = 'open_text' THEN app.theme_of(r.ans)
                          WHEN r.qstn_type = 'ranking' THEN 'Ranked first: ' || split_part(r.ans, ' > ', 1)
                          ELSE coalesce(nullif(btrim(opt.value), ''), 'No response recorded') END AS label
              FROM (SELECT uniq_rspns_id, btrim(rspns_txt) AS ans, qstn_type FROM hcp_raw_insights WHERE {where}) r
              CROSS JOIN LATERAL unnest(CASE WHEN r.qstn_type = 'multi_select' THEN string_to_array(r.ans, ';')
                                             ELSE ARRAY[r.ans] END) AS opt(value)
            ) o WHERE o.label = %(answer_label)s)"""
        params["answer_label"] = rs.answer_label
    return where, params


def count_rows(cur: psycopg.Cursor, rs: RowSet) -> int:
    """How many rows the description lists now, under the caller's RLS session."""
    kind = KINDS[rs.kind]
    where, params = _predicate(rs)
    cur.execute(f"SELECT count(DISTINCT {kind.group_by}) FROM {kind.table} WHERE {where}", params)
    return int(cur.fetchone()[0])


def _sort(kind: Kind, sort_by: Any, sort_dir: Any) -> tuple[str, str]:
    keys = {c.key for c in kind.columns}
    if sort_by in (None, ""):
        return kind.default_sort, kind.default_dir
    if sort_by not in keys:
        raise BadRequest("invalid_sort")
    if sort_dir not in (None, "", "ASC", "DESC"):
        raise BadRequest("invalid_sort")
    return str(sort_by), str(sort_dir or "ASC")


def _rows(
    cur: psycopg.Cursor, rs: RowSet, sort_by: str, sort_dir: str, offset: int, limit: int
) -> list[tuple[Any, ...]]:
    kind = KINDS[rs.kind]
    where, params = _predicate(rs)
    select = ", ".join(f"{c.expr} AS c_{c.key}" for c in kind.columns)
    # Ties break on the row's own id, so paging through a sorted set never repeats or skips a row.
    cur.execute(
        f"SELECT {select} FROM {kind.table} WHERE {where} GROUP BY {kind.group_by} "
        f"ORDER BY c_{sort_by} {sort_dir} NULLS LAST, c_id ASC LIMIT %(limit)s OFFSET %(offset)s",
        {**params, "limit": limit, "offset": offset},
    )
    return cur.fetchall()


def _cell(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (dt.date, dt.datetime)):
        return value.isoformat()[:10]
    return str(value)


def _data_through(cur: psycopg.Cursor) -> str | None:
    cur.execute(
        "SELECT LEAST((SELECT max(sys_inserted_datetime) FROM call_activity), "
        "(SELECT max(sys_inserted_datetime) FROM hcp_raw_insights))"
    )
    value = cur.fetchone()[0]
    return value.isoformat() if value else None


def can_export(cur: psycopg.Cursor) -> bool:
    cur.execute("SELECT app.has_permission('admin.manage') OR app.has_permission('chat.rows.export')")
    return bool(cur.fetchone()[0])


def _ids(args: Mapping[str, Any]) -> tuple[str, str]:
    run_id, row_set_id = args.get("runId"), args.get("rowSetId")
    if not isinstance(run_id, str) or not _ID.match(run_id):
        raise BadRequest("invalid_runId")
    if not isinstance(row_set_id, str) or not _ROW_SET.match(row_set_id):
        raise BadRequest("invalid_rowSetId")
    return run_id, row_set_id


def chat_answer_rows(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    """One sorted page of the rows behind a figure in the caller's own chat run."""
    run_id, row_set_id = _ids(args)
    offset = 0 if args.get("offset") is None else args["offset"]
    limit = PAGE_DEFAULT if args.get("limit") is None else args["limit"]
    if not isinstance(offset, int) or isinstance(offset, bool) or not 0 <= offset <= OFFSET_MAX:
        raise BadRequest("invalid_offset")
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= PAGE_MAX:
        raise BadRequest("invalid_limit")
    _require_record_access(cur)
    rs = load_row_set(cur, run_id, row_set_id)
    kind = KINDS[rs.kind]
    sort_by, sort_dir = _sort(kind, args.get("sortBy"), args.get("sortDir"))
    total = count_rows(cur, rs)
    rows = _rows(cur, rs, sort_by, sort_dir, offset, limit)
    log.info("answer rows read", row_set=row_set_id, kind=rs.kind, count=len(rows), outcome="ok")
    return {
        "rowSetId": rs.row_set_id,
        "kind": rs.kind.upper(),
        "label": rs.label,
        "scope": rs.scope,
        "period": f"{rs.period_from.isoformat()} to {rs.period_to.isoformat()}",
        "definition": kind.definition,
        "total": total,
        "answerCount": rs.count,
        "columns": [{"key": c.key, "label": c.label, "type": c.type.upper()} for c in kind.columns],
        "rows": [{"id": str(row[0]), "cells": [_cell(v) for v in row]} for row in rows],
        "offset": offset,
        "limit": limit,
        "sortBy": sort_by,
        "sortDir": sort_dir,
        "canExport": can_export(cur),
        "dataThrough": _data_through(cur),
    }


_FORMULA = ("=", "+", "-", "@", "\t", "\r")


def _csv_cell(value: str | None, column: Column) -> str:
    text = value or ""
    # A text cell that a spreadsheet would run as a formula is stored as text instead.
    return "'" + text if column.type == "text" and text.startswith(_FORMULA) else text


def export_chat_rows(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    """A CSV of the rows behind a figure. Access and the export permission are re-checked; the export is audited."""
    run_id, row_set_id = _ids(args)
    _require_record_access(cur)
    if not can_export(cur):
        raise Forbidden("export_not_permitted")
    rs = load_row_set(cur, run_id, row_set_id)
    kind = KINDS[rs.kind]
    sort_by, sort_dir = _sort(kind, args.get("sortBy"), args.get("sortDir"))
    total = count_rows(cur, rs)
    rows = _rows(cur, rs, sort_by, sort_dir, 0, EXPORT_MAX_ROWS)
    exported_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    truncated = total > len(rows)
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    # The same labelled header the other exports carry: this file is counted from source records, not AI text.
    # Comment lines are written raw (a CSV writer would quote them); their values have no control characters.
    preface = [
        "[SOURCE] Counted from source records by database queries, not written by the AI.",
        f"Rows behind a chat answer: {rs.label}",
        f"Scope: {rs.scope}; period: {rs.period_from.isoformat()} to {rs.period_to.isoformat()}",
        f"Figure in the answer: {rs.count}; rows in the data now: {total}",
        *([f"Only the first {len(rows)} of {total} rows are included."] if truncated else []),
        f"Exported: {exported_at}; data through: {_data_through(cur) or 'unknown'}",
    ]
    for line in preface:
        out.write(f"# {line}\n")
    writer.writerow([c.label for c in kind.columns])
    for row in rows:
        writer.writerow([_csv_cell(_cell(v), c) for v, c in zip(row, kind.columns, strict=True)])
    # Ids and counts only, never row content.
    cur.execute(
        "INSERT INTO audit_events(actor_user_id, action, resource_type, resource_id, outcome, correlation_id, metadata) "
        "VALUES (%s, %s, %s, %s, %s, current_setting('app.correlation_id', true), %s::jsonb)",
        (
            user_id,
            "chat_rows.exported",
            "chat_row_set",
            f"{run_id}:{row_set_id}",
            "allowed",
            f'{{"kind":"{rs.kind}","rows":{len(rows)},"total":{total},"truncated":{str(truncated).lower()}}}',
        ),
    )
    log.info("answer rows exported", row_set=row_set_id, kind=rs.kind, count=len(rows), outcome="allowed")
    return {
        "rowSetId": rs.row_set_id,
        "fileName": f"msl-agent-rows-{rs.kind}-{run_id[:8]}-{rs.row_set_id}.csv",
        "mimeType": "text/csv;charset=utf-8",
        "content": out.getvalue(),
        "rowCount": len(rows),
        "total": total,
        "truncated": truncated,
        "exportedAt": exported_at,
    }
