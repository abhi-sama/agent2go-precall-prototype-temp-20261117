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
from typing import Any, Literal, Protocol

import psycopg
from a2g_exec_analysis import suppress_flags

from . import chart_data
from .chart_data import ChartParams, Matrix, SeriesRow, TableRow
from .schemas import Citation, Identity

MAX_RANGE_DAYS = 366 * 3
DEFAULT_WINDOW_DAYS = 90
MAX_EXAMPLES = 5
SNIPPET_CHARS = 240

_TERRITORY = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
_QUESTION = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")

Status = Literal["ok", "aggregate_only", "no_scope", "bad_request", "executive_only"]


@dataclass(frozen=True)
class ActivityResult:
    status: Status
    period_from: dt.date | None = None
    period_to: dt.date | None = None
    territory_filter: str | None = None
    #: False when the caller asked for a territory their scope does not cover (so no rows exist for them).
    territory_in_scope: bool | None = None
    product_filter: str | None = None
    specialty_filter: str | None = None
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
    territory_filter: str | None = None
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


EXECUTIVE_FACETS = ("PORTFOLIO", "MOLECULE", "DISEASE_AREA", "STUDY")
_FACET_VALUE = re.compile(r"^[^\x00-\x1f]{1,80}$")


@dataclass(frozen=True)
class ExecutiveAnalysisResult:
    """One Executive aggregate analysis from the shared library (``a2g_exec_analysis``).

    ``data`` has the shape of the GraphQL ExecutiveThemes / ExecutiveTopicMatrix types: camelCase keys, counts as
    ``{value, suppressed}``, already small-group suppressed. The agent adds nothing to it and removes nothing.
    """

    status: Status
    data: dict[str, Any] | None = None
    record_level: bool = False
    data_through: dt.datetime | None = None
    detail: str = ""


@dataclass(frozen=True)
class ExecutiveCount:
    """One aggregate-only count. Suppressed values are deliberately absent, never zero."""

    value: int | None
    suppressed: bool = False


@dataclass(frozen=True)
class ExecutiveActivityRow:
    key: str
    label: str
    count: ExecutiveCount


@dataclass(frozen=True)
class ExecutiveActivityResult:
    """Executive-overview activity aggregates, safe to render in chat without source rows."""

    status: Status
    metric: str = "calls"
    group_by: str = "total"
    period_from: dt.date | None = None
    period_to: dt.date | None = None
    total: ExecutiveCount = field(default_factory=lambda: ExecutiveCount(None, True))
    rows: tuple[ExecutiveActivityRow, ...] = ()
    data_through: dt.datetime | None = None
    detail: str = ""


