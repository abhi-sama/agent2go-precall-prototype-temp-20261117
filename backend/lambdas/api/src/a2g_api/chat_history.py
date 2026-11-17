"""Read a caller's saved chat turns from the FE DynamoDB table.

The agent has a PutItem-only role; this separate, narrow API role can only Query one caller's partition. The browser
still reaches it through AppSync, so no caller-controlled identifier can address another person's history: the
partition key is built here from the verified caller, never from an argument.

Items are keyed ``USER#<user>`` / ``THREAD#<thread>#<time>#<run>``, so DynamoDB orders a person's turns by thread id,
not by time. ``myChatThreads`` therefore reads the caller's turns (only the fields a list needs), groups them by
thread and orders the threads by their newest turn here; ``myChatThread`` reads one thread by its key prefix.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import threading
from collections.abc import Mapping
from typing import Any

from a2g_logging import get_logger

from .errors import BadRequest, Unavailable

log = get_logger(__name__)
MAX_TURNS = 100
"""The newest turns of one conversation that reopen (the agent itself sends only its last few as context)."""
DEFAULT_THREADS, MAX_THREADS = 30, 100
MAX_SCANNED_TURNS = 2000
"""A year's retention of one person's questions stays well inside this; past it the oldest-keyed threads drop out."""
TITLE_LENGTH = 80
_THREAD_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_LIST_PROJECTION = "thread_id, user_message, generated_at, scope_territory_ids"


class DynamoChatHistoryStore:
    def __init__(self, table: str, role_arn: str) -> None:
        self._table, self._role_arn = table, role_arn
        self._cache: tuple[Any, dt.datetime] | None = None
        self._lock = threading.Lock()

    def _client(self) -> Any:
        import boto3

        with self._lock:
            now = dt.datetime.now(dt.UTC)
            if self._cache and self._cache[1] - now > dt.timedelta(minutes=2):
                return self._cache[0]
            credentials = boto3.client("sts").assume_role(
                RoleArn=self._role_arn, RoleSessionName="a2g-be-chat-history", DurationSeconds=900
            )["Credentials"]
            client = boto3.client(
                "dynamodb",
                aws_access_key_id=credentials["AccessKeyId"],
                aws_secret_access_key=credentials["SecretAccessKey"],
                aws_session_token=credentials["SessionToken"],
            )
            self._cache = (client, credentials["Expiration"])
            return client

    def _query(self, user_id: str, prefix: str, *, projection: str | None, forward: bool, limit: int) -> list[dict[str, Any]]:
        """Every item of the caller's partition under ``prefix``, up to ``limit`` items, following DynamoDB's pages."""
        from boto3.dynamodb.types import TypeDeserializer

        decode = TypeDeserializer()
        items: list[dict[str, Any]] = []
        request: dict[str, Any] = {
            "TableName": self._table,
            "KeyConditionExpression": "pk = :pk AND begins_with(sk, :prefix)",
            "ExpressionAttributeValues": {":pk": {"S": f"USER#{user_id}"}, ":prefix": {"S": prefix}},
            "ScanIndexForward": forward,
        }
        if projection:
            request["ProjectionExpression"] = projection
        try:
            client = self._client()
            while len(items) < limit:
                out = client.query(**request, Limit=limit - len(items))
                items.extend({key: decode.deserialize(value) for key, value in item.items()} for item in out.get("Items", []))
                if "LastEvaluatedKey" not in out:
                    return items
                request["ExclusiveStartKey"] = out["LastEvaluatedKey"]
        except Exception as exc:
            log.error("chat history read failed", error_type=type(exc).__name__)
            raise Unavailable("chat_history_read") from exc
        log.warning("chat history read truncated", limit=limit)
        return items

    def list_turns(self, user_id: str) -> list[dict[str, Any]]:
        """The caller's saved turns, only what a conversation list needs. Items are keyed by thread, not by time."""
        return self._query(user_id, "THREAD#", projection=_LIST_PROJECTION, forward=True, limit=MAX_SCANNED_TURNS)

    def thread_turns(self, user_id: str, thread_id: str) -> list[dict[str, Any]]:
        """One of the caller's conversations, newest ``MAX_TURNS`` turns, whole items."""
        newest = self._query(user_id, f"THREAD#{thread_id}#", projection=None, forward=False, limit=MAX_TURNS)
        return newest[::-1]


def _int_arg(args: Mapping[str, Any], name: str, default: int, maximum: int) -> int:
    value = args.get(name, default)
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        raise BadRequest(f"invalid_{name}")
    return value


