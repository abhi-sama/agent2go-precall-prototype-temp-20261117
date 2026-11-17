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
    return _event("RUN_FINISHED", threadId=thread_id, runId=run_id, outcome={"type": "success"})


def run_interrupted(thread_id: str, run_id: str, interrupt: dict[str, Any]) -> Event:
    """Finish a run at an approval boundary.

    The interrupt is part of the persisted AG-UI event log.  The browser can render it, but it
    cannot manufacture a write: the resume mutation reads this exact event again under RLS.
    """
    return _event("RUN_FINISHED", threadId=thread_id, runId=run_id, outcome={"type": "interrupt", "interrupts": [interrupt]})


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


def tool_call_args(tool_call_id: str, args: dict[str, Any]) -> Event:
    """One complete, bounded argument object for a browser-side tool."""
    return _event("TOOL_CALL_ARGS", toolCallId=tool_call_id, delta=json.dumps(args, separators=(",", ":")))


def tool_call_end(tool_call_id: str) -> Event:
    return _event("TOOL_CALL_END", toolCallId=tool_call_id)


def tool_call_result(tool_call_id: str, outcome: str = "complete") -> Event:
    """AG-UI's result for a finished tool call. It says only that the call ended: the tool's output (rows and figures)
    stays on the server and reaches the interface as the ``CUSTOM`` evidence events (docs/adr/0018)."""
    return _event("TOOL_CALL_RESULT", messageId=f"tool-result-{tool_call_id}", toolCallId=tool_call_id, content=outcome, role="tool")


def custom(name: str, value: Any) -> Event:
    return _event("CUSTOM", name=name, value=value)


def state_snapshot(snapshot: dict[str, Any]) -> Event:
    """AG-UI shared state. This runtime owns only ``progress`` and ``proposal`` (docs/adr/0019); the page owns the rest."""
    return _event("STATE_SNAPSHOT", snapshot=snapshot)


def activity_snapshot(message_id: str, activity_type: str, content: dict[str, Any], *, replace: bool = True) -> Event:
    """AG-UI activity event; A2UI surfaces ride it as ``activityType: a2ui-surface`` (docs/adr/0017)."""
    return _event("ACTIVITY_SNAPSHOT", messageId=message_id, activityType=activity_type, content=content, replace=replace)


def sse(event: Event) -> bytes:
    return f"data: {json.dumps(event, separators=(',', ':'), default=str)}\n\n".encode()
