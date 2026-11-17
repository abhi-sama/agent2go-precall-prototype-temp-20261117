"""Chat fields: start a streamed run, poll its events, open a cited source record.

``startChatRun`` is the entry of the only approved AI path (docs/adr/0001): the FE AppSync mutation
reaches this Lambda, which records the run and starts the chat worker asynchronously, so the mutation
returns at once while the answer streams. The worker relays the agent's AG-UI events into Postgres and
the frontend reads them with ``chatEvents`` (the local stand-in for an AppSync subscription,
docs/adr/0007). Everything here runs under the caller's RLS session; runs are owner-only.
"""

from __future__ import annotations

import datetime as dt
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
MAX_HISTORY = 24
EVENTS_PAGE = 200

Invoker = Callable[[str, dict[str, Any]], None]

_INTENTS = frozenset({"FREE", "TERRITORY_SUMMARY"})
_CONTEXT_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
_CONTEXT_VIEW = re.compile(r"^[a-z0-9-]{1,40}$")
_CONTEXT_KEYS = frozenset({"view", "territoryId", "questionId", "from", "to", "intent"})

#: A2UI user actions the chat accepts (docs/adr/0017). The agent validates the values again against its closed lists.
_ACTIONS = frozenset({"refine_answer"})
_ACTION_KEYS = frozenset({"name", "surfaceId", "sourceComponentId", "timestamp", "context"})
_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
_SURFACE = re.compile(r"^[A-Za-z0-9_-]{1,96}$")
MAX_ACTION_CHARS = 2_000
_WRITE_KINDS = frozenset({"pre_call_brief", "post_call_output", "feedback_flag", "save_preference"})


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


def _clean_context(raw: Any) -> dict[str, str] | None:
    """The screen the chat was opened from. Validated here, and only ever a default for the agent's tools."""
    if raw in (None, ""):
        return None
    if not isinstance(raw, Mapping) or not set(raw) <= _CONTEXT_KEYS:
        raise BadRequest("invalid_context")
    out: dict[str, str] = {}
    for key, pattern, name in (
        ("view", _CONTEXT_VIEW, "view"),
        ("territoryId", _CONTEXT_ID, "territory_id"),
        ("questionId", _CONTEXT_ID, "question_id"),
    ):
        value = raw.get(key)
        if value in (None, ""):
            continue
        if not isinstance(value, str) or not pattern.match(value):
            raise BadRequest("invalid_context")
        out[name] = value
    for key, name in (("from", "from_date"), ("to", "to_date")):
        value = raw.get(key)
        if value in (None, ""):
            continue
        try:
            out[name] = dt.date.fromisoformat(str(value)).isoformat()
        except ValueError as exc:
            raise BadRequest("invalid_context") from exc
    if "from_date" in out and "to_date" in out and out["from_date"] > out["to_date"]:
        raise BadRequest("invalid_context")
    intent = raw.get("intent") or "FREE"
    if intent not in _INTENTS:
        raise BadRequest("invalid_context")
    out["intent"] = str(intent)
    if intent == "TERRITORY_SUMMARY" and "territory_id" not in out:
        raise BadRequest("invalid_context")
    return out


#: The page the chat was opened from (docs/adr/0019): its name, filters and headline figures, as the browser printed them.
_PAGE_KEYS = frozenset({"label", "filters", "figures"})
_PAGE_FILTER_KEYS = frozenset({"from", "to", "territoryId", "molecule", "landscape", "study", "survey", "questionId", "theme"})
_PAGE_FILTER_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
_PAGE_FILTER_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.:()/+-]{0,63}$")
_FIGURE_KEYS = frozenset({"id", "label", "value", "definition"})
MAX_FIGURES = 12


def _text(value: Any, limit: int, *, required: bool = False) -> str | None:
    """Shown text: a trimmed string within ``limit`` characters with no control characters."""
    if value in (None, ""):
        if required:
            raise BadRequest("invalid_page")
        return None
    if not isinstance(value, str):
        raise BadRequest("invalid_page")
    text = value.strip()
    if (required and not text) or len(text) > limit or any(ord(c) < 32 or ord(c) == 127 for c in text):
        raise BadRequest("invalid_page")
    return text or None


