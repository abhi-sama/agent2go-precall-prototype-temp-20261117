"""Flag an incorrect summary, identifier or territory assignment, and track its review.

Flags are operational state, so they live in FE DynamoDB (docs/adr/0006). This Lambda is the
only writer: it verifies the caller, checks that the flagged record is one the caller may
see (RLS), then writes through a narrow role in the FE account. Items are keyed to the
verified user, and the only read is a query on that user's own partition.

The free-text note is the user's own words and may describe an HCP, so it is stored and
returned but never logged.
"""

from __future__ import annotations

import datetime as dt
import re
import threading
import uuid
from collections.abc import Mapping
from typing import Any, Protocol

import psycopg

from a2g_logging import get_logger

from .errors import BadRequest, Unavailable
from .identity import Identity
from .resolvers import _data_through, _scope

log = get_logger(__name__)

KINDS = ("SUMMARY", "IDENTIFIER", "TERRITORY_ASSIGNMENT")
TARGET_TYPES = ("SUMMARY", "CALL", "HCP", "TERRITORY")
#: Which kinds of target each flag kind may point at.
ALLOWED_TARGETS = {
    "SUMMARY": ("SUMMARY",),
    "IDENTIFIER": ("HCP", "CALL"),
    "TERRITORY_ASSIGNMENT": ("CALL", "HCP", "TERRITORY"),
}
STATUSES = ("OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED")
ACTIVE = ("OPEN", "IN_REVIEW")
MAX_NOTE = 500
MAX_LISTED = 100
MAX_ACTIVE_PER_USER = 200
_TARGET_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9:_.\-]{0,127}$")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class FlagStore(Protocol):
    def list_for(self, user_id: str) -> list[dict[str, Any]]: ...

    def put(self, item: dict[str, Any]) -> None: ...


class DynamoFlagStore:
    """FE DynamoDB access through a narrow cross-account role (assumed, then cached)."""

    def __init__(self, table: str, role_arn: str) -> None:
        self._table = table
        self._role_arn = role_arn
        self._client_cache: tuple[Any, dt.datetime] | None = None
        self._lock = threading.Lock()

    def _client(self) -> Any:
        import boto3  # supplied by the Lambda runtime; imported lazily so unit tests need no AWS

        with self._lock:
            now = dt.datetime.now(dt.UTC)
            if self._client_cache and self._client_cache[1] - now > dt.timedelta(minutes=2):
                return self._client_cache[0]
            creds = boto3.client("sts").assume_role(
                RoleArn=self._role_arn, RoleSessionName="a2g-be-flags", DurationSeconds=900
            )["Credentials"]
            client = boto3.client(
                "dynamodb",
                aws_access_key_id=creds["AccessKeyId"],
                aws_secret_access_key=creds["SecretAccessKey"],
                aws_session_token=creds["SessionToken"],
            )
            self._client_cache = (client, creds["Expiration"])
            return client

    def list_for(self, user_id: str) -> list[dict[str, Any]]:
        from boto3.dynamodb.types import TypeDeserializer

        try:
            out = self._client().query(
                TableName=self._table,
                KeyConditionExpression="pk = :pk",
                ExpressionAttributeValues={":pk": {"S": f"USER#{user_id}"}},
                ScanIndexForward=False,
                Limit=MAX_LISTED + MAX_ACTIVE_PER_USER,
            )
        except Exception as exc:
            log.error("flag store read failed", error_type=type(exc).__name__)
            raise Unavailable("flags_read") from exc
        de = TypeDeserializer()
        return [{k: de.deserialize(v) for k, v in item.items()} for item in out.get("Items", [])]

    def put(self, item: dict[str, Any]) -> None:
        from boto3.dynamodb.types import TypeSerializer

        ser = TypeSerializer()
        try:
            self._client().put_item(
                TableName=self._table,
                Item={k: ser.serialize(v) for k, v in item.items() if v is not None},
                ConditionExpression="attribute_not_exists(pk)",
            )
        except Exception as exc:
            log.error("flag store write failed", error_type=type(exc).__name__)
            raise Unavailable("flags_write") from exc


