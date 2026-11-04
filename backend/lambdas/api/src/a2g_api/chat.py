"""Chat fields: start a streamed run, poll its events, open a cited source record.

``startChatRun`` is the entry of the only approved AI path (docs/adr/0001): the FE AppSync mutation
reaches this Lambda, which records the run and starts the chat worker asynchronously, so the mutation
returns at once while the answer streams. The worker relays the agent's AG-UI events into Postgres and
the frontend reads them with ``chatEvents`` (the local stand-in for an AppSync subscription,
docs/adr/0007). Everything here runs under the caller's RLS session; runs are owner-only.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping
from typing import Any

import psycopg

from a2g_logging import get_logger

from .errors import BadRequest, Forbidden, NotFound, Unavailable
from .identity import Identity

log = get_logger(__name__)

_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
MAX_MESSAGE_CHARS = 2_000
MAX_HISTORY = 8
EVENTS_PAGE = 200

Invoker = Callable[[str, dict[str, Any]], None]


def _id(args: Mapping[str, Any], name: str) -> str:
    value = args.get(name)
    if not isinstance(value, str) or not _ID.match(value):
        raise BadRequest(f"invalid_{name}")
    return value


def _clean_history(raw: Any) -> list[dict[str, str]]:
    if raw in (None, ""):
        return []
    if not isinstance(raw, list):
        raise BadRequest("invalid_history")
    out: list[dict[str, str]] = []
    for item in raw[-MAX_HISTORY:]:
        role = item.get("role") if isinstance(item, Mapping) else None
        content = item.get("content") if isinstance(item, Mapping) else None
        if role not in ("user", "assistant") or not isinstance(content, str) or not content.strip():
            raise BadRequest("invalid_history")
        out.append({"role": role, "content": content.strip()[:MAX_MESSAGE_CHARS]})
    return out


def invoke_worker(function_name: str, payload: dict[str, Any]) -> None:
    """Start the chat worker asynchronously (``InvocationType=Event``)."""
    import boto3

    boto3.client("lambda").invoke(
        FunctionName=function_name, InvocationType="Event", Payload=json.dumps(payload).encode()
    )


def start_chat_run(
    cur: psycopg.Cursor,
    identity: Identity,
    user_id: str,
    args: Mapping[str, Any],
    *,
    worker_function: str | None,
    correlation_id: str,
    invoker: Invoker = invoke_worker,
) -> dict[str, Any]:
    thread_id, run_id = _id(args, "threadId"), _id(args, "runId")
    message = args.get("message")
    if not isinstance(message, str) or not message.strip() or len(message) > MAX_MESSAGE_CHARS:
        raise BadRequest("invalid_message")
    history = _clean_history(args.get("history"))
    if not worker_function:
        raise Unavailable("chat_not_configured")

    cur.execute(
        """
        INSERT INTO chat_runs(run_id, owner_user_id, thread_id) VALUES (%s, app.request_user_id(), %s)
        ON CONFLICT (run_id) DO NOTHING RETURNING run_id
        """,
        (run_id, thread_id),
    )
    if cur.fetchone() is None:
        # Run ids are caller-chosen so the client can poll straight away; reuse is refused.
        raise BadRequest("run_id_taken")

    payload = {
        "user_id": user_id,
        "persona": identity.db_persona,
        "full_name": identity.full_name,
        "email": identity.email,
        "correlation_id": correlation_id,
        "thread_id": thread_id,
        "run_id": run_id,
        "messages": [*history, {"role": "user", "content": message.strip()}],
    }
    try:
        invoker(worker_function, payload)
    except Exception as exc:
        log.error("chat worker start failed", run_id=run_id, error_type=type(exc).__name__)
        cur.execute("UPDATE chat_runs SET status = 'failed', finished_at = now() WHERE run_id = %s", (run_id,))
        raise Unavailable("worker_start") from exc
    log.info("chat run started", run_id=run_id, thread_id=thread_id, outcome="accepted")
    return {"runId": run_id, "status": "RUNNING"}


def chat_events(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    run_id = _id(args, "runId")
    after = args.get("after") or 0
    if not isinstance(after, int) or after < 0:
        raise BadRequest("invalid_after")
    # RLS makes another user's run indistinguishable from one that does not exist.
    cur.execute("SELECT status FROM chat_runs WHERE run_id = %s", (run_id,))
    row = cur.fetchone()
    if row is None:
        raise NotFound("unknown_run")
    status = row[0]
    cur.execute(
        "SELECT seq, event::text FROM chat_run_events WHERE run_id = %s AND seq > %s ORDER BY seq LIMIT %s",
        (run_id, after, EVENTS_PAGE),
    )
    events = [{"seq": seq, "data": data} for seq, data in cur.fetchall()]
    done = False
    if status != "running" and len(events) < EVENTS_PAGE:
        # The worker flips the status after its last event, so a terminal status with a short page is the end.
        done = True
    return {"events": events, "done": done, "status": status.upper()}


_RECORD_DATASETS = ("call_activity", "hcp_raw_insights")


def _require_record_access(cur: psycopg.Cursor) -> None:
    cur.execute("SELECT app.has_permission('admin.manage') OR app.has_permission('source.records.read')")
    if not cur.fetchone()[0]:
        raise Forbidden("aggregate_only")


def chat_citation(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    """Open one cited source record. Only rows RLS lets the caller read can come back."""
    dataset, record_id = args.get("dataset"), args.get("recordId")
    if dataset not in _RECORD_DATASETS or not isinstance(record_id, str) or not 1 <= len(record_id) <= 64:
        raise BadRequest("invalid_citation")
    _require_record_access(cur)
    if dataset == "call_activity":
        cur.execute(
            """
            SELECT min(call_dt), min(call_type), min(call_chnl), max(call_dur), min(territory_id),
                   min(cust_mdm_id), array_agg(DISTINCT prd_nm ORDER BY prd_nm) FILTER (WHERE prd_nm IS NOT NULL),
                   max(sys_inserted_datetime)
            FROM call_activity WHERE crm_call_id = %s HAVING count(*) > 0
            """,
            (record_id,),
        )
        row = cur.fetchone()
        if row is None:
            raise NotFound("unknown_record")
        day, call_type, channel, duration, territory, hcp, products, loaded = row
        fields = [
            ("Call date", day.isoformat() if day else None),
            ("Type", call_type),
            ("Channel", channel),
            ("Duration (minutes)", duration),
            ("Territory", territory),
            ("HCP id", hcp),
            ("Products discussed", ", ".join(products) if products else None),
        ]
        title = "Call activity"
    else:
        cur.execute(
            """
            SELECT date_of_interaction, territory_id, molecule_type, landscape_type, study_name, survey_type,
                   qstn_txt, rspns_txt, sys_inserted_datetime
            FROM hcp_raw_insights WHERE uniq_rspns_id = %s
            ORDER BY date_of_interaction DESC LIMIT 1
            """,
            (record_id,),
        )
        row = cur.fetchone()
        if row is None:
            raise NotFound("unknown_record")
        day, territory, molecule, landscape, study, survey, question, response, loaded = row
        fields = [
            ("Interaction date", day.isoformat() if day else None),
            ("Territory", territory),
            ("Molecule", molecule),
            ("Landscape", landscape),
            ("Study", study),
            ("Survey", survey),
            ("Question", question),
            ("Recorded response", response),
        ]
        title = "Recorded HCP response"
    result = {
        "dataset": dataset,
        "recordId": record_id,
        "title": title,
        "fields": [{"label": label, "value": str(value)} for label, value in fields if value not in (None, "")],
        "dataThrough": loaded.isoformat() if loaded else None,
    }
    # Export is deliberately a separate, explicit request from the client. It reuses the same
    # RLS-scoped lookup above and records only ids/enums, never source text.
    if args.get("auditExport") is True:
        cur.execute(
            "INSERT INTO audit_events(actor_user_id, action, resource_type, resource_id, outcome, correlation_id) VALUES (%s, %s, %s, %s, %s, current_setting('app.correlation_id', true))",
            (user_id, "chat_rows.exported", dataset, record_id, "allowed"),
        )
    return result
