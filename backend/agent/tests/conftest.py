from __future__ import annotations

import pytest

from msl_agent.config import Settings


@pytest.fixture
def stub_settings() -> Settings:
    return Settings(
        bedrock_endpoint="http://localhost:4568",
        bedrock_model_id="anthropic.claude-sonnet-5-5-v1:0",
        aws_region="us-east-1",
        database_url=None,
        floci_backend="stub",
        use_stub_model=True,
    )


@pytest.fixture
def invocation_payload() -> dict[str, object]:
    return {
        "identity": {
            "user_id": "user-msl-west-01",
            "persona": "MSL",
            "full_name": "Avery Clinician",
            "email": "avery@example.test",
            "correlation_id": "corr-test-123",
        },
        "thread_id": "thread-123",
        "messages": [{"role": "user", "content": "How many calls did I make?"}],
    }
