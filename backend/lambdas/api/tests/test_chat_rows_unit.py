"""Show rows: argument validation, access ordering and export hygiene, without a database."""

from __future__ import annotations

import datetime as dt
from typing import Any

import pytest

from a2g_api import chat_rows
from a2g_api.errors import BadRequest, Forbidden, NotFound
from a2g_api.identity import Identity

IDENTITY = Identity("cognito|s", "msl", "MSL", "Avery Clinician", "avery@example.test", "header")
RUN = "11111111-1111-1111-1111-111111111111"

CALLS_SET = {
    "row_set_id": "rs1", "kind": "calls", "label": "Distinct calls", "unit": "calls", "count": 2,
    "period_from": "2026-08-06", "period_to": "2026-11-03", "scope": "your scope",
}


class Cursor:
    """Answers the module's queries in order; records every statement so tests can check what ran."""

    def __init__(self, *, records: bool = True, export: bool = True, run: bool = True, sets: list[dict] | None = None,
                 total: int = 2, rows: list[tuple] | None = None) -> None:
        self.sql: list[str] = []
        self.params: list[Any] = []
        self._records, self._export, self._run = records, export, run
        self._sets = [CALLS_SET] if sets is None else sets
        self._total = total
        self._rows = rows if rows is not None else [
            ("CALL-2", dt.date(2026, 11, 2), "scientific", "field", 30, "T01-01", "H1", "osimertinib"),
            ("=CALL-1", dt.date(2026, 11, 1), "scientific", "field", None, "T01-01", "H2", None),
        ]
        self._next: Any = None

    def execute(self, sql: str, params: Any = None) -> None:
        sql = " ".join(sql.split())
        self.sql.append(sql)
        self.params.append(params)
        if "has_permission('admin.manage') OR app.has_permission('source.records.read')" in sql:
            self._next = [(self._records,)]
        elif "has_permission('admin.manage') OR app.has_permission('chat.rows.export')" in sql:
            self._next = [(self._export,)]
        elif "FROM chat_runs" in sql:
            self._next = [(1,)] if self._run else []
        elif "FROM chat_run_events" in sql:
            self._next = [(self._sets,)] if self._sets else []
        elif sql.startswith("SELECT count(DISTINCT"):
            self._next = [(self._total,)]
        elif "GROUP BY" in sql:
            self._next = self._rows
        elif "LEAST" in sql:
            self._next = [(dt.datetime(2026, 11, 3, 12, tzinfo=dt.timezone.utc),)]
        else:
            self._next = []

    def fetchone(self) -> Any:
        return self._next[0] if self._next else None

    def fetchall(self) -> list[Any]:
        return list(self._next or [])

    @property
    def inserted_audit(self) -> bool:
        return any(s.startswith("INSERT INTO audit_events") for s in self.sql)


def page(cur: Cursor, **args: Any) -> dict[str, Any]:
    return chat_rows.chat_answer_rows(cur, IDENTITY, "msl-t01-01", {"runId": RUN, "rowSetId": "rs1", **args})


def export(cur: Cursor, **args: Any) -> dict[str, Any]:
    return chat_rows.export_chat_rows(cur, IDENTITY, "msl-t01-01", {"runId": RUN, "rowSetId": "rs1", **args})


def test_a_page_carries_rows_total_and_the_figure_the_answer_stated() -> None:
    result = page(Cursor())
    assert result["kind"] == "CALLS" and result["total"] == 2 and result["answerCount"] == 2
    assert [c["key"] for c in result["columns"]][:2] == ["id", "date"]
    assert result["rows"][0] == {"id": "CALL-2", "cells": ["CALL-2", "2026-11-02", "scientific", "field", "30", "T01-01", "H1", "osimertinib"]}
    assert result["sortBy"] == "date" and result["sortDir"] == "DESC"
    assert result["canExport"] is True


@pytest.mark.parametrize(
    "bad",
    [
        {"runId": "short"}, {"rowSetId": "../x"}, {"rowSetId": "rs1; DROP TABLE x"}, {"offset": -1}, {"offset": 10**9},
        {"limit": 0}, {"limit": 101}, {"limit": True}, {"sortBy": "territory_id; --"}, {"sortBy": "nope"},
        {"sortBy": "date", "sortDir": "SIDEWAYS"},
    ],
)
def test_bad_arguments_are_refused_before_any_row_is_read(bad: dict) -> None:
    cur = Cursor()
    with pytest.raises(BadRequest):
        page(cur, **bad)
    assert not any("GROUP BY" in s for s in cur.sql)


