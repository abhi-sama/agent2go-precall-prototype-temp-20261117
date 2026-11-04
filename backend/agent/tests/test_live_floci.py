"""Opt-in integration coverage for floci -> LiteLLM -> Claude.

Run scripts/run-local.sh, start the runtime on :8080 with the Haiku mapping, then set
RUN_LIVE_FLOCI_TESTS=1.
"""

from __future__ import annotations

import os
from pathlib import Path

import httpx
import pytest

from msl_agent.config import DEFAULT_KEY_PATH, read_anthropic_api_key


@pytest.mark.asyncio
async def test_live_floci_litellm_claude_streams_ag_ui(invocation_payload) -> None:
    if not read_anthropic_api_key(Path(os.getenv("AGENT2GO_KEYS_FILE", DEFAULT_KEY_PATH))):
        pytest.skip("ANTHROPIC_API_KEY is absent or empty; floci stub mode is covered by test_stub_ag_ui")
    if os.getenv("RUN_LIVE_FLOCI_TESTS") != "1":
        pytest.skip("set RUN_LIVE_FLOCI_TESTS=1 after starting the local floci/LiteLLM/runtime stack")

    async with httpx.AsyncClient(base_url=os.getenv("MSL_AGENT_LIVE_URL", "http://localhost:8080")) as client:
        response = await client.post("/invocations", json=invocation_payload, timeout=60)

    assert response.status_code == 200
    assert '"type":"TEXT_MESSAGE_CONTENT"' in response.text
