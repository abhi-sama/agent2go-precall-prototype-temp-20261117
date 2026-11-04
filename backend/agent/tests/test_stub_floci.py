"""With no API key the system falls back to floci's Bedrock stub and still answers.

Starts a throwaway floci with its default (stub) Bedrock backend and runs the real Strands agent
against it through ConverseStream. Skipped when Docker is unavailable. Only Bedrock is used, so this
needs no AppSync, LiteLLM or key.
"""

from __future__ import annotations

import json
import shutil
import socket
import subprocess
import time
import urllib.request
import uuid

import httpx
import pytest
from conftest import make_invocation

from msl_agent.app import create_app
from msl_agent.config import Settings
from msl_agent.repository import FixtureScopedRepository

pytestmark = pytest.mark.skipif(
    shutil.which("docker") is None, reason="docker is required for the floci stub test"
)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def floci_stub():
    port, name = _free_port(), f"floci-stub-test-{uuid.uuid4().hex[:8]}"
    subprocess.run(
        ["docker", "run", "-d", "--rm", "--name", name, "-p", f"127.0.0.1:{port}:4566", "floci/floci:2.4.0"],
        check=True,
        capture_output=True,
    )
    try:
        deadline = time.time() + 60
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/_floci/health", timeout=2):
                    break
            except OSError:
                time.sleep(1)
        else:
            pytest.fail("floci did not start")
        yield f"http://127.0.0.1:{port}"
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)


@pytest.mark.asyncio
async def test_empty_key_falls_back_to_the_floci_stub_without_failing(floci_stub, monkeypatch) -> None:
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "222222222222")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    settings = Settings(
        bedrock_endpoint=floci_stub,
        bedrock_model_id="anthropic.claude-haiku-5-5-v1:0",
        aws_region="us-east-1",
        database_url=None,
        floci_backend="stub",
    )
    app = create_app(settings, repository=FixtureScopedRepository())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test", timeout=60
    ) as client:
        resp = await client.post("/invocations", json=make_invocation().model_dump())
    events = [
        json.loads(line.removeprefix("data: "))
        for line in resp.text.splitlines()
        if line.startswith("data: ")
    ]
    types = [e["type"] for e in events]
    assert types[0] == "RUN_STARTED" and types[-1] == "RUN_FINISHED" and "RUN_ERROR" not in types
    text = "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")
    assert text.startswith("Floci stub response")
    assert next(e for e in events if e.get("name") == "model_mode")["value"] == {"mode": "stub"}
    facts = next(e for e in events if e.get("name") == "source_facts")["value"]["facts"]
    assert facts[0]["value"] == 2, "deterministic facts are still computed and shown"
