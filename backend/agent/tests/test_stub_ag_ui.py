from __future__ import annotations

import json

import httpx
import pytest

from msl_agent.app import create_app


@pytest.mark.asyncio
async def test_stub_mode_streams_an_ag_ui_answer_with_record_citations(
    stub_settings, invocation_payload
) -> None:
    app = create_app(stub_settings)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        ping = await client.get("/ping")
        response = await client.post("/invocations", json=invocation_payload)

    assert ping.json() == {"status": "ok"}
    assert response.headers["content-type"].startswith("text/event-stream")
    events = [json.loads(line.removeprefix("data: ")) for line in response.text.splitlines() if line]
    assert [event["type"] for event in events] == [
        "RUN_STARTED",
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
        "CUSTOM",
        "RUN_FINISHED",
    ]
    answer = "".join(event["delta"] for event in events if event["type"] == "TEXT_MESSAGE_CONTENT")
    assert "12" in answer
    assert events[-2]["name"] == "record_citations"
    assert events[-2]["value"][0]["record_id"] == "call-west-001"
