"""RLS-scoped deterministic reads. Every number the agent states comes from here, never from the model.

The Postgres adapter connects as the non-owner ``app_user`` and calls
``app.set_request_identity(user_id, persona, correlation_id)`` first thing in every transaction, the
same session contract the BE API Lambda uses (docs/adr/0003). Row-level security then limits each
query to the caller's effective-dated scope, so an out-of-scope territory simply has no rows.
Metric definitions mirror ``backend/lambdas/api/src/a2g_api/resolvers.py``: distinct calls count
``crm_call_id`` (it repeats per product row), responses count distinct non-excluded ``uniq_rspns_id``.
"""

from __future__ import annotations

import datetime as dt
import re
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Literal, Protocol

import psycopg

from . import chart_data
from .chart_data import ChartParams, Matrix, SeriesRow, TableRow
from .schemas import Citation, Identity

MAX_RANGE_DAYS = 366 * 3
DEFAULT_WINDOW_DAYS = 90
MAX_EXAMPLES = 5
SNIPPET_CHARS = 240

_TERRITORY = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
_QUESTION = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")

Status = Literal["ok", "aggregate_only", "no_scope", "bad_request"]


@dataclass(frozen=True)
class ActivityResult:
    status: Status
    period_from: dt.date | None = None
    period_to: dt.date | None = None
    territory_filter: str | None = None
    #: False when the caller asked for a territory their scope does not cover (so no rows exist for them).
    territory_in_scope: bool | None = None
    product_filter: str | None = None
    calls: int = 0
    engaged_hcps: int = 0
    responses: int = 0
    data_through: dt.datetime | None = None
    citations: tuple[Citation, ...] = ()
    detail: str = ""


@dataclass(frozen=True)
class ResponseExample:
    record_id: str
    interaction_date: dt.date | None
    molecule: str | None
    question: str
    response: str


@dataclass(frozen=True)
class ResponseSearchResult:
    status: Status
    topic: str = ""
    period_from: dt.date | None = None
    period_to: dt.date | None = None
    matches: int = 0
    examples: tuple[ResponseExample, ...] = ()
    data_through: dt.datetime | None = None
    citations: tuple[Citation, ...] = ()
    detail: str = ""


@dataclass(frozen=True)
class ScopeResult:
    status: Status
    territory_ids: tuple[str, ...] = ()
    territory_count: int = 0
    data_through: dt.datetime | None = None
    detail: str = field(default="")


@dataclass(frozen=True)
class ChartResult:
    """One deterministic aggregate for a visual. ``rows`` / ``matrix`` / ``table`` depend on the shape asked for."""

    status: Status
    shape: str = "series"  # series | matrix | table | distribution
    params: ChartParams | None = None
    territory_in_scope: bool | None = None
    rows: tuple[SeriesRow, ...] = ()
    matrix: Matrix | None = None
    table: tuple[TableRow, ...] = ()
    total: int = 0
    left_out: int = 0
    data_through: dt.datetime | None = None
    detail: str = ""


@dataclass(frozen=True)
class TopicTrend:
    topic: str
    current: int
    prior: int
    #: EMERGING, DECLINING, STABLE or INSUFFICIENT_SAMPLE, from ``app.emerging_status`` (never the model).
    status: str


@dataclass(frozen=True)
class TopicTrendsResult:
    status: Status
    period_from: dt.date | None = None
    period_to: dt.date | None = None
    prior_from: dt.date | None = None
    prior_to: dt.date | None = None
    territory_filter: str | None = None
    territory_in_scope: bool | None = None
    current_total: int = 0
    prior_total: int = 0
    topics: tuple[TopicTrend, ...] = ()
    rule: str = ""
    examples: tuple[ResponseExample, ...] = ()
    data_through: dt.datetime | None = None
    citations: tuple[Citation, ...] = ()
    detail: str = ""


@dataclass(frozen=True)
class AnswerBar:
    label: str
    responses: int
    distinct_hcps: int


@dataclass(frozen=True)
class QuestionBreakdownResult:
    status: Status
    question_id: str = ""
    question_text: str = ""
    question_type: str = ""
    period_from: dt.date | None = None
    period_to: dt.date | None = None
    territory_filter: str | None = None
    territory_in_scope: bool | None = None
    responses: int = 0
    distinct_hcps: int = 0
    bars: tuple[AnswerBar, ...] = ()
    data_through: dt.datetime | None = None
    citations: tuple[Citation, ...] = ()
    detail: str = ""


class ScopedReadRepository(Protocol):
    def chart(
        self,
        identity: Identity,
        *,
        shape: str,
        metric: str,
        group_by: str,
        period_from: dt.date | None,
        period_to: dt.date | None,
        territory_id: str | None,
        product: str | None,
        topic: str | None,
        answer_type: str | None,
        last_days: int | None = None,
    ) -> ChartResult: ...

    def activity_summary(
        self,
        identity: Identity,
        *,
        period_from: dt.date | None,
        period_to: dt.date | None,
        territory_id: str | None,
        product: str | None,
    ) -> ActivityResult: ...

    def search_responses(
        self,
        identity: Identity,
        *,
        topic: str,
        period_from: dt.date | None,
        period_to: dt.date | None,
        territory_id: str | None,
    ) -> ResponseSearchResult: ...

    def scope(self, identity: Identity) -> ScopeResult: ...

    def topic_trends(
        self,
        identity: Identity,
        *,
        period_from: dt.date | None,
        period_to: dt.date | None,
        territory_id: str | None,
    ) -> TopicTrendsResult: ...

    def question_breakdown(
        self,
        identity: Identity,
        *,
        question_id: str,
        period_from: dt.date | None,
        period_to: dt.date | None,
        territory_id: str | None,
    ) -> QuestionBreakdownResult: ...


