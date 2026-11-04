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

from .schemas import Citation, Identity

MAX_RANGE_DAYS = 366 * 3
DEFAULT_WINDOW_DAYS = 90
MAX_EXAMPLES = 5
SNIPPET_CHARS = 240

_TERRITORY = re.compile(r"^[A-Za-z0-9_-]{1,40}$")

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


class ScopedReadRepository(Protocol):
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
        period_from: dt.date | None, period_to: dt.date | None, data_through: dt.datetime | None
    ) -> tuple[dt.date, dt.date] | None:
        end = period_to or (data_through.date() if data_through else dt.date.today())
        start = period_from or end - dt.timedelta(days=DEFAULT_WINDOW_DAYS - 1)
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

    def scope(self, identity: Identity) -> ScopeResult:
        if identity.persona == "Executive":
            return ScopeResult(status="aggregate_only")
        ids = self._scope_for(identity)
        if not ids:
            return ScopeResult(status="no_scope")
        return ScopeResult(
            status="ok", territory_ids=ids, territory_count=len(ids), data_through=self.DATA_THROUGH
        )


def repository_for(database_url: str | None) -> ScopedReadRepository:
    return PostgresScopedRepository(database_url) if database_url else FixtureScopedRepository()
