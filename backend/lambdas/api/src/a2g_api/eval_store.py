"""FE DynamoDB store for evaluation runs, results and human ratings (docs/adr/0013).

Eval state is operational, so it lives in the FE account (requirements: "eval runs and ratings"). The BE
Lambdas reach it through one narrow role, ``a2g-be-eval``, that can only ``PutItem`` and ``Query``: it cannot
read by key, scan, update or delete. Keys:

* run summaries   pk ``EVAL#RUNS``,           sk ``RUN#<runId>``  (run ids sort by start time)
* run results     pk ``EVAL#RUN#<runId>``,    sk ``Q#<index>#<questionId>``
* human ratings   pk ``EVAL#RATINGS``,        sk ``RATING#<chatRunId>`` (one per live answer; latest wins)

Items are plain JSON. Free text (the rating note, the answer excerpt) is stored and returned to
administrators but never logged.
"""

from __future__ import annotations

import datetime as dt
import threading
from decimal import Decimal
from typing import Any, Protocol

from a2g_logging import get_logger

from .errors import Unavailable

log = get_logger(__name__)

RUNS_PK = "EVAL#RUNS"
RATINGS_PK = "EVAL#RATINGS"
MAX_ITEMS = 500


def run_pk(run_id: str) -> str:
    return f"EVAL#RUN#{run_id}"


class EvalStore(Protocol):
    def put(self, item: dict[str, Any]) -> None: ...

    def query(self, pk: str, *, newest_first: bool = True, limit: int = MAX_ITEMS) -> list[dict[str, Any]]: ...


def _plain(value: Any) -> Any:
    """DynamoDB hands numbers back as Decimal; the API deals in ints and floats."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_plain(v) for v in value]
    return value


def _storable(value: Any) -> Any:
    """DynamoDB rejects floats: store them as Decimal."""
    if isinstance(value, float):
        return Decimal(str(round(value, 6)))
    if isinstance(value, dict):
        return {k: _storable(v) for k, v in value.items() if v is not None}
    if isinstance(value, (list, tuple)):
        return [_storable(v) for v in value]
    return value


class DynamoEvalStore:
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
                RoleArn=self._role_arn, RoleSessionName="a2g-be-eval", DurationSeconds=900
            )["Credentials"]
            client = boto3.client(
                "dynamodb",
                aws_access_key_id=creds["AccessKeyId"],
                aws_secret_access_key=creds["SecretAccessKey"],
                aws_session_token=creds["SessionToken"],
            )
            self._client_cache = (client, creds["Expiration"])
            return client

    def put(self, item: dict[str, Any]) -> None:
        from boto3.dynamodb.types import TypeSerializer

        ser = TypeSerializer()
        try:
            self._client().put_item(
                TableName=self._table, Item={k: ser.serialize(_storable(v)) for k, v in item.items() if v is not None}
            )
        except Exception as exc:
            log.error("eval store write failed", error_type=type(exc).__name__)
            raise Unavailable("eval_write") from exc

    def query(self, pk: str, *, newest_first: bool = True, limit: int = MAX_ITEMS) -> list[dict[str, Any]]:
        from boto3.dynamodb.types import TypeDeserializer

        de = TypeDeserializer()
        items: list[dict[str, Any]] = []
        start: dict[str, Any] | None = None
        try:
            while len(items) < limit:
                kwargs: dict[str, Any] = {
                    "TableName": self._table,
                    "KeyConditionExpression": "pk = :pk",
                    "ExpressionAttributeValues": {":pk": {"S": pk}},
                    "ScanIndexForward": not newest_first,
                    "Limit": min(limit - len(items), 200),
                }
                if start:
                    kwargs["ExclusiveStartKey"] = start
                out = self._client().query(**kwargs)
                items += [_plain({k: de.deserialize(v) for k, v in raw.items()}) for raw in out.get("Items", [])]
                start = out.get("LastEvaluatedKey")
                if not start:
                    break
        except Exception as exc:
            log.error("eval store read failed", error_type=type(exc).__name__)
            raise Unavailable("eval_read") from exc
        return items


class MemoryEvalStore:
    """In-memory store with the same semantics, for unit tests."""

    def __init__(self) -> None:
        self.items: dict[tuple[str, str], dict[str, Any]] = {}

    def put(self, item: dict[str, Any]) -> None:
        self.items[(item["pk"], item["sk"])] = {k: v for k, v in item.items() if v is not None}

    def query(self, pk: str, *, newest_first: bool = True, limit: int = MAX_ITEMS) -> list[dict[str, Any]]:
        rows = sorted((v for (p, _), v in self.items.items() if p == pk), key=lambda i: i["sk"], reverse=newest_first)
        return rows[:limit]
