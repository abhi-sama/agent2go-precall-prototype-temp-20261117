from __future__ import annotations

import io

from msl_agent.logging import JsonFormatter, audit, logger


def test_logs_never_include_key_tokens_identity_or_hcp_free_text() -> None:
    captured = io.StringIO()
    handler = __import__("logging").StreamHandler(captured)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
    try:
        audit(
            "invocation_started",
            correlation_id="corr-safe",
            api_key="sk-ant-secret",
            token="jwt-secret",
            email="avery@example.test",
            full_name="Avery Clinician",
            hcp_free_text="Dr Avery said the adverse event is severe",
        )
    finally:
        logger.removeHandler(handler)

    output = captured.getvalue()
    for secret in (
        "sk-ant-secret",
        "jwt-secret",
        "avery@example.test",
        "Avery Clinician",
        "adverse event",
    ):
        assert secret not in output
    assert '"correlation_id":"corr-safe"' in output
