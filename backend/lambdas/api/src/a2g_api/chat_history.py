"""Read a caller's saved chat turns from the FE DynamoDB table.

The agent has a PutItem-only role; this separate, narrow API role can only Query one caller's partition. The browser
still reaches it through AppSync, so no caller-controlled identifier can address another person's history.
"""

from __future__ import annotations

import datetime as dt
import json
import threading
from collections.abc import Mapping
from typing import Any

from a2g_logging import get_logger

from .errors import BadRequest, Unavailable

log = get_logger(__name__)
MAX_TURNS = 100


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

    def list_for(self, user_id: str, limit: int) -> list[dict[str, Any]]:
        from boto3.dynamodb.types import TypeDeserializer

        try:
            out = self._client().query(
                TableName=self._table,
                KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
                ExpressionAttributeValues={":pk": {"S": f"USER#{user_id}"}, ":prefix": {"S": "THREAD#"}},
                ScanIndexForward=False,
                Limit=limit,
            )
        except Exception as exc:
            log.error("chat history read failed", error_type=type(exc).__name__)
            raise Unavailable("chat_history_read") from exc
        decode = TypeDeserializer()
        return [{key: decode.deserialize(value) for key, value in item.items()} for item in out.get("Items", [])]


def _limit(args: Mapping[str, Any]) -> int:
    value = args.get("limit", 50)
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= MAX_TURNS:
        raise BadRequest("invalid_limit")
    return value


def my_chat_history(cur: Any, identity: Any, user_id: str, args: Mapping[str, Any], *, store: DynamoChatHistoryStore) -> list[dict[str, Any]]:
    """Return bounded, still-authorized stored turns.

    DynamoDB has the old answer, but not the RLS session that produced it. Re-check the saved territory scope
    against this request's RLS-scoped connection before sending a historical answer back to the browser.
    """
    # A saved response can contain an old record citation. Never re-open it for an aggregate-only Executive, even
    # when their territory scope happens to overlap the original answer.
    if getattr(identity, "persona", None) == "executive":
        cur.execute("SELECT app.has_permission('source.records.read')")
        if not bool(cur.fetchone()[0]):
            return []
    cur.execute("SELECT territory_id FROM app.current_scope_territories()")
    allowed_territories = {str(row[0]) for row in cur.fetchall()}
    rows = store.list_for(user_id, _limit(args))
    out: list[dict[str, Any]] = []
    for row in rows:
        if not all(isinstance(row.get(key), str) for key in ("thread_id", "run_id", "user_message", "assistant_text", "generated_at")):
            continue
        saved_territories = row.get("scope_territory_ids")
        if not isinstance(saved_territories, list) or not all(isinstance(value, str) for value in saved_territories):
            continue
        if not set(saved_territories).issubset(allowed_territories):
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