class ScopedReadRepository(Protocol):
    def territory_in_scope(self, identity: Identity, territory_id: str) -> bool: ...

    def executive_activity(
        self,
        identity: Identity,
        *,
        metric: str,
        group_by: str,
        period_from: dt.date | None,
        period_to: dt.date | None,
    ) -> ExecutiveActivityResult: ...

    def executive_themes(
        self, identity: Identity, *, period_from: dt.date | None, period_to: dt.date | None, facet: str
    ) -> ExecutiveAnalysisResult: ...

    def executive_topic_matrix(
        self,
        identity: Identity,
        *,
        period_from: dt.date | None,
        period_to: dt.date | None,
        facet: str,
        facet_value: str | None,
    ) -> ExecutiveAnalysisResult: ...

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
        specialty: str | None = None,
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

    def territory_in_scope(self, identity: Identity, territory_id: str) -> bool:
        """Check one named territory without exposing whether an out-of-scope id exists."""
        with self._session(identity) as cur:
            if identity.persona == "Executive":
                # Executives have no source-row permission, so their explicit aggregate scope is
                # the authorization source. ``exec_units`` is security-definer and never exposes rows.
                cur.execute("SELECT EXISTS (SELECT 1 FROM app.exec_units() WHERE territory_id = %s)", (territory_id,))
            else:
                cur.execute("SELECT app.can_read_territory(%s)", (territory_id,))
            return bool(cur.fetchone()[0])

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
        specialty: str | None = None,
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
                "specialty": specialty,
                "specialty_like": _like(specialty) if specialty else None,
            }
            # RLS already restricts call_activity / hcp_raw_insights to the caller's scope; the
            # optional territory and product filters only narrow it further.
            cur.execute(
                """
                SELECT
                  (SELECT count(DISTINCT crm_call_id) FROM call_activity
                     WHERE call_dt BETWEEN %(frm)s AND %(to)s
                       AND (%(territory)s::text IS NULL OR territory_id = %(territory)s)
                       AND (%(specialty)s::text IS NULL OR cust_sub_typ ILIKE %(specialty_like)s ESCAPE '\\')
                       AND (%(product)s::text IS NULL OR prd_nm ILIKE %(product_like)s ESCAPE '\\')),
                  (SELECT count(DISTINCT cust_mdm_id) FROM call_activity
                     WHERE call_dt BETWEEN %(frm)s AND %(to)s
                       AND (%(territory)s::text IS NULL OR territory_id = %(territory)s)
                       AND (%(specialty)s::text IS NULL OR cust_sub_typ ILIKE %(specialty_like)s ESCAPE '\\')
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
                  AND (%(specialty)s::text IS NULL OR cust_sub_typ ILIKE %(specialty_like)s ESCAPE '\\')
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
            specialty_filter=specialty,
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
            territory_filter=territory_id,
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

    # -- Executive aggregate activity ---------------------------------------------------------
    def executive_activity(
        self,
        identity: Identity,
        *,
        metric: str,
        group_by: str,
        period_from: dt.date | None,
        period_to: dt.date | None,
    ) -> ExecutiveActivityResult:
        """Read the Executive overview's security-definer cells, never its source rows.

        This intentionally does not reuse the normal activity/chart queries: those are RLS-protected source
        tables and an aggregate-only Executive correctly sees none of their rows. ``app.exec_cells`` is the
        governed aggregate door used by the overview, and its result is suppressed here before it reaches a tool.
        """
        if identity.persona != "Executive":
            return ExecutiveActivityResult(status="executive_only")
        if metric not in ("calls", "engaged_hcps", "responses") or group_by not in ("total", "month", "region", "territory"):
            return ExecutiveActivityResult(status="bad_request", detail="invalid_executive_activity_request")
        with self._session(identity) as cur:
            cur.execute("SELECT app.can_read_aggregate()")
            if not bool(cur.fetchone()[0]):
                return ExecutiveActivityResult(status="aggregate_only")
            cur.execute("SELECT territory_id, territory_name, region_id, region_name FROM app.exec_units() ORDER BY region_id, territory_id")
            units = cur.fetchall()
            if not units:
                return ExecutiveActivityResult(status="no_scope")
            cur.execute("SELECT calls_loaded, responses_loaded FROM app.exec_loads()")
            loaded = [v for v in cur.fetchone() if v is not None]
            if not loaded:
                return ExecutiveActivityResult(status="no_scope")
            data_through = min(loaded)
            window = self._period(period_from, period_to, data_through)
            if window is None:
                return ExecutiveActivityResult(status="bad_request", detail="invalid_period")
            start, end = window
            cur.execute("SELECT level, territory_id, region_id, month, calls, responses, hcps FROM app.exec_cells(%s, %s)", (start, end))
            cells = cur.fetchall()

        metric_index = {"calls": 4, "responses": 5, "engaged_hcps": 6}[metric]
        total = 0
        by_month: dict[str, int] = {}
        by_region: dict[str, int] = {}
        by_territory: dict[str, int] = {}
        for level, territory_id, region_id, month, calls, responses, hcps in cells:
            value = int((calls, responses, hcps)[metric_index - 4] or 0)
            if level == "TOTAL":
                total = value
            elif level == "MONTH" and month is not None:
                # ``app.exec_cells`` exposes a date (the first day of the month); chart keys use YYYY-MM so
                # their label and partial-period helpers can safely reconstruct that calendar month.
                by_month[month.strftime("%Y-%m")] = value
            elif level == "REGION" and region_id:
                by_region[str(region_id)] = value
            elif level == "TERRITORY" and territory_id and month is None:
                by_territory[str(territory_id)] = value

        region_names: dict[str, str] = {}
        territory_names: dict[str, str] = {}
        for territory_id, territory_name, region_id, region_name in units:
            territory_names[str(territory_id)] = f"{territory_id} · {territory_name}"
            region_names[str(region_id)] = str(region_name)
        if group_by == "total":
            hidden = 0 < total < 5
            return ExecutiveActivityResult(
                status="ok", metric=metric, group_by=group_by, period_from=start, period_to=end,
                total=ExecutiveCount(None if hidden else total, hidden), data_through=data_through,
            )

        values = {"month": by_month, "region": by_region, "territory": by_territory}[group_by]
        names = {"month": {}, "region": region_names, "territory": territory_names}[group_by]
        # The shared suppression helper implements the Executive overview's primary and complementary suppression.
        keys = sorted(values)
        flags, total_hidden = suppress_flags([values[key] for key in keys], total, additive=True)
        rows = tuple(
            ExecutiveActivityRow(
                key=key,
                label=key if group_by == "month" else names.get(key, key),
                count=ExecutiveCount(None if flags[index] else values[key], bool(flags[index])),
            )
            for index, key in enumerate(keys)
        )
        return ExecutiveActivityResult(
            status="ok", metric=metric, group_by=group_by, period_from=start, period_to=end,
            total=ExecutiveCount(None if total_hidden else total, bool(total_hidden)), rows=rows,
            data_through=data_through,
        )

    # -- Executive (aggregate-only) analysis ---------------------------------------------------
    def _executive_analysis(
        self,
        identity: Identity,
        *,
        kind: str,
        period_from: dt.date | None,
        period_to: dt.date | None,
        facet: str,
        facet_value: str | None,
    ) -> ExecutiveAnalysisResult:
        if identity.persona != "Executive":
            return ExecutiveAnalysisResult(status="executive_only")
        if facet not in EXECUTIVE_FACETS or (facet_value is not None and not _FACET_VALUE.match(facet_value)):
            return ExecutiveAnalysisResult(status="bad_request", detail="invalid_facet")
        import a2g_exec_analysis as lib  # shared with the BE API Lambda: one definition of every figure and rule

        with self._session(identity) as cur:
            cur.execute("SELECT app.has_permission('source.records.read')")
            record_level = bool(cur.fetchone()[0])
            cur.execute("SELECT calls_loaded, responses_loaded FROM app.exec_loads()")
            loaded = [v for v in cur.fetchone() if v is not None]
            if len(loaded) < 2:
                return ExecutiveAnalysisResult(status="no_scope", record_level=record_level)
            data_through = min(loaded)
            window = self._period(period_from, period_to, data_through)
            if window is None:
                return ExecutiveAnalysisResult(status="bad_request", detail="invalid_period")
            start, end = window
            try:
                if kind == "themes":
                    data = lib.executive_themes(cur, start, end, facet, record_level=record_level)
                else:
                    data = lib.executive_topic_matrix(cur, start, end, facet, facet_value, record_level=record_level)
            except lib.NoExecutiveScope:
                return ExecutiveAnalysisResult(status="no_scope", record_level=record_level)
            except (lib.InvalidFacet, lib.InvalidFacetValue, lib.InvalidWindow):
                return ExecutiveAnalysisResult(status="bad_request", detail="invalid_request", record_level=record_level)
        if not data:
            return ExecutiveAnalysisResult(status="no_scope", record_level=record_level)
        return ExecutiveAnalysisResult(status="ok", data=data, record_level=record_level, data_through=data_through)

    def executive_themes(
        self, identity: Identity, *, period_from: dt.date | None, period_to: dt.date | None, facet: str
    ) -> ExecutiveAnalysisResult:
        return self._executive_analysis(
            identity, kind="themes", period_from=period_from, period_to=period_to, facet=facet, facet_value=None
        )

    def executive_topic_matrix(
        self,
        identity: Identity,
        *,
        period_from: dt.date | None,
        period_to: dt.date | None,
        facet: str,
        facet_value: str | None,
    ) -> ExecutiveAnalysisResult:
        return self._executive_analysis(
            identity, kind="matrix", period_from=period_from, period_to=period_to, facet=facet, facet_value=facet_value
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

    def territory_in_scope(self, identity: Identity, territory_id: str) -> bool:
        if identity.persona == "Administrator":
            return True
        if identity.persona == "Executive":
            return identity.user_id == self.EXECUTIVE_USER and territory_id.startswith("T01-")
        return territory_id in self._scope_for(identity)

    def activity_summary(
        self,
        identity: Identity,
        *,
        period_from: dt.date | None,
        period_to: dt.date | None,
        territory_id: str | None,
        product: str | None,
        specialty: str | None = None,
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

    # -- Executive double ----------------------------------------------------------------------
    def executive_activity(
        self,
        identity: Identity,
        *,
        metric: str,
        group_by: str,
        period_from: dt.date | None,
        period_to: dt.date | None,
    ) -> ExecutiveActivityResult:
        if identity.persona != "Executive":
            return ExecutiveActivityResult(status="executive_only")
        if metric not in ("calls", "engaged_hcps", "responses") or group_by not in ("total", "month", "region", "territory"):
            return ExecutiveActivityResult(status="bad_request")
        if identity.user_id != self.EXECUTIVE_USER:
            return ExecutiveActivityResult(status="no_scope")
        start, end = period_from or dt.date(2026, 8, 6), period_to or dt.date(2026, 11, 3)
        totals = {"calls": 48, "engaged_hcps": 36, "responses": 84}
        groups = {
            "month": {
                "calls": {"2026-08": 15, "2026-09": 17, "2026-10": 12, "2026-11": 4},
                "engaged_hcps": {"2026-08": 12, "2026-09": 13, "2026-10": 8, "2026-11": 3},
                "responses": {"2026-08": 28, "2026-09": 31, "2026-10": 20, "2026-11": 5},
            },
            "region": {
                "calls": {"REGION-01": 30, "REGION-02": 14, "REGION-03": 4},
                "engaged_hcps": {"REGION-01": 21, "REGION-02": 12, "REGION-03": 3},
                "responses": {"REGION-01": 52, "REGION-02": 27, "REGION-03": 5},
            },
            "territory": {
                "calls": {"T01-01": 31, "T01-02": 13, "T01-03": 4},
                "engaged_hcps": {"T01-01": 22, "T01-02": 11, "T01-03": 3},
                "responses": {"T01-01": 56, "T01-02": 23, "T01-03": 5},
            },
        }
        total = totals[metric]
        if group_by == "total":
            return ExecutiveActivityResult(
                status="ok", metric=metric, group_by=group_by, period_from=start, period_to=end,
                total=ExecutiveCount(total), data_through=self.DATA_THROUGH,
            )
        values = groups[group_by][metric]
        keys = sorted(values)
        hidden, total_hidden = suppress_flags([values[key] for key in keys], total, additive=True)
        labels = {
            "REGION-01": "Region 1", "REGION-02": "Region 2", "REGION-03": "Region 3",
            "T01-01": "T01-01 · North", "T01-02": "T01-02 · South", "T01-03": "T01-03 · West",
        }
        return ExecutiveActivityResult(
            status="ok", metric=metric, group_by=group_by, period_from=start, period_to=end,
            total=ExecutiveCount(None if total_hidden else total, bool(total_hidden)),
            rows=tuple(
                ExecutiveActivityRow(key, labels.get(key, key), ExecutiveCount(None if hidden[i] else values[key], bool(hidden[i])))
                for i, key in enumerate(keys)
            ),
            data_through=self.DATA_THROUGH,
        )

    # One Executive (``executive-region-01``) has data; every other Executive id has no scope. The numbers are
    # hand-written to exercise suppression: ``None`` counts are withheld small groups.
    EXECUTIVE_USER = "executive-region-01"

    @staticmethod
    def _count(value: int | None) -> dict[str, Any]:
        return {"value": value, "suppressed": value is None}

    def _exec_citation(self, key: str, label: str, n: int | None) -> dict[str, Any]:
        return {
            "citationId": f"agg:{key}",
            "kind": "AGGREGATE",
            "dataset": "hcp_raw_insights",
            "label": label,
            "responses": self._count(n),
        }

    def executive_themes(
        self, identity: Identity, *, period_from: dt.date | None, period_to: dt.date | None, facet: str
    ) -> ExecutiveAnalysisResult:
        if identity.persona != "Executive":
            return ExecutiveAnalysisResult(status="executive_only")
        if facet not in EXECUTIVE_FACETS:
            return ExecutiveAnalysisResult(status="bad_request", detail="invalid_facet")
        if identity.user_id != self.EXECUTIVE_USER:
            return ExecutiveAnalysisResult(status="no_scope")
        frm, to = period_from or dt.date(2026, 8, 6), period_to or dt.date(2026, 11, 3)

        def card(topic: str, n: int | None, prior: int | None, hcps: int | None, trend: str) -> dict[str, Any]:
            return {
                "cardId": f"{facet}:Portfolio:{topic}",
                "facetValue": "Portfolio",
                "topic": topic,
                "responses": self._count(n),
                "priorResponses": self._count(prior),
                "distinctHcps": self._count(hcps),
                "share": None if n is None else round(100.0 * n / 700, 1),
                "regionCount": 2,
                "trend": trend,
                "citations": [
                    self._exec_citation(
                        f"themes:{facet}:{topic}:{frm}:{to}", f"Free-text responses on {topic}, {frm} to {to}", n
                    )
                ],
            }

        data = {
            "facet": facet,
            "facetLabel": facet.replace("_", " ").title(),
            "from": frm.isoformat(),
            "to": to.isoformat(),
            "priorFrom": (frm - dt.timedelta(days=90)).isoformat(),
            "priorTo": (frm - dt.timedelta(days=1)).isoformat(),
            "groups": [
                {
                    "facetValue": "Portfolio",
                    "freeTextResponses": self._count(700),
                    "priorFreeTextResponses": self._count(690),
                    "regionCount": 2,
                    "cards": [
                        card("ctDNA monitoring (emerging)", 72, 21, 40, "RISING"),
                        card("Access and reimbursement", 99, 104, 60, "STEADY"),
                        card("Pulmonary surveillance (emerging)", None, 3, None, "WITHHELD"),
                    ],
                }
            ],
            "groupsLeftOut": 0,
            "sampleLimitations": [
                "Themes are keyword groupings of free-text responses, not source facts.",
                "Counts below 5 are withheld so no small group can be identified.",
            ],
            "note": "Derived themes.",
        }
        return ExecutiveAnalysisResult(status="ok", data=data, data_through=self.DATA_THROUGH)

    def executive_topic_matrix(
        self,
        identity: Identity,
        *,
        period_from: dt.date | None,
        period_to: dt.date | None,
        facet: str,
        facet_value: str | None,
    ) -> ExecutiveAnalysisResult:
        if identity.persona != "Executive":
            return ExecutiveAnalysisResult(status="executive_only")
        if facet not in EXECUTIVE_FACETS:
            return ExecutiveAnalysisResult(status="bad_request", detail="invalid_facet")
        if identity.user_id != self.EXECUTIVE_USER:
            return ExecutiveAnalysisResult(status="no_scope")
        frm, to = period_from or dt.date(2026, 8, 6), period_to or dt.date(2026, 11, 3)

        def cell(region: str, n: int | None, prior: int | None, trend: str) -> dict[str, Any]:
            return {
                "regionId": region,
                "responses": self._count(n),
                "priorResponses": self._count(prior),
                "share": None if n is None else round(100.0 * n / 350, 1),
                "priorShare": None if prior is None else round(100.0 * prior / 345, 1),
                "sharePointChange": None,
                "trend": trend,
                "alert": trend == "RISING",
            }

        data = {
            "facet": facet,
            "facetValue": facet_value,
            "from": frm.isoformat(),
            "to": to.isoformat(),
            "priorFrom": (frm - dt.timedelta(days=90)).isoformat(),
            "priorTo": (frm - dt.timedelta(days=1)).isoformat(),
            "thresholds": {
                "minWindowResponses": 30,
                "minTopicResponses": 10,
                "minRelativeIncrease": 0.5,
                "minSharePoints": 2.0,
                "minCell": 5,
                "rule": "A topic is rising when both periods hold at least 30 free-text responses and its share rose clearly.",
                "approved": True,
            },
            "regions": [
                {"regionId": "REGION-01", "regionName": "Region 1", "territoriesInScope": 6,
                 "freeTextResponses": self._count(350), "priorFreeTextResponses": self._count(345), "sampleSufficient": True},
                {"regionId": "REGION-02", "regionName": "Region 2", "territoriesInScope": 6,
                 "freeTextResponses": self._count(350), "priorFreeTextResponses": self._count(345), "sampleSufficient": True},
            ],
            "rows": [
                {
                    "topic": "ctDNA monitoring (emerging)",
                    "isOther": False,
                    "cells": [cell("REGION-01", 40, 10, "RISING"), cell("REGION-02", 32, 11, "RISING")],
                    "regionsRising": 2,
                    "regionsFalling": 0,
                    "crossRegion": True,
                },
                {
                    "topic": "Pulmonary surveillance (emerging)",
                    "isOther": False,
                    "cells": [cell("REGION-01", None, 2, "WITHHELD"), cell("REGION-02", 12, 8, "STEADY")],
                    "regionsRising": 0,
                    "regionsFalling": 0,
                    "crossRegion": False,
                },
            ],
            "sampleLimitations": [
                "A region needs at least 30 free-text responses in both periods before a trend arrow is shown.",
                "Counts below 5 are withheld so no small group can be identified.",
            ],
            "note": "Derived topics.",
        }
        return ExecutiveAnalysisResult(status="ok", data=data, data_through=self.DATA_THROUGH)


def repository_for(database_url: str | None) -> ScopedReadRepository:
    return PostgresScopedRepository(database_url) if database_url else FixtureScopedRepository()
