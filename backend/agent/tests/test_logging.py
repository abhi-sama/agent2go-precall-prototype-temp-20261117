"""Agent logs hold ids, counts and enums only (never tokens, emails, names, questions or HCP text)."""

from __future__ import annotations

import io
import logging

import pytest
from a2g_logging import JsonFormatter
from conftest import make_invocation
from test_runtime import RecordingWriter, ScriptedAgent, collect

from msl_agent.agent import MslAgent


@pytest.mark.asyncio
async def test_a_full_run_logs_nothing_sensitive(settings, repository) -> None:
    sink = io.StringIO()
    handler = logging.StreamHandler(sink)
    handler.setFormatter(JsonFormatter("msl-agent"))
    logging.getLogger().addHandler(handler)
    question = "Tell me about Dr Secretname and secret@hcp.example"
    steps = [
        ("tool", "get_activity_summary", {}),
        ("tool", "search_recorded_responses", {"topic": "osimertinib"}),
        "Done.",
    ]
    agent = MslAgent(
        settings, repository, RecordingWriter(), agent_factory=lambda c, i: ScriptedAgent(c, steps)
    )
    try:
        await collect(agent, make_invocation(question=question))
    finally:
        logging.getLogger().removeHandler(handler)
    logged = sink.getvalue()
    assert "run started" in logged and "run finished" in logged
    for secret in (
        "Secretname",
        "secret@hcp.example",
        "avery@example.test",
        "Avery Clinician",
        "Recorded perspective",
    ):
        assert secret not in logged