def _clean_page(raw: Any) -> dict[str, Any] | None:
    """What the person sees on the page: a name, the filters on it and its headline figures.

    Shown text only. It tells the agent which number a question is about; it is never authority and never a figure
    the agent may repeat. Everything is bounded and pattern-checked here, and the agent checks again.
    """
    if raw in (None, ""):
        return None
    if not isinstance(raw, Mapping) or not set(raw) <= _PAGE_KEYS:
        raise BadRequest("invalid_page")
    out: dict[str, Any] = {}
    label = _text(raw.get("label"), 80)
    if label:
        out["label"] = label
    filters_raw = raw.get("filters")
    if filters_raw not in (None, ""):
        if not isinstance(filters_raw, Mapping) or not set(filters_raw) <= _PAGE_FILTER_KEYS:
            raise BadRequest("invalid_page")
        filters: dict[str, str] = {}
        for key, name, pattern in (
            ("territoryId", "territory_id", _PAGE_FILTER_ID),
            ("questionId", "question_id", _PAGE_FILTER_ID),
            ("molecule", "molecule", _PAGE_FILTER_NAME),
            ("landscape", "landscape", _PAGE_FILTER_NAME),
            ("study", "study", _PAGE_FILTER_NAME),
            ("survey", "survey", _PAGE_FILTER_NAME),
            ("theme", "theme", _PAGE_FILTER_NAME),
        ):
            value = filters_raw.get(key)
            if value in (None, ""):
                continue
            if not isinstance(value, str) or not pattern.match(value):
                raise BadRequest("invalid_page")
            filters[name] = value
        for key, name in (("from", "from_date"), ("to", "to_date")):
            value = filters_raw.get(key)
            if value in (None, ""):
                continue
            try:
                filters[name] = dt.date.fromisoformat(str(value)).isoformat()
            except ValueError as exc:
                raise BadRequest("invalid_page") from exc
        if "from_date" in filters and "to_date" in filters and filters["from_date"] > filters["to_date"]:
            raise BadRequest("invalid_page")
        if filters:
            out["filters"] = filters
    figures_raw = raw.get("figures")
    if figures_raw not in (None, ""):
        if not isinstance(figures_raw, list) or len(figures_raw) > MAX_FIGURES:
            raise BadRequest("invalid_page")
        figures: list[dict[str, str]] = []
        for item in figures_raw:
            if not isinstance(item, Mapping) or not set(item) <= _FIGURE_KEYS:
                raise BadRequest("invalid_page")
            figure_id = item.get("id")
            if not isinstance(figure_id, str) or not _PAGE_FILTER_ID.match(figure_id):
                raise BadRequest("invalid_page")
            figure = {
                "id": figure_id,
                "label": _text(item.get("label"), 80, required=True),
                "value": _text(item.get("value"), 40, required=True),
            }
            definition = _text(item.get("definition"), 160)
            if definition:
                figure["definition"] = definition
            figures.append({k: v for k, v in figure.items() if v is not None})
        if figures:
            out["figures"] = figures
    return out or None


def _action_value(value: Any) -> bool:
    """An action context value: a short string, a list of a few short strings, a boolean or a whole number."""
    if isinstance(value, bool | int) or (isinstance(value, str) and len(value) <= 64):
        return True
    return isinstance(value, list) and len(value) <= 4 and all(isinstance(v, str) and len(v) <= 64 for v in value)


