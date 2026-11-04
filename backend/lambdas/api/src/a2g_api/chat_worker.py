"""Chat worker Lambda: relays one agent run into ``chat_run_events``.

Invoked asynchronously by ``startChatRun`` with the verified caller already resolved. It calls the
agent, and appends each AG-UI event as its own committed row so the frontend can read the answer while
it is still being written. It never raises to the Lambda runtime (an async retry would replay the run):
every failure becomes a final ``RUN_ERROR`` event with fixed text.
"""

from __future__ import annotations

import json
import time
from collections.abc import Mapping
from typing import Any

from a2g_logging import configure, correlation, get_logger

from .agent_client import AgentRuntime, runtime_for
from .db import user_cursor
from .settings import Settings

configure(service="a2g-be-chat")
log = get_logger(__name__)

TERMINAL = {"RUN_FINISHED": "finished", "RUN_ERROR": "failed"}


def _append(settings: Settings, event: Mapping[str, Any], payload: Mapping[str, Any], seq: int) -> None:
    with user_cursor(settings.db_dsn, payload["user_id"], payload["persona"], payload["correlation_id"]) as cur:
        cur.execute(
            "INSERT INTO chat_run_events(run_id, seq, owner_user_id, event) VALUES (%s, %s, app.request_user_id(), %s)",
            (payload["run_id"], seq, json.dumps(event)),
        )
        status = TERMINAL.get(str(event.get("type")))
        if status:
            cur.execute(
                "UPDATE chat_runs SET status = %s, finished_at = now() WHERE run_id = %s", (status, payload["run_id"])
            )


def run_chat(payload: Mapping[str, Any], settings: Settings, runtime: AgentRuntime | None = None) -> str:
    """Stream the agent into Postgres. Returns the terminal status (``finished`` or ``failed``)."""
    started = time.perf_counter()
    seq = 0
    outcome = "failed"
    request = {
        "identity": {
            "user_id": payload["user_id"],
            "persona": payload["persona"],
            "full_name": payload.get("full_name", ""),
            "email": payload.get("email", ""),
            "correlation_id": payload["correlation_id"],
        },
        "thread_id": payload["thread_id"],
        "run_id": payload["run_id"],
        "messages": payload["messages"],
    }
    try:
        for event in (runtime or runtime_for(settings)).invoke(request):
            seq += 1
            _append(settings, event, payload, seq)
            if event.get("type") in TERMINAL:
                outcome = TERMINAL[event["type"]]
                break
        else:
            raise RuntimeError("agent stream ended without a terminal event")
    except Exception as exc:
        log.error("chat run failed", run_id=payload["run_id"], error_type=type(exc).__name__, count=seq)
        _append(
            settings,
            {"type": "RUN_ERROR", "message": "The agent is unavailable. Please try again.", "code": "AGENT_UNAVAILABLE"},
            payload,
            seq + 1,
        )
        seq += 1
    log.info(
        "chat run relayed",
        run_id=payload["run_id"],
        thread_id=payload["thread_id"],
        outcome=outcome,
        count=seq,
        duration_ms=round((time.perf_counter() - started) * 1000),
    )
    return outcome


def handler(event: Mapping[str, Any], context: Any = None) -> dict[str, str]:
    with correlation(str(event.get("correlation_id") or "")):
        try:
            outcome = run_chat(event, Settings.from_env())
        except Exception as exc:
            # Database trouble while writing the error event: nothing more can be reported to the user.
            log.error("chat worker crashed", error_type=type(exc).__name__)
            return {"status": "crashed"}
    return {"status": outcome}
