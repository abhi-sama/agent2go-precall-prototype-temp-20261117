from __future__ import annotations

import pytest

from msl_agent.config import Settings
from msl_agent.repository import FixtureScopedRepository
from msl_agent.schemas import Identity, Invocation


@pytest.fixture
def settings() -> Settings:
    return Settings(
        bedrock_endpoint="http://localhost:4568",
        bedrock_model_id="anthropic.claude-sonnet-5-5-v1:0",
        aws_region="us-east-1",
        database_url=None,
        floci_backend="proxy",
    )


@pytest.fixture
def stub_settings(settings: Settings) -> Settings:
    return Settings(**{**settings.__dict__, "floci_backend": "stub"})


@pytest.fixture
def repository() -> FixtureScopedRepository:
    return FixtureScopedRepository()


def make_invocation(
    user_id: str = "msl-t01-01", persona: str = "MSL", question: str = "How many calls did I make?"
) -> Invocation:
    return Invocation(
        identity=Identity(
            user_id=user_id,
            persona=persona,
            full_name="Avery Clinician",
            email="avery@example.test",
            correlation_id="corr-test-123",
        ),
        thread_id="thread-123",
        run_id="run-123",
        messages=[{"role": "user", "content": question}],
    )


@pytest.fixture
def invocation() -> Invocation:
    return make_invocation()