def _thread_id(args: Mapping[str, Any]) -> str:
    value = args.get("threadId")
    if not isinstance(value, str) or not _THREAD_ID.match(value):
        raise BadRequest("invalid_threadId")
    return value


def _may_read(cur: Any, identity: Any) -> set[str] | None:
    """The territories this request may read from, or ``None`` when saved answers must not be reopened at all.

    DynamoDB has the old answer, but not the RLS session that produced it, so the saved territory scope is re-checked
    against this request's RLS-scoped connection. A saved response can contain an old record citation; it is never
    re-opened for an aggregate-only Executive, even when their territory scope happens to overlap the original answer.
    """
    if getattr(identity, "persona", None) == "executive":
        cur.execute("SELECT app.has_permission('source.records.read')")
        if not bool(cur.fetchone()[0]):
            return None
    cur.execute("SELECT territory_id FROM app.current_scope_territories()")
    return {str(row[0]) for row in cur.fetchall()}


def _in_scope(row: Mapping[str, Any], allowed: set[str]) -> bool:
    saved = row.get("scope_territory_ids")
    # Turns saved before the scope snapshot existed cannot be checked, so they are not reopened.
    return isinstance(saved, list) and all(isinstance(value, str) for value in saved) and set(saved).issubset(allowed)


def _title(question: str) -> str:
    text = " ".join(question.split())
    return text if len(text) <= TITLE_LENGTH else text[: TITLE_LENGTH - 1].rstrip() + "…"


def my_chat_threads(cur: Any, identity: Any, user_id: str, args: Mapping[str, Any], *, store: DynamoChatHistoryStore) -> list[dict[str, Any]]:
    """The caller's conversations, newest first: id, a title from the first question, first and last turn times, turns.

    Only turns still inside the caller's current scope count, so a conversation never lists a question whose answer
    could no longer be reopened.
    """
    limit = _int_arg(args, "limit", DEFAULT_THREADS, MAX_THREADS)
    allowed = _may_read(cur, identity)
    if allowed is None:
        return []
    threads: dict[str, dict[str, Any]] = {}
    for row in store.list_turns(user_id):
        thread_id, question, at = row.get("thread_id"), row.get("user_message"), row.get("generated_at")
        if not (isinstance(thread_id, str) and isinstance(question, str) and isinstance(at, str)) or not _in_scope(row, allowed):
            continue
        thread = threads.setdefault(thread_id, {"threadId": thread_id, "title": _title(question), "startedAt": at, "updatedAt": at, "turnCount": 0})
        thread["turnCount"] += 1
        # ISO-8601 UTC timestamps written by the agent compare correctly as text.
        if at < thread["startedAt"]:
            thread["startedAt"], thread["title"] = at, _title(question)
        thread["updatedAt"] = max(thread["updatedAt"], at)
    return sorted(threads.values(), key=lambda thread: thread["updatedAt"], reverse=True)[:limit]


def my_chat_thread(cur: Any, identity: Any, user_id: str, args: Mapping[str, Any], *, store: DynamoChatHistoryStore) -> list[dict[str, Any]]:
    """One of the caller's conversations as saved turns, oldest first, each re-checked against the current scope."""
    thread_id = _thread_id(args)
    allowed = _may_read(cur, identity)
    if allowed is None:
        return []
    out: list[dict[str, Any]] = []
    for row in store.thread_turns(user_id, thread_id):
        if not all(isinstance(row.get(key), str) for key in ("thread_id", "run_id", "user_message", "assistant_text", "generated_at")):
            continue
        if row["thread_id"] != thread_id or not _in_scope(row, allowed):
            continue
        payload = {
            "facts": row.get("facts", []),
            "citations": row.get("evidence", []),
            "visuals": row.get("visuals", []),
            "surfaces": row.get("surfaces", []),
            "suggestions": row.get("suggestions", []),
            "dataThrough": row.get("data_through"),
            "modelMode": row.get("model_mode"),
            "unverifiedNumbers": row.get("unverified_numbers", []),
            "sampleLimitations": row.get("sample_limitations", []),
        }
        out.append(
            {
                "threadId": row["thread_id"],
                "runId": row["run_id"],
                "userMessage": row["user_message"],
                "assistantText": row["assistant_text"],
                "generatedAt": row["generated_at"],
                "payload": json.dumps(payload, separators=(",", ":"), default=str),
            }
        )
    return out
