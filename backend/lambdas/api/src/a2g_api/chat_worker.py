"""Chat worker Lambda: relays one agent run into ``chat_run_events``.

Invoked asynchronously by ``startChatRun`` with the verified caller already resolved. It calls the
agent, and appends each AG-UI event as its own committed row so the frontend can read the answer while
it is still being written. It never raises to the Lambda runtime (an async retry would replay the run):
every failure becomes a final ``RUN_ERROR`` event with fixed text.
"""

from __future__ import annotations

import json
import time
import urllib.request
from collections.abc import Mapping
from typing import Any

from a2g_logging import configure, correlation, get_logger

from .agent_client import AgentRuntime, runtime_for
from .db import user_cursor
from .settings import Settings

configure(service="a2g-be-chat")
log = get_logger(__name__)

TERMINAL = {"RUN_FINISHED": "finished", "RUN_ERROR": "failed"}
_PUBLISH_MUTATION = """mutation PublishChatEvent($input: PublishChatEventInput!) {
  publishChatEvent(input: $input) { runId seq data }
}"""


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


def _publish_live_event(settings: Settings, event: Mapping[str, Any], payload: Mapping[str, Any], seq: int) -> None:
    """Publish the already-persisted event to the AWS-only AppSync subscription.

    floci has no subscriptions, so this intentionally does nothing without the deployed endpoint.
    The worker's IAM policy permits exactly this mutation field; no event body is logged.
    """
    if not settings.fe_appsync_url:
        return
    import boto3
    from botocore.auth import SigV4Auth
    from botocore.awsrequest import AWSRequest

    body = json.dumps(
        {
            "query": _PUBLISH_MUTATION,
            "variables": {
                "input": {"runId": payload["run_id"], "seq": seq, "data": json.dumps(event)},
            },
        }
    ).encode()
    request = AWSRequest(
        method="POST",
        url=settings.fe_appsync_url,
        data=body,
        headers={"content-type": "application/json"},
    )
    credentials = boto3.Session().get_credentials()
    if credentials is None:
        raise RuntimeError("missing_aws_credentials")
    SigV4Auth(credentials.get_frozen_credentials(), "appsync", boto3.Session().region_name or "us-east-1").add_auth(request)
    with urllib.request.urlopen(urllib.request.Request(  # noqa: S310 - configured internal AppSync endpoint
        settings.fe_appsync_url, data=body, headers=dict(request.headers.items()), method="POST"
    ), timeout=5) as response:
        if response.status != 200:
            raise RuntimeError("appsync_publish_failed")


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
        **({"context": payload["context"]} if payload.get("context") else {}),
        **({"a2ui_action": payload["a2ui_action"]} if payload.get("a2ui_action") else {}),
        **({"page": payload["page"]} if payload.get("page") else {}),
    }
    try:
        for event in (runtime or runtime_for(settings)).invoke(request):
            seq += 1
            _append(settings, event, payload, seq)
            try:
                _publish_live_event(settings, event, payload, seq)
            except Exception as exc:
                # Polling remains authoritative; a live-delivery miss must not replay or lose the run.
                log.error("live chat publish failed", run_id=payload["run_id"], error_type=type(exc).__name__)
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
        try:
            _publish_live_event(settings, {"type": "RUN_ERROR", "message": "The agent is unavailable.", "code": "AGENT_UNAVAILABLE"}, payload, seq)
        except Exception as publish_exc:
            log.error("live chat publish failed", run_id=payload["run_id"], error_type=type(publish_exc).__name__)
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
