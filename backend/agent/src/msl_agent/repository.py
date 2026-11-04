"""RLS-scoped deterministic reads; the fixture uses the same result interface as Postgres."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import psycopg

from .schemas import Citation, Identity


@dataclass(frozen=True)
class DeterministicFact:
    metric: str
    value: int
    citations: tuple[Citation, ...]


class ScopedReadRepository(Protocol):
    def metric_for_question(self, identity: Identity, question: str) -> DeterministicFact: ...


class FixtureScopedRepository:
    """Temporary synthetic fixture until backend/db migrations are available."""

    _scope_metrics = {
        "west": (12, ("call-west-001", "call-west-002")),
        "central": (8, ("call-central-001",)),
        "national": (20, ("call-west-001", "call-central-001", "call-east-001")),
    }

    def metric_for_question(self, identity: Identity, question: str) -> DeterministicFact:
        # This is intentionally deterministic; neither the question nor model can change a count.
        persona_scope = "national" if identity.persona.lower() == "executive" else "west"
        count, record_ids = self._scope_metrics[persona_scope]
        citations = tuple(
            Citation(record_id=record_id, dataset="call_activity", label="Synthetic call activity")
            for record_id in record_ids
        )
        return DeterministicFact(metric="distinct_calls", value=count, citations=citations)


class PostgresScopedRepository:
    """Production adapter. It never executes a query before establishing the RLS session."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    def metric_for_question(self, identity: Identity, question: str) -> DeterministicFact:
        with psycopg.connect(self._database_url) as connection:
            with connection.transaction():
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT app.set_request_identity(%s, %s, %s)",
                        (identity.user_id, identity.persona, identity.correlation_id),
                    )
                    # The db worker will provide this stable read view. The aggregation happens
                    # in SQL and is never delegated to the model.
                    cursor.execute(
                        """
                        SELECT COUNT(DISTINCT call_id)::int, ARRAY_AGG(call_id ORDER BY call_id)
                        FROM agent_scope_call_facts
                        """
                    )
                    count, record_ids = cursor.fetchone()
        citations = tuple(
            Citation(record_id=record_id, dataset="call_activity", label="Call activity")
            for record_id in (record_ids or [])
        )
        return DeterministicFact(metric="distinct_calls", value=count, citations=citations)


def repository_for(database_url: str | None) -> ScopedReadRepository:
    return PostgresScopedRepository(database_url) if database_url else FixtureScopedRepository()
