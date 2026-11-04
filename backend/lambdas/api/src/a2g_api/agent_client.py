"""Calls the agent over the AgentCore Runtime HTTP contract and yields its AG-UI events.

``POST /invocations`` with ``{identity, thread_id, run_id, messages[]}`` returns a server-sent-event
stream. Locally the agent is a container reachable over plain HTTP; in AWS the same payload goes to
``bedrock-agentcore`` ``InvokeAgentRuntime`` (floci's AgentCore is a stub, so that adapter is only
unit-tested here and gets its end-to-end run with the AWS infrastructure in ticket #24).
"""

from __future__ import annotations

import json
import urllib.request
from collections.abc import Iterable, Iterator
from typing import Any, Protocol

from .errors import Unavailable
from .settings import Settings

#: A single AG-UI event larger than this is dropped rather than stored (defence against a runaway agent).
MAX_EVENT_BYTES = 64 * 1024
READ_TIMEOUT_SECONDS = 120


class AgentRuntime(Protocol):
    def invoke(self, payload: dict[str, Any], *, timeout: float | None = None) -> Iterator[dict[str, Any]]: ...


def parse_sse(lines: Iterable[bytes]) -> Iterator[dict[str, Any]]:
    for raw in lines:
        line = raw.strip()
        if not line.startswith(b"data:"):
            continue
        body = line[5:].strip()
        if not body or len(body) > MAX_EVENT_BYTES:
            continue
        try:
            event = json.loads(body)
        except ValueError:
            continue
        if isinstance(event, dict) and isinstance(event.get("type"), str):
            yield event


class HttpAgentRuntime:
    def __init__(self, base_url: str) -> None:
        self._url = f"{base_url}/invocations"

    def invoke(self, payload: dict[str, Any], *, timeout: float | None = None) -> Iterator[dict[str, Any]]:
        request = urllib.request.Request(  # noqa: S310 - fixed, configured agent address
            self._url,
            data=json.dumps(payload).encode(),
            headers={"content-type": "application/json", "accept": "text/event-stream"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=timeout or READ_TIMEOUT_SECONDS) as response:  # noqa: S310
            yield from parse_sse(response)


class AgentCoreRuntime:
    """AWS path: Bedrock AgentCore Runtime. Not reachable from floci; see the module docstring."""

    def __init__(self, runtime_arn: str, client: Any | None = None) -> None:
        self._arn = runtime_arn
        self._client = client

    def invoke(self, payload: dict[str, Any], *, timeout: float | None = None) -> Iterator[dict[str, Any]]:
        client = self._client
        if client is None:
            import boto3  # present in the Lambda runtime

            client = boto3.client("bedrock-agentcore")
        response = client.invoke_agent_runtime(
            agentRuntimeArn=self._arn,
            # One session per conversation thread keeps the runtime's microVM warm across turns.
            runtimeSessionId=_session_id(payload["thread_id"]),
            payload=json.dumps(payload).encode(),
            contentType="application/json",
            accept="text/event-stream",
        )
        yield from parse_sse(response["response"].iter_lines())


def _session_id(thread_id: str) -> str:
    # AgentCore requires a session id of at least 33 characters.
    return (f"a2g-thread-{thread_id}" + "-" * 33)[:64] if len(thread_id) < 22 else f"a2g-thread-{thread_id}"[:64]


def runtime_for(settings: Settings) -> AgentRuntime:
    if settings.agent_url:
        return HttpAgentRuntime(settings.agent_url)
    if settings.agent_runtime_arn:
        return AgentCoreRuntime(settings.agent_runtime_arn)
    raise Unavailable("agent_not_configured")