def _clean_action(raw: Any) -> dict[str, Any] | None:
    """A user action on an A2UI surface: shape and size only. It becomes a question; it never widens access."""
    if raw in (None, ""):
        return None
    if not isinstance(raw, Mapping) or not set(raw) <= _ACTION_KEYS:
        raise BadRequest("invalid_action")
    name, surface, source, stamp = raw.get("name"), raw.get("surfaceId"), raw.get("sourceComponentId"), raw.get("timestamp")
    if name not in _ACTIONS or not isinstance(surface, str) or not _SURFACE.match(surface):
        raise BadRequest("invalid_action")
    if not isinstance(source, str) or not _IDENT.match(source) or not isinstance(stamp, str) or len(stamp) > 40:
        raise BadRequest("invalid_action")
    try:
        dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise BadRequest("invalid_action") from exc
    context = raw.get("context") or {}
    if isinstance(context, str):
        # AWSJSON can arrive as its JSON text; it is parsed only within the size bound.
        if len(context) > MAX_ACTION_CHARS:
            raise BadRequest("invalid_action")
        try:
            context = json.loads(context)
        except ValueError as exc:
            raise BadRequest("invalid_action") from exc
    if (
        not isinstance(context, Mapping)
        or len(context) > 12
        or not all(isinstance(k, str) and _IDENT.match(k) and _action_value(v) for k, v in context.items())
        or len(json.dumps(context)) > MAX_ACTION_CHARS
    ):
        raise BadRequest("invalid_action")
    return {"name": name, "surface_id": surface, "source_component_id": source, "timestamp": stamp, "context": dict(context)}


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
    memory: Callable[[str], list[dict[str, str]]] | None = None,
    dismissed: Callable[[str], list[str]] | None = None,
) -> dict[str, Any]:
    thread_id, run_id = _id(args, "threadId"), _id(args, "runId")
    message = args.get("message")
    if not isinstance(message, str) or not message.strip() or len(message) > MAX_MESSAGE_CHARS:
        raise BadRequest("invalid_message")
    history = _clean_history(args.get("history"))
    context = _clean_context(args.get("context"))
    action = _clean_action(args.get("action"))
    page = _clean_page(args.get("page"))
    if context and context["intent"] == "TERRITORY_SUMMARY":
        # Territory summaries are a Director task; the agent would read the same rows either way, but who may
        # ask for one is decided here, in code, not by the prompt.
        cur.execute("SELECT app.has_permission('team.overview.read') OR app.has_permission('admin.manage')")
        if not cur.fetchone()[0]:
            raise Forbidden("summary_requires_team_overview")
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

    suggestion = {}
    if dismissed:
        # Preference suggestions (docs/adr/0023): the agent offers at most one per conversation, so say whether this one
        # already had one (read from the persisted event log under RLS, which only ever shows this person's own runs),
        # and which suggestions this person dismissed, as keys. The agent chooses nothing from the question's owner.
        cur.execute(
            """
            SELECT EXISTS (
              SELECT 1 FROM chat_run_events e JOIN chat_runs r ON r.run_id = e.run_id
              WHERE r.thread_id = %s AND e.event->>'type' = 'CUSTOM' AND e.event->>'name' = 'memory_suggestion'
            )
            """,
            (thread_id,),
        )
        row = cur.fetchone()
        keys = dismissed(user_id)
        suggestion = {**({"memory_offered": True} if row and row[0] is True else {}), **({"memory_dismissed": keys} if keys else {})}

    payload = {
        "user_id": user_id,
        "persona": identity.db_persona,
        "full_name": identity.full_name,
        "email": identity.email,
        "correlation_id": correlation_id,
        "thread_id": thread_id,
        "run_id": run_id,
        "messages": [*history, {"role": "user", "content": message.strip()}],
        **({"context": context} if context else {}),
        **({"a2ui_action": action} if action else {}),
        **({"page": page} if page else {}),
        # What this person asked the agent to remember, read fresh for every question, so a deletion applies to the next
        # one (docs/adr/0022). The loader is keyed by the verified user id; the question names no owner.
        **({"memory": remembered} if memory and (remembered := memory(user_id)) else {}),
        **suggestion,
    }
    try:
        invoker(worker_function, payload)
    except Exception as exc:
        log.error("chat worker start failed", run_id=run_id, error_type=type(exc).__name__)
        cur.execute("UPDATE chat_runs SET status = 'failed', finished_at = now() WHERE run_id = %s", (run_id,))
        raise Unavailable("worker_start") from exc
    log.info("chat run started", run_id=run_id, thread_id=thread_id, outcome="accepted")
    return {"runId": run_id, "status": "RUNNING"}


