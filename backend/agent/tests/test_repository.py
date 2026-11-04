from __future__ import annotations

from msl_agent.repository import FixtureScopedRepository
from msl_agent.schemas import Identity


def test_fixture_never_exposes_a_different_persona_scope() -> None:
    repository = FixtureScopedRepository()
    identity = Identity(
        user_id="user-msl-west-01",
        persona="MSL",
        full_name="Avery Clinician",
        email="avery@example.test",
        correlation_id="corr-rls",
    )

    fact = repository.metric_for_question(identity, "Show me national performance")

    assert fact.value == 12
    assert {citation.record_id for citation in fact.citations} == {"call-west-001", "call-west-002"}
