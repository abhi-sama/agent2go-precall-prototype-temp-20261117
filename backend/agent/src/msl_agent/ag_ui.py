"""AG-UI events (CopilotKit's agent-user interaction protocol) and their SSE framing.

Only event types this runtime emits are built here. Domain payloads (source facts, citations,
suggestions, the number check) travel as ``CUSTOM`` events so any AG-UI client can ignore them.
"""

from __future__ import annotations

import json
import time
from typing import Any

Event = dict[str, Any]


def _event(kind: str, **fields: Any) -> Event:
    return {"type": kind, "timestamp": int(time.time() * 1000), **fields}


def run_started(thread_id: str, run_id: str) -> Event:
    return _event("RUN_STARTED", threadId=thread_id, runId=run_id)


def run_finished(thread_id: str, run_id: str) -> Event:
    return _event("RUN_FINISHED", threadId=thread_id, runId=run_id)


def run_error(message: str, code: str) -> Event:
    # Fixed text only: an exception message could carry row values or credentials.
    return _event("RUN_ERROR", message=message, code=code)


def text_start(message_id: str) -> Event:
    return _event("TEXT_MESSAGE_START", messageId=message_id, role="assistant")


def text_content(message_id: str, delta: str) -> Event:
    return _event("TEXT_MESSAGE_CONTENT", messageId=message_id, delta=delta)


def text_end(message_id: str) -> Event:
    return _event("TEXT_MESSAGE_END", messageId=message_id)


def tool_call_start(tool_call_id: str, name: str) -> Event:
    return _event("TOOL_CALL_START", toolCallId=tool_call_id, toolCallName=name)


def tool_call_end(tool_call_id: str) -> Event:
    return _event("TOOL_CALL_END", toolCallId=tool_call_id)


def custom(name: str, value: Any) -> Event:
    return _event("CUSTOM", name=name, value=value)


def activity_snapshot(message_id: str, activity_type: str, content: dict[str, Any], *, replace: bool = True) -> Event:
    """AG-UI activity event; A2UI surfaces ride it as ``activityType: a2ui-surface`` (docs/adr/0017)."""
    return _event("ACTIVITY_SNAPSHOT", messageId=message_id, activityType=activity_type, content=content, replace=replace)


def sse(event: Event) -> bytes:
    return f"data: {json.dumps(event, separators=(',', ':'), default=str)}\n\n".encode()