def test_an_aggregate_only_caller_is_refused_and_no_row_query_runs() -> None:
    cur = Cursor(records=False)
    with pytest.raises(Forbidden):
        page(cur)
    assert not any("chat_run_events" in s or "GROUP BY" in s for s in cur.sql)


def test_another_users_run_reads_as_unknown() -> None:
    with pytest.raises(NotFound):
        page(Cursor(run=False))


def test_an_unknown_row_set_is_refused() -> None:
    with pytest.raises(NotFound):
        page(Cursor(sets=[{**CALLS_SET, "row_set_id": "rs9"}]), rowSetId="rs1")


@pytest.mark.parametrize("patch", [{"kind": "users"}, {"period_from": "yesterday"}, {"territory_id": "T01-01'; --"}, {"answer_type": "free"}, {"count": -3}])
def test_a_tampered_description_is_rejected_again_here(patch: dict) -> None:
    with pytest.raises(BadRequest):
        page(Cursor(sets=[{**CALLS_SET, **patch}]))


def test_sort_uses_only_the_columns_of_the_kind_and_breaks_ties_on_the_id() -> None:
    cur = Cursor()
    page(cur, sortBy="minutes", sortDir="ASC", offset=25, limit=50)
    sql = next(s for s in cur.sql if "GROUP BY" in s)
    assert "ORDER BY c_minutes ASC NULLS LAST, c_id ASC LIMIT" in sql
    assert cur.params[cur.sql.index(sql)]["offset"] == 25 and cur.params[cur.sql.index(sql)]["limit"] == 50


def test_filters_are_bound_parameters_never_interpolated() -> None:
    raw = {**CALLS_SET, "territory_id": "T01-01", "product": "osi%mertinib", "specialty": "oncolog"}
    cur = Cursor(sets=[raw])
    page(cur)
    sql = next(s for s in cur.sql if "GROUP BY" in s)
    params = cur.params[cur.sql.index(sql)]
    assert "T01-01" not in sql and "osi" not in sql
    assert params["territory"] == "T01-01" and params["product_like"] == "%osi\\%mertinib%" and params["specialty_like"] == "%oncolog%"


def test_export_refuses_without_the_export_permission_and_records_nothing() -> None:
    cur = Cursor(export=False)
    with pytest.raises(Forbidden):
        export(cur)
    assert not cur.inserted_audit and not any("GROUP BY" in s for s in cur.sql)


def test_export_refuses_an_aggregate_only_caller_before_anything_else() -> None:
    cur = Cursor(records=False)
    with pytest.raises(Forbidden):
        export(cur)
    assert not cur.inserted_audit and not any("chat_run_events" in s for s in cur.sql)


def test_export_audits_after_the_rows_were_read_with_ids_and_counts_only() -> None:
    cur = Cursor()
    result = export(cur)
    audit_at = next(i for i, s in enumerate(cur.sql) if s.startswith("INSERT INTO audit_events"))
    assert audit_at > next(i for i, s in enumerate(cur.sql) if "GROUP BY" in s)
    params = cur.params[audit_at]
    assert params[1:5] == ("chat_rows.exported", "chat_row_set", f"{RUN}:rs1", "allowed")
    assert "CALL" not in params[5] and '"rows":2' in params[5]
    assert result["rowCount"] == 2 and result["truncated"] is False and result["fileName"].endswith(".csv")


def test_the_csv_is_labelled_a_source_and_neutralises_spreadsheet_formulas() -> None:
    content = export(Cursor())["content"]
    lines = content.splitlines()
    assert lines[0].startswith("# [SOURCE]")
    header = next(i for i, line in enumerate(lines) if line.startswith("Call,Date"))
    assert lines[header + 1].startswith("CALL-2,2026-11-02,scientific,field,30,T01-01,H1,osimertinib")
    assert lines[header + 2].startswith("'=CALL-1,")


def test_a_set_bigger_than_the_cap_says_so() -> None:
    cur = Cursor(total=chat_rows.EXPORT_MAX_ROWS + 10)
    result = export(cur)
    assert result["truncated"] is True and "Only the first 2 of 5010 rows" in result["content"]