def _to_flag(item: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "flagId": item["flagId"],
        "kind": item["kind"],
        "targetType": item["targetType"],
        "targetId": item["targetId"],
        "note": item.get("note"),
        "status": item["status"],
        "createdAt": item["createdAt"],
        "updatedAt": item["updatedAt"],
        "scopeLabel": item.get("scopeLabel"),
        "dataThrough": item.get("dataThrough"),
    }


def _clean_note(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise BadRequest("invalid_note")
    note = _CONTROL.sub("", value).strip()
    if len(note) > MAX_NOTE:
        raise BadRequest("note_too_long")
    return note or None


def _target_visible(cur: psycopg.Cursor, target_type: str, target_id: str) -> bool:
    """True when the caller's RLS-scoped view contains the target. Absent and hidden look alike."""
    if target_type == "CALL":
        cur.execute("SELECT 1 FROM call_activity WHERE crm_call_id = %s LIMIT 1", (target_id,))
    elif target_type == "HCP":
        cur.execute(
            """
            SELECT 1 FROM call_activity WHERE cust_mdm_id = %(id)s
            UNION ALL SELECT 1 FROM hcp_raw_insights WHERE cust_mdm_id = %(id)s LIMIT 1
            """,
            {"id": target_id},
        )
    elif target_type == "TERRITORY":
        cur.execute(
            """
            SELECT 1 FROM app.current_scope_territories() WHERE territory_id = %(id)s
            UNION ALL
            SELECT 1 WHERE app.has_permission('admin.manage')
              AND EXISTS (SELECT 1 FROM call_activity WHERE territory_id = %(id)s)
            LIMIT 1
            """,
            {"id": target_id},
        )
    else:
        return True  # summaries are saved AI outputs held in FE DynamoDB, not BE rows
    return cur.fetchone() is not None


def flag_issue(
    cur: psycopg.Cursor,
    identity: Identity,
    user_id: str,
    args: Mapping[str, Any],
    *,
    store: FlagStore,
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    payload = args.get("input")
    if not isinstance(payload, Mapping):
        raise BadRequest("invalid_input")
    kind = payload.get("kind")
    target_type = payload.get("targetType")
    target_id = payload.get("targetId")
    if kind not in KINDS or target_type not in ALLOWED_TARGETS.get(kind, ()):
        raise BadRequest("invalid_kind_or_target_type")
    if not isinstance(target_id, str) or not _TARGET_ID.match(target_id):
        raise BadRequest("invalid_target_id")
    note = _clean_note(payload.get("note"))

    if not _target_visible(cur, target_type, target_id):
        raise BadRequest("target_not_visible")

    existing = store.list_for(user_id)
    active = [i for i in existing if i.get("status") in ACTIVE]
    for item in active:
        if (item["kind"], item["targetType"], item["targetId"]) == (kind, target_type, target_id):
            log.info("flag already open", user_id=user_id, flag_id=item["flagId"], flag_kind=kind)
            return _to_flag(item)
    if len(active) >= MAX_ACTIVE_PER_USER:
        raise BadRequest("too_many_open_flags")

    _assigned, _effective, label = _scope(cur, identity)
    through = _data_through(cur)
    stamp = (now or dt.datetime.now(dt.UTC)).astimezone(dt.UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    flag_id = str(uuid.uuid4())
    item = {
        "pk": f"USER#{user_id}",
        "sk": f"FLAG#{stamp}#{flag_id}",
        "flagId": flag_id,
        "userId": user_id,
        "kind": kind,
        "targetType": target_type,
        "targetId": target_id,
        "note": note,
        "status": "OPEN",
        "createdAt": stamp,
        "updatedAt": stamp,
        "scopeLabel": label,
        "dataThrough": through.isoformat() if through else None,
    }
    store.put(item)
    log.info("flag raised", user_id=user_id, flag_id=flag_id, flag_kind=kind, flag_target_type=target_type, status="OPEN")
    return _to_flag(item)


def my_flags(
    cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, store: FlagStore
) -> list[dict[str, Any]]:
    items = [i for i in store.list_for(user_id) if i.get("userId") == user_id][:MAX_LISTED]
    log.info("flags listed", user_id=user_id, count=len(items))
    return [_to_flag(i) for i in items]