def _clip(text: str | None, limit: int = SNIPPET_CHARS) -> str:
    value = " ".join((text or "").split())
    return value if len(value) <= limit else value[: limit - 1] + "…"


def _like(topic: str) -> str:
    """Escape LIKE wildcards so a topic is always a literal substring."""
    return "%" + topic.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


class PostgresScopedRepository:
    """Production adapter. It never executes a query before establishing the RLS session."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    @contextmanager
    def _session(self, identity: Identity) -> Iterator[psycopg.Cursor]:
        with psycopg.connect(self._database_url, connect_timeout=5, application_name="msl-agent") as conn:
            with conn.transaction(), conn.cursor() as cur:
                cur.execute(
                    "SELECT app.set_request_identity(%s, %s, %s)",
                    (identity.user_id, identity.persona, identity.correlation_id),
                )
                yield cur

    @staticmethod
    def _gate(cur: psycopg.Cursor) -> Status:
        """Deterministic access gate shared by every read tool."""
        cur.execute("SELECT app.has_permission('admin.manage'), app.has_permission('source.records.read')")
        is_admin, can_read_records = cur.fetchone()
        if not (is_admin or can_read_records):
            # Aggregate-only personas (Executive) get suppressed aggregates through a separate path
            # (ticket #13). Source-row counts here would read as zero, which misreports "no access".
            return "aggregate_only"
        if not is_admin:
            cur.execute("SELECT EXISTS (SELECT 1 FROM app.current_scope_territories())")
            if not cur.fetchone()[0]:
                return "no_scope"
        return "ok"

    @staticmethod
    def _data_through(cur: psycopg.Cursor) -> dt.datetime | None:
        cur.execute(
            """
            SELECT LEAST((SELECT max(sys_inserted_datetime) FROM call_activity),
                         (SELECT max(sys_inserted_datetime) FROM hcp_raw_insights))
            """
        )
        return cur.fetchone()[0]

    @staticmethod
    def _period(
        period_from: dt.date | None,
        period_to: dt.date | None,
        data_through: dt.datetime | None,
        days: int | None = None,
    ) -> tuple[dt.date, dt.date] | None:
        end = period_to or (data_through.date() if data_through else dt.date.today())
        start = period_from or end - dt.timedelta(days=(days or DEFAULT_WINDOW_DAYS) - 1)
        if start > end or (end - start).days > MAX_RANGE_DAYS:
            return None
        return start, end

    def activity_summary(
        self,
        identity: Identity,
        *,
        period_from: dt.date | None,
        period_to: dt.date | None,
        territory_id: str | None,
        product: str | None,
    ) -> ActivityResult:
        if territory_id is not None and not _TERRITORY.match(territory_id):
            return ActivityResult(status="bad_request", detail="invalid_territory_id")
        with self._session(identity) as cur:
            gate = self._gate(cur)
            if gate != "ok":
                return ActivityResult(status=gate)
            data_through = self._data_through(cur)
            window = self._period(period_from, period_to, data_through)
            if window is None:
                return ActivityResult(status="bad_request", detail="invalid_period")
            start, end = window
            in_scope: bool | None = None
            if territory_id is not None:
                cur.execute("SELECT app.can_read_territory(%s)", (territory_id,))
                in_scope = bool(cur.fetchone()[0])
            params = {
                "frm": start,
                "to": end,
                "territory": territory_id,
                "product": product,
                "product_like": _like(product) if product else None,
            }
            # RLS already restricts call_activity / hcp_raw_insights to the caller's scope; the
            # optional territory and product filters only narrow it further.
            cur.execute(
                """
                SELECT
                  (SELECT count(DISTINCT crm_call_id) FROM call_activity
                     WHERE call_dt BETWEEN %(frm)s AND %(to)s
                       AND (%(territory)s::text IS NULL OR territory_id = %(territory)s)
                       AND (%(product)s::text IS NULL OR prd_nm ILIKE %(product_like)s ESCAPE '\\')),
                  (SELECT count(DISTINCT cust_mdm_id) FROM call_activity
                     WHERE call_dt BETWEEN %(frm)s AND %(to)s
                       AND (%(territory)s::text IS NULL OR territory_id = %(territory)s)
                       AND (%(product)s::text IS NULL OR prd_nm ILIKE %(product_like)s ESCAPE '\\')),
                  (SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights
                     WHERE date_of_interaction BETWEEN %(frm)s AND %(to)s
                       AND excluded_rspns_flag IS NOT TRUE
                       AND (%(territory)s::text IS NULL OR territory_id = %(territory)s)
                       AND (%(product)s::text IS NULL OR molecule_type ILIKE %(product_like)s ESCAPE '\\'))
                """,
                params,
            )
            calls, hcps, responses = (int(v) for v in cur.fetchone())
            cur.execute(
                """
                SELECT crm_call_id, min(call_dt), min(call_type)
                FROM call_activity
                WHERE call_dt BETWEEN %(frm)s AND %(to)s
                  AND crm_call_id IS NOT NULL
                  AND (%(territory)s::text IS NULL OR territory_id = %(territory)s)
                  AND (%(product)s::text IS NULL OR prd_nm ILIKE %(product_like)s ESCAPE '\\')
                GROUP BY crm_call_id
                ORDER BY min(call_dt) DESC, crm_call_id
                LIMIT %(limit)s
                """,
                {**params, "limit": MAX_EXAMPLES},
            )
            citations = tuple(
                Citation(
                    record_id=row[0],
                    dataset="call_activity",
                    label=f"Call on {row[1].isoformat()}" + (f" ({row[2]})" if row[2] else ""),
                )
                for row in cur.fetchall()
            )
        return ActivityResult(
            status="ok",
            period_from=start,
            period_to=end,
            territory_filter=territory_id,
            territory_in_scope=in_scope,
            product_filter=product,
            calls=calls,
            engaged_hcps=hcps,
            responses=responses,
            data_through=data_through,
            citations=citations,
        )

    def search_responses(
        self,
        identity: Identity,
        *,
        topic: str,
        period_from: dt.date | None,
        period_to: dt.date | None,
        territory_id: str | None,
    ) -> ResponseSearchResult:
        if territory_id is not None and not _TERRITORY.match(territory_id):
            return ResponseSearchResult(status="bad_request", detail="invalid_territory_id")
        with self._session(identity) as cur:
            gate = self._gate(cur)
            if gate != "ok":
                return ResponseSearchResult(status=gate, topic=topic)
            data_through = self._data_through(cur)
            window = self._period(period_from, period_to, data_through)
            if window is None:
                return ResponseSearchResult(status="bad_request", detail="invalid_period")
            start, end = window
            params = {"frm": start, "to": end, "territory": territory_id, "like": _like(topic)}
            where = """
                date_of_interaction BETWEEN %(frm)s AND %(to)s
                AND excluded_rspns_flag IS NOT TRUE
                AND uniq_rspns_id IS NOT NULL
                AND (%(territory)s::text IS NULL OR territory_id = %(territory)s)
                AND (qstn_txt ILIKE %(like)s ESCAPE '\\' OR rspns_txt ILIKE %(like)s ESCAPE '\\'
                     OR molecule_type ILIKE %(like)s ESCAPE '\\' OR landscape_type ILIKE %(like)s ESCAPE '\\'
                     OR study_name ILIKE %(like)s ESCAPE '\\' OR survey_type ILIKE %(like)s ESCAPE '\\')
            """
            cur.execute(f"SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE {where}", params)
            matches = int(cur.fetchone()[0])
            cur.execute(
                f"""
                SELECT uniq_rspns_id, date_of_interaction, molecule_type, qstn_txt, rspns_txt FROM (
                  SELECT DISTINCT ON (uniq_rspns_id)
                         uniq_rspns_id, date_of_interaction, molecule_type, qstn_txt, rspns_txt
                  FROM hcp_raw_insights WHERE {where}
                  ORDER BY uniq_rspns_id, date_of_interaction DESC
                ) latest
                ORDER BY date_of_interaction DESC, uniq_rspns_id
                LIMIT %(limit)s
                """,
                {**params, "limit": MAX_EXAMPLES},
            )
            examples = tuple(
                ResponseExample(
                    record_id=row[0],
                    interaction_date=row[1],
                    molecule=row[2],
                    question=_clip(row[3]),
                    response=_clip(row[4]),
                )
                for row in cur.fetchall()
            )
        citations = tuple(
            Citation(
                record_id=e.record_id,
                dataset="hcp_raw_insights",
                label="Recorded response"
                + (f" on {e.interaction_date.isoformat()}" if e.interaction_date else "")
                + (f" ({e.molecule})" if e.molecule else ""),
            )
            for e in examples
        )
        return ResponseSearchResult(
            status="ok",
            topic=topic,
            period_from=start,
            period_to=end,
            matches=matches,
            examples=examples,
            data_through=data_through,
            citations=citations,
        )

    def chart(
        self,
        identity: Identity,
        *,
        shape: str,
        metric: str,
        group_by: str,
        period_from: dt.date | None,
        period_to: dt.date | None,
        territory_id: str | None,
        product: str | None,
        topic: str | None,
        answer_type: str | None,
        last_days: int | None = None,
    ) -> ChartResult:
        if territory_id is not None and not _TERRITORY.match(territory_id):
            return ChartResult(status="bad_request", detail="invalid_territory_id")
        if shape != "distribution" and not chart_data.is_valid_pair(metric, group_by):
            return ChartResult(status="bad_request", detail="unsupported_grouping")
        with self._session(identity) as cur:
            gate = self._gate(cur)
            if gate != "ok":
                return ChartResult(status=gate)
            data_through = self._data_through(cur)
            window = self._period(period_from, period_to, data_through, last_days)
            if window is None:
                return ChartResult(status="bad_request", detail="invalid_period")
            start, end = window
            if not chart_data.fits(shape, group_by, start, end):
                return ChartResult(status="bad_request", detail="too_many_buckets")
            in_scope: bool | None = None
            if territory_id is not None:
                cur.execute("SELECT app.can_read_territory(%s)", (territory_id,))
                in_scope = bool(cur.fetchone()[0])
                if not in_scope:
                    return ChartResult(status="ok", params=None, territory_in_scope=False, data_through=data_through)
            params = ChartParams(
                metric=metric,
                group_by=group_by,
                period_from=start,
                period_to=end,
                territory_id=territory_id,
                product=product,
                topic=topic,
                answer_type=answer_type,
            )
            if shape == "matrix":
                matrix, left_out = chart_data.run_matrix(cur, params)
                total = chart_data.total_count(cur, params)
                return ChartResult("ok", shape, params, in_scope, matrix=matrix, total=total, left_out=left_out, data_through=data_through)
            if shape == "table":
                table, total, left_out = chart_data.run_table(cur, params)
                return ChartResult("ok", shape, params, in_scope, table=tuple(table), total=total, left_out=left_out, data_through=data_through)
            if shape == "distribution":
                rows, total = chart_data.run_distribution(cur, params)
                return ChartResult("ok", shape, params, in_scope, rows=tuple(rows), total=total, data_through=data_through)
            rows, total, left_out = chart_data.run_series(cur, params)
            return ChartResult("ok", shape, params, in_scope, rows=tuple(rows), total=total, left_out=left_out, data_through=data_through)

    def scope(self, identity: Identity) -> ScopeResult:
        with self._session(identity) as cur:
            gate = self._gate(cur)
            if gate != "ok":
                return ScopeResult(status=gate)
            cur.execute("SELECT app.has_permission('admin.manage')")
            is_admin = bool(cur.fetchone()[0])
            cur.execute(
                """
                SELECT s.territory_id FROM app.current_scope_territories() s
                WHERE NOT EXISTS (
                  SELECT 1 FROM territory_scope_relationships r
                  WHERE r.parent_territory_id = s.territory_id
                    AND r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now()))
                ORDER BY 1
                """
            )
            ids = tuple(row[0] for row in cur.fetchall())
            if is_admin:
                cur.execute("SELECT DISTINCT territory_id FROM call_activity ORDER BY 1")
                ids = tuple(row[0] for row in cur.fetchall())
            return ScopeResult(
                status="ok",
                territory_ids=ids[:100],
                territory_count=len(ids),
                data_through=self._data_through(cur),
            )

    def topic_trends(
        self,
        identity: Identity,
        *,
        period_from: dt.date | None,
        period_to: dt.date | None,
        territory_id: str | None,
    ) -> TopicTrendsResult:
        """Free-text themes for the window against the equal window before it, judged by the database rule."""
        if territory_id is not None and not _TERRITORY.match(territory_id):
            return TopicTrendsResult(status="bad_request", detail="invalid_territory_id")
        with self._session(identity) as cur:
            gate = self._gate(cur)
            if gate != "ok":
                return TopicTrendsResult(status=gate)
            data_through = self._data_through(cur)
            window = self._period(period_from, period_to, data_through)
            if window is None:
                return TopicTrendsResult(status="bad_request", detail="invalid_period")
            start, end = window
            days = (end - start).days + 1
            prior_end = start - dt.timedelta(days=1)
            prior_start = start - dt.timedelta(days=days)
            in_scope: bool | None = None
            if territory_id is not None:
                cur.execute("SELECT app.can_read_territory(%s)", (territory_id,))
                in_scope = bool(cur.fetchone()[0])
            params = {"frm": start, "pfrm": prior_start, "to": end, "territory": territory_id}
            free_text = (
                "h.qstn_type = 'open_text' AND nullif(btrim(h.rspns_txt), '') IS NOT NULL "
                "AND h.excluded_rspns_flag IS NOT TRUE AND h.uniq_rspns_id IS NOT NULL "
                "AND (%(territory)s::text IS NULL OR h.territory_id = %(territory)s)"
            )
            cur.execute(
                f"""
                WITH base AS (
                  SELECT app.theme_of(h.rspns_txt) AS topic, h.uniq_rspns_id, (h.date_of_interaction >= %(frm)s) AS in_cur
                  FROM hcp_raw_insights h
                  WHERE {free_text} AND h.date_of_interaction BETWEEN %(pfrm)s AND %(to)s
                ), grp AS (
                  SELECT topic, count(DISTINCT uniq_rspns_id) FILTER (WHERE in_cur) AS cur_n,
                         count(DISTINCT uniq_rspns_id) FILTER (WHERE NOT in_cur) AS pri_n FROM base GROUP BY 1
                ), tot AS (
                  SELECT count(DISTINCT uniq_rspns_id) FILTER (WHERE in_cur) AS cur_t,
                         count(DISTINCT uniq_rspns_id) FILTER (WHERE NOT in_cur) AS pri_t FROM base
                )
                SELECT g.topic, g.cur_n, g.pri_n, t.cur_t, t.pri_t, app.emerging_status(g.cur_n, g.pri_n, t.cur_t, t.pri_t)
                FROM grp g CROSS JOIN tot t
                ORDER BY g.cur_n DESC, g.topic
                """,
                params,
            )
            rows = cur.fetchall()
            cur.execute("SELECT min_window_responses, min_topic_responses, min_relative_increase, min_share_points FROM app.emerging_thresholds()")
            window_n, topic_n, rel, points = cur.fetchone()
            rule = (
                f"EMERGING means: at least {int(window_n)} free-text responses in both periods, at least {int(topic_n)} on the topic "
                f"in the latest period, its share up by at least {float(points):g} percentage points, and at least {1 + float(rel):g} "
                "times its earlier share. DECLINING is the mirror image."
            )
            topics = tuple(TopicTrend(r[0], int(r[1]), int(r[2]), r[5]) for r in rows)
            flagged = [t.topic for t in topics if t.status in ("EMERGING", "DECLINING")]
            lead = [t.topic for t in topics if t.topic != "Other perspectives"][:3]
            examples: list[ResponseExample] = []
            for topic in dict.fromkeys([*flagged, *lead]):
                cur.execute(
                    f"""
                    SELECT h.uniq_rspns_id, h.date_of_interaction, h.molecule_type, h.qstn_txt, h.rspns_txt
                    FROM hcp_raw_insights h
                    WHERE {free_text} AND h.date_of_interaction BETWEEN %(frm)s AND %(to)s AND app.theme_of(h.rspns_txt) = %(topic)s
                    ORDER BY h.date_of_interaction DESC, h.uniq_rspns_id LIMIT 1
                    """,
                    {**params, "topic": topic},
                )
                row = cur.fetchone()
                if row:
                    examples.append(ResponseExample(row[0], row[1], row[2], _clip(row[3]), _clip(row[4])))
            current_total = int(rows[0][3]) if rows else 0
            prior_total = int(rows[0][4]) if rows else 0
        citations = tuple(
            Citation(
                record_id=e.record_id,
                dataset="hcp_raw_insights",
                label="Recorded response" + (f" on {e.interaction_date.isoformat()}" if e.interaction_date else ""),
            )
            for e in examples
        )
        return TopicTrendsResult(
            status="ok",
            period_from=start,
            period_to=end,
            prior_from=prior_start,
            prior_to=prior_end,
            territory_filter=territory_id,
            territory_in_scope=in_scope,
            current_total=current_total,
            prior_total=prior_total,
            topics=topics,
            rule=rule,
            examples=tuple(examples),
            data_through=data_through,
            citations=citations,
        )

    def question_breakdown(
        self,
        identity: Identity,
        *,
        question_id: str,
        period_from: dt.date | None,
        period_to: dt.date | None,
        territory_id: str | None,
    ) -> QuestionBreakdownResult:
        if not _QUESTION.match(question_id) or (territory_id is not None and not _TERRITORY.match(territory_id)):
            return QuestionBreakdownResult(status="bad_request", detail="invalid_id")
        with self._session(identity) as cur:
            gate = self._gate(cur)
            if gate != "ok":
                return QuestionBreakdownResult(status=gate)
            data_through = self._data_through(cur)
            window = self._period(period_from, period_to, data_through)
            if window is None:
                return QuestionBreakdownResult(status="bad_request", detail="invalid_period")
            start, end = window
            in_scope: bool | None = None
            if territory_id is not None:
                cur.execute("SELECT app.can_read_territory(%s)", (territory_id,))
                in_scope = bool(cur.fetchone()[0])
            params = {"frm": start, "to": end, "territory": territory_id, "qid": question_id}
            where = (
                "h.qstn_ext_id = %(qid)s AND h.date_of_interaction BETWEEN %(frm)s AND %(to)s "
                "AND h.excluded_rspns_flag IS NOT TRUE AND h.uniq_rspns_id IS NOT NULL "
                "AND (%(territory)s::text IS NULL OR h.territory_id = %(territory)s)"
            )
            cur.execute(
                f"SELECT min(h.qstn_txt), min(h.qstn_type), count(DISTINCT h.uniq_rspns_id), count(DISTINCT h.cust_mdm_id) FROM hcp_raw_insights h WHERE {where}",
                params,
            )
            text, qtype, responses, hcps = cur.fetchone()
            if not responses:
                return QuestionBreakdownResult(
                    status="ok", question_id=question_id, period_from=start, period_to=end,
                    territory_filter=territory_id, territory_in_scope=in_scope, data_through=data_through,
                )
            cur.execute(
                f"""
                WITH r AS (SELECT h.uniq_rspns_id, h.cust_mdm_id, btrim(h.rspns_txt) AS ans, h.qstn_type FROM hcp_raw_insights h WHERE {where}),
                o AS (
                  SELECT r.uniq_rspns_id, r.cust_mdm_id,
                         CASE WHEN r.qstn_type = 'open_text' THEN app.theme_of(r.ans)
                              WHEN r.qstn_type = 'ranking' THEN 'Ranked first: ' || split_part(r.ans, ' > ', 1)
                              ELSE coalesce(nullif(btrim(opt.value), ''), 'No response recorded') END AS label
                  FROM r CROSS JOIN LATERAL unnest(CASE WHEN r.qstn_type = 'multi_select' THEN string_to_array(r.ans, ';') ELSE ARRAY[r.ans] END) AS opt(value)
                )
                SELECT label, count(DISTINCT uniq_rspns_id), count(DISTINCT cust_mdm_id) FROM o GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8
                """,
                params,
            )
            bars = tuple(AnswerBar(r[0], int(r[1]), int(r[2])) for r in cur.fetchall())
            cur.execute(
                f"SELECT DISTINCT ON (h.uniq_rspns_id) h.uniq_rspns_id, h.date_of_interaction FROM hcp_raw_insights h WHERE {where} ORDER BY h.uniq_rspns_id, h.date_of_interaction DESC LIMIT %(limit)s",
                {**params, "limit": MAX_EXAMPLES},
            )
            citations = tuple(
                Citation(record_id=r[0], dataset="hcp_raw_insights", label="Recorded response" + (f" on {r[1].isoformat()}" if r[1] else ""))
                for r in cur.fetchall()
            )
        return QuestionBreakdownResult(
            status="ok",
            question_id=question_id,
            question_text=_clip(text),
            question_type=qtype or "",
            period_from=start,
            period_to=end,
            territory_filter=territory_id,
            territory_in_scope=in_scope,
            responses=int(responses),
            distinct_hcps=int(hcps),
            bars=bars,
            data_through=data_through,
            citations=citations,
        )


class FixtureScopedRepository:
    """Deterministic in-memory double with the same interface, for unit tests that need no database."""

    DATA_THROUGH = dt.datetime(2026, 11, 3, 12, 0, tzinfo=dt.UTC)
    _CALLS = {
        "T01-01": (("CALL-00001", dt.date(2026, 11, 3)), ("CALL-08761", dt.date(2026, 11, 2))),
        "T02-01": (("CALL-09001", dt.date(2026, 11, 3)),),
    }

    def _scope_for(self, identity: Identity) -> tuple[str, ...]:
        mapping = {"msl-t01-01": ("T01-01",), "msl-t02-01": ("T02-01",)}
        return mapping.get(identity.user_id, ())

    def activity_summary(
        self,
        identity: Identity,
        *,
        period_from: dt.date | None,
        period_to: dt.date | None,
        territory_id: str | None,
        product: str | None,
    ) -> ActivityResult:
        if identity.persona == "Executive":
            return ActivityResult(status="aggregate_only")
        scope = self._scope_for(identity)
        if not scope:
            return ActivityResult(status="no_scope")
        in_scope = None if territory_id is None else territory_id in scope
        visible = [t for t in scope if territory_id in (None, t)]
        rows = [row for t in visible for row in self._CALLS[t]]
        return ActivityResult(
            status="ok",
            period_from=period_from or dt.date(2026, 8, 6),
            period_to=period_to or dt.date(2026, 11, 3),
            territory_filter=territory_id,
            territory_in_scope=in_scope,
            product_filter=product,
            calls=len(rows),
            engaged_hcps=len(rows),
            responses=2 * len(rows),
            data_through=self.DATA_THROUGH,
            citations=tuple(
                Citation(record_id=cid, dataset="call_activity", label=f"Call on {day.isoformat()}")
                for cid, day in rows
            ),
        )

    def search_responses(
        self,
        identity: Identity,
        *,
        topic: str,
        period_from: dt.date | None,
        period_to: dt.date | None,
        territory_id: str | None,
    ) -> ResponseSearchResult:
        if identity.persona == "Executive":
            return ResponseSearchResult(status="aggregate_only", topic=topic)
        if not self._scope_for(identity):
            return ResponseSearchResult(status="no_scope", topic=topic)
        example = ResponseExample(
            "RESP-000001", dt.date(2026, 11, 3), "osimertinib", "How is it used?", "Evidence matters."
        )
        return ResponseSearchResult(
            status="ok",
            topic=topic,
            period_from=period_from or dt.date(2026, 8, 6),
            period_to=period_to or dt.date(2026, 11, 3),
            matches=1,
            examples=(example,),
            data_through=self.DATA_THROUGH,
            citations=(
                Citation(record_id="RESP-000001", dataset="hcp_raw_insights", label="Recorded response"),
            ),
        )

    # -- chart double -------------------------------------------------------------------------
    # Its own small dataset (calls and responses with dates, products and answers) so chart tests have
    # a ground truth they can compute by hand. It does not feed ``activity_summary``.
    _CHART_CALLS = (
        # call id, date, territory, product, call type, hcp
        ("CALL-00001", dt.date(2026, 11, 3), "T01-01", "osimertinib", "scientific", "H1"),
        ("CALL-08761", dt.date(2026, 11, 2), "T01-01", "pembrolizumab", "scientific", "H2"),
        ("CALL-00002", dt.date(2026, 10, 15), "T01-01", "osimertinib", "scientific", "H1"),
        ("CALL-00003", dt.date(2026, 10, 1), "T01-01", "pembrolizumab", "scientific", "H3"),
        ("CALL-00004", dt.date(2026, 9, 12), "T01-01", "osimertinib", "scientific", "H2"),
        ("CALL-00005", dt.date(2026, 9, 12), "T01-01", "osimertinib", "scientific", "H4"),
        ("CALL-09001", dt.date(2026, 11, 3), "T02-01", "osimertinib", "scientific", "H9"),
        ("CALL-09002", dt.date(2026, 10, 20), "T02-01", "pembrolizumab", "scientific", "H9"),
    )
    _CHART_RESPONSES = (
        # response id, date, territory, molecule, answer type, program, answer
        ("RESP-000001", dt.date(2026, 11, 3), "T01-01", "osimertinib", "likert_5", "MSL pulse", "4"),
        ("RESP-000002", dt.date(2026, 11, 3), "T01-01", "osimertinib", "likert_5", "MSL pulse", "5"),
        ("RESP-000003", dt.date(2026, 10, 15), "T01-01", "pembrolizumab", "yes_no", "Advisory board", "Yes"),
        ("RESP-000004", dt.date(2026, 10, 1), "T01-01", "osimertinib", "likert_5", "MSL pulse", "4"),
        ("RESP-000005", dt.date(2026, 9, 12), "T01-01", "osimertinib", "open_text", "MSL pulse", "Access matters."),
        ("RESP-000006", dt.date(2026, 11, 2), "T02-01", "osimertinib", "likert_5", "MSL pulse", "2"),
    )

    def chart(
        self,
        identity: Identity,
        *,
        shape: str,
        metric: str,
        group_by: str,
        period_from: dt.date | None,
        period_to: dt.date | None,
        territory_id: str | None,
        product: str | None,
        topic: str | None,
        answer_type: str | None,
        last_days: int | None = None,
    ) -> ChartResult:
        if identity.persona == "Executive":
            return ChartResult(status="aggregate_only")
        scope = self._scope_for(identity)
        if not scope:
            return ChartResult(status="no_scope")
        if shape != "distribution" and not chart_data.is_valid_pair(metric, group_by):
            return ChartResult(status="bad_request", detail="unsupported_grouping")
        if territory_id is not None and territory_id not in scope:
            return ChartResult(status="ok", territory_in_scope=False, data_through=self.DATA_THROUGH)
        end = period_to or self.DATA_THROUGH.date()
        start = period_from or end - dt.timedelta(days=(last_days or chart_data.DEFAULT_DAYS) - 1)
        params = ChartParams(metric, group_by, start, end, territory_id, product, topic, answer_type)

        def visible(row_date: dt.date, row_territory: str, row_product: str) -> bool:
            return (
                start <= row_date <= end
                and row_territory in scope
                and territory_id in (None, row_territory)
                and (not product or product.lower() in row_product.lower())
            )

        def group_key(name: str, row_date: dt.date, fields: dict[str, str]) -> str:
            if name == "day":
                return row_date.isoformat()
            if name == "week":
                return (row_date - dt.timedelta(days=row_date.weekday())).isoformat()
            if name == "month":
                return row_date.strftime("%Y-%m")
            return fields[name]

        def counts(metric_name: str, group_name: str | None) -> dict[str, int]:
            seen: dict[str, set[str]] = {}
            if metric_name == "responses":
                for rid, day, terr, mol, qtype, program, _ in self._CHART_RESPONSES:
                    if not visible(day, terr, mol):
                        continue
                    if topic and topic.lower() not in f"{mol} {program} {qtype}".lower():
                        continue
                    fields = {"territory": terr, "product": mol, "question_type": qtype, "program": program}
                    key = group_key(group_name, day, fields) if group_name else "all"
                    seen.setdefault(key, set()).add(rid)
            else:
                for cid, day, terr, prod, ctype, hcp in self._CHART_CALLS:
                    if not visible(day, terr, prod):
                        continue
                    fields = {"territory": terr, "product": prod, "call_type": ctype}
                    key = group_key(group_name, day, fields) if group_name else "all"
                    seen.setdefault(key, set()).add(cid if metric_name == "calls" else hcp)
            return {k: len(v) for k, v in seen.items()}

        total = counts(metric, None).get("all", 0)
        if shape == "distribution":
            answers: dict[str, set[str]] = {}
            for rid, day, terr, mol, qtype, program, answer in self._CHART_RESPONSES:
                if qtype == answer_type and visible(day, terr, mol):
                    if not topic or topic.lower() in f"{mol} {program}".lower():
                        answers.setdefault(answer, set()).add(rid)
            found = {k: len(v) for k, v in answers.items()}
            order = chart_data._ANSWER_ORDER.get(answer_type or "")
            keys = order or sorted(found, key=lambda k: (-found[k], k))
            rows = tuple(SeriesRow(k, k, found.get(k, 0)) for k in keys)
            return ChartResult("ok", shape, params, None, rows=rows, total=sum(found.values()), data_through=self.DATA_THROUGH)
        if shape == "matrix":
            months = chart_data.month_starts(start, end)
            by_row = counts(metric, group_by)
            cells: dict[str, dict[str, int]] = {}
            source = self._CHART_RESPONSES if metric == "responses" else self._CHART_CALLS
            for row in source:
                day, terr = row[1], row[2]
                prod = row[3]
                if not visible(day, terr, prod):
                    continue
                cells.setdefault(terr if group_by == "territory" else prod, {}).setdefault(day.strftime("%Y-%m"), set()).add(row[0] if metric != "engaged_hcps" else row[5])
            ranked = sorted(by_row, key=lambda k: (-by_row[k], k))[: chart_data.MAX_ROWS]
            rows = tuple((k, tuple(len(cells.get(k, {}).get(m, ())) for m in months)) for k in ranked)
            return ChartResult("ok", shape, params, None, matrix=Matrix(tuple(months), rows), total=total, data_through=self.DATA_THROUGH)
        if shape == "table":
            per = {m: counts(m, group_by) for m in chart_data.METRICS}
            keys = chart_data.buckets(group_by, start, end) if group_by in chart_data.TIME_DIMS else sorted(
                set().union(*(c.keys() for c in per.values())), key=lambda k: (-per["calls"].get(k, 0), k)
            )
            table = tuple(TableRow(k, tuple(per[m].get(k, 0) for m in chart_data.METRICS)) for k in keys[: chart_data.MAX_ROWS])
            return ChartResult("ok", shape, params, None, table=table, total=counts("calls", None).get("all", 0), data_through=self.DATA_THROUGH)
        found = counts(metric, group_by)
        if group_by in chart_data.TIME_DIMS:
            rows = tuple(SeriesRow(k, k, found.get(k, 0)) for k in chart_data.buckets(group_by, start, end))
            return ChartResult("ok", shape, params, None, rows=rows, total=total, data_through=self.DATA_THROUGH)
        ranked = sorted(found.items(), key=lambda kv: (-kv[1], kv[0]))
        rows = tuple(SeriesRow(k, k, v) for k, v in ranked[: chart_data.MAX_BARS])
        return ChartResult("ok", shape, params, None, rows=rows, total=total, left_out=max(0, len(ranked) - len(rows)), data_through=self.DATA_THROUGH)

    def scope(self, identity: Identity) -> ScopeResult:
        if identity.persona == "Executive":
            return ScopeResult(status="aggregate_only")
        ids = self._scope_for(identity)
        if not ids:
            return ScopeResult(status="no_scope")
        return ScopeResult(
            status="ok", territory_ids=ids, territory_count=len(ids), data_through=self.DATA_THROUGH
        )

    def topic_trends(
        self,
        identity: Identity,
        *,
        period_from: dt.date | None,
        period_to: dt.date | None,
        territory_id: str | None,
    ) -> TopicTrendsResult:
        if identity.persona == "Executive":
            return TopicTrendsResult(status="aggregate_only")
        scope = self._scope_for(identity)
        if not scope:
            return TopicTrendsResult(status="no_scope")
        in_scope = None if territory_id is None else territory_id in scope
        topics = (
            TopicTrend("ctDNA monitoring (emerging)", 72, 21, "EMERGING"),
            TopicTrend("Access and reimbursement", 99, 104, "STABLE"),
        )
        example = ResponseExample(
            "RESP-000001", dt.date(2026, 11, 3), "osimertinib", "How is it used?", "ctDNA monitoring after surgery."
        )
        return TopicTrendsResult(
            status="ok",
            period_from=period_from or dt.date(2026, 8, 6),
            period_to=period_to or dt.date(2026, 11, 3),
            prior_from=dt.date(2026, 5, 8),
            prior_to=dt.date(2026, 8, 5),
            territory_filter=territory_id,
            territory_in_scope=in_scope,
            current_total=711,
            prior_total=701,
            topics=topics,
            rule="EMERGING means: at least 30 free-text responses in both periods and a clear rise in share. DECLINING is the mirror image.",
            examples=(example,),
            data_through=self.DATA_THROUGH,
            citations=(Citation(record_id="RESP-000001", dataset="hcp_raw_insights", label="Recorded response"),),
        )

    def question_breakdown(
        self,
        identity: Identity,
        *,
        question_id: str,
        period_from: dt.date | None,
        period_to: dt.date | None,
        territory_id: str | None,
    ) -> QuestionBreakdownResult:
        if identity.persona == "Executive":
            return QuestionBreakdownResult(status="aggregate_only")
        scope = self._scope_for(identity)
        if not scope:
            return QuestionBreakdownResult(status="no_scope")
        in_scope = None if territory_id is None else territory_id in scope
        return QuestionBreakdownResult(
            status="ok",
            question_id=question_id,
            question_text="Would you consider it earlier?",
            question_type="yes_no",
            period_from=period_from or dt.date(2026, 8, 6),
            period_to=period_to or dt.date(2026, 11, 3),
            territory_filter=territory_id,
            territory_in_scope=in_scope,
            responses=29,
            distinct_hcps=29,
            bars=(AnswerBar("Yes", 16, 15), AnswerBar("No", 10, 10), AnswerBar("Unsure", 3, 3)),
            data_through=self.DATA_THROUGH,
            citations=(Citation(record_id="RESP-000001", dataset="hcp_raw_insights", label="Recorded response"),),
        )


def repository_for(database_url: str | None) -> ScopedReadRepository:
    return PostgresScopedRepository(database_url) if database_url else FixtureScopedRepository()