def _write_approval_event(raw: Any) -> dict[str, Any]:
    """Return the immutable action embedded in a persisted interrupt, never client metadata."""
    if not isinstance(raw, Mapping) or raw.get("type") != "RUN_FINISHED":
        raise BadRequest("invalid_interrupted_run")
    outcome = raw.get("outcome")
    interrupts = outcome.get("interrupts") if isinstance(outcome, Mapping) and outcome.get("type") == "interrupt" else None
    interrupt = interrupts[0] if isinstance(interrupts, list) and len(interrupts) == 1 else None
    metadata = interrupt.get("metadata") if isinstance(interrupt, Mapping) else None
    values = metadata.get("values") if isinstance(metadata, Mapping) else None
    if not isinstance(metadata, Mapping) or interrupt.get("reason") != "approval" or metadata.get("kind") not in _WRITE_KINDS or not isinstance(values, Mapping):
        raise BadRequest("invalid_interrupted_run")
    return {"kind": metadata["kind"], "title": str(metadata.get("title") or "Approved change")[:80], "values": dict(values)}


def _clean_write_values(raw: Any, allowed: Mapping[str, Any]) -> dict[str, str]:
    if raw in (None, ""):
        return {}
    if isinstance(raw, str):
        if len(raw) > MAX_ACTION_CHARS:
            raise BadRequest("invalid_write_values")
        try:
            raw = json.loads(raw)
        except ValueError as exc:
            raise BadRequest("invalid_write_values") from exc
    if not isinstance(raw, Mapping) or len(raw) > len(allowed):
        raise BadRequest("invalid_write_values")
    if not all(key in allowed and isinstance(value, str) and len(value) <= MAX_MESSAGE_CHARS for key, value in raw.items()):
        raise BadRequest("invalid_write_values")
    return dict(raw)


def resume_chat_run(
    cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, worker_function: str | None,
    correlation_id: str, invoker: Invoker = invoke_worker,
) -> dict[str, Any]:
    """Resume exactly one owner-visible interrupt; approval metadata is always read under RLS."""
    thread_id, run_id, interrupted_run_id = _id(args, "threadId"), _id(args, "runId"), _id(args, "interruptedRunId")
    approved = args.get("approved")
    if not isinstance(approved, bool) or not worker_function:
        raise BadRequest("invalid_write_approval") if isinstance(approved, bool) else BadRequest("invalid_approved")
    cur.execute("SELECT thread_id, status FROM chat_runs WHERE run_id = %s", (interrupted_run_id,))
    previous = cur.fetchone()
    if previous is None or previous[0] != thread_id or previous[1] != "interrupted":
        raise NotFound("unknown_interrupted_run")
    cur.execute("SELECT event FROM chat_run_events WHERE run_id = %s ORDER BY seq DESC LIMIT 1", (interrupted_run_id,))
    event = cur.fetchone()
    metadata = _write_approval_event(event[0] if event else None)
    values = _clean_write_values(args.get("values"), metadata["values"])
    cur.execute("INSERT INTO chat_runs(run_id, owner_user_id, thread_id, resumes_run_id) VALUES (%s, app.request_user_id(), %s, %s) ON CONFLICT DO NOTHING RETURNING run_id", (run_id, thread_id, interrupted_run_id))
    if cur.fetchone() is None:
        raise BadRequest("run_id_taken")
    payload = {
        "user_id": user_id, "persona": identity.db_persona, "full_name": identity.full_name, "email": identity.email,
        "correlation_id": correlation_id, "thread_id": thread_id, "run_id": run_id,
        "messages": [{"role": "user", "content": "Complete the approved change."}],
        "write_approval": {"interrupted_run_id": interrupted_run_id, "approved": approved, "metadata": metadata, "values": values},
    }
    try:
        invoker(worker_function, payload)
    except Exception as exc:
        cur.execute("UPDATE chat_runs SET status = 'failed', finished_at = now() WHERE run_id = %s", (run_id,))
        raise Unavailable("worker_start") from exc
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
    if args.get("auditExport") is True:
        # Exporting is a narrower grant than reading: refuse before anything is read or recorded.
        cur.execute("SELECT app.has_permission('admin.manage') OR app.has_permission('chat.rows.export')")
        if not cur.fetchone()[0]:
            raise Forbidden("export_not_permitted")
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
