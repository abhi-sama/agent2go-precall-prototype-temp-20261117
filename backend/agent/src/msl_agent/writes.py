"""The agent's narrow write tool: persist one conversation turn to FE DynamoDB (docs/adr/0005).

The agent assumes a cross-account role in the FE account whose policy allows only ``PutItem`` /
``UpdateItem`` on the chat-turn table. Every item is keyed to the requesting user and carries its
owner, scope, data-through date, generation time and evidence links, so access can be re-checked and
staleness flagged on open. The runtime calls this after the answer is complete; the model cannot
invoke it, choose the key, or write anything else.
"""

from __future__ import annotations

import datetime as dt
import json
import time
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Protocol

import boto3
from a2g_logging import get_logger
from boto3.dynamodb.types import TypeSerializer

from .schemas import Citation, Fact, Identity

log = get_logger(__name__)

_SERIALIZER = TypeSerializer()
#: Items expire so local runs cannot grow the table forever; the retention policy proper is ticket 17.
RETENTION_DAYS = 365


@dataclass(frozen=True)
class ConversationTurn:
    identity: Identity
    thread_id: str
    run_id: str
    user_message: str
    assistant_text: str
    facts: list[Fact] = field(default_factory=list)
    citations: list[Citation] = field(default_factory=list)
    visuals: list[dict[str, Any]] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)
    scope_territory_ids: list[str] = field(default_factory=list)
    data_through: dt.datetime | None = None
    model_mode: str = "claude"
    unverified_numbers: list[str] = field(default_factory=list)
    #: Executive analysis only: the limits of the sample the answer rests on, stated in the answer itself.
    sample_limitations: list[str] = field(default_factory=list)


class ConversationWriteTool(Protocol):
    def save_turn(self, turn: ConversationTurn) -> bool:
        """Persist one turn. Returns False (never raises) when the store is unavailable."""
        ...


class NullConversationWriter:
    """Used where no FE table is configured (unit tests, a bare container)."""

    def save_turn(self, turn: ConversationTurn) -> bool:
        return False


def item_for(turn: ConversationTurn, *, now: dt.datetime | None = None) -> dict[str, Any]:
    generated = (now or dt.datetime.now(dt.UTC)).replace(microsecond=0)
    return {
        # Partition key = the requesting user: items are written to, and read back by, one owner only.
        "pk": f"USER#{turn.identity.user_id}",
        "sk": f"THREAD#{turn.thread_id}#{generated.isoformat()}#{turn.run_id}",
        "owner_user_id": turn.identity.user_id,
        "persona": turn.identity.persona,
        "thread_id": turn.thread_id,
        "run_id": turn.run_id,
        "user_message": turn.user_message,
        "assistant_text": turn.assistant_text,
        "facts": [fact.model_dump() for fact in turn.facts],
        "evidence": [citation.model_dump() for citation in turn.citations],
        # DynamoDB numbers must be Decimal, never float (share_pct is a one-decimal float).
        "visuals": json.loads(json.dumps(turn.visuals), parse_float=Decimal),
        "suggestions": turn.suggestions,
        "scope_territory_ids": turn.scope_territory_ids,
        "data_through": turn.data_through.isoformat() if turn.data_through else None,
        "generated_at": generated.isoformat(),
        "model_mode": turn.model_mode,
        "unverified_numbers": turn.unverified_numbers,
        "sample_limitations": turn.sample_limitations,
        "expires_at": int(generated.timestamp()) + RETENTION_DAYS * 86_400,
    }


class DynamoConversationWriter:
    def __init__(self, *, role_arn: str, table: str, region: str, session_name: str = "msl-agent") -> None:
        self._role_arn = role_arn
        self._table = table
        self._region = region
        self._session_name = session_name
        self._client: Any = None
        self._expires_at = 0.0

    def _dynamodb(self) -> Any:
        # Short-lived credentials for the FE-account role; renewed a minute before they lapse.
        if self._client is None or time.time() > self._expires_at - 60:
            creds = boto3.client("sts", region_name=self._region).assume_role(
                RoleArn=self._role_arn, RoleSessionName=self._session_name, DurationSeconds=900
            )["Credentials"]
            self._client = boto3.client(
                "dynamodb",
                region_name=self._region,
                aws_access_key_id=creds["AccessKeyId"],
                aws_secret_access_key=creds["SecretAccessKey"],
                aws_session_token=creds["SessionToken"],
            )
            self._expires_at = creds["Expiration"].timestamp()
        return self._client

    def save_turn(self, turn: ConversationTurn) -> bool:
        try:
            item = {key: _SERIALIZER.serialize(value) for key, value in item_for(turn).items()}
            self._dynamodb().put_item(
                TableName=self._table,
                Item=item,
                # Never replace an existing turn: the sort key embeds the run id.
                ConditionExpression="attribute_not_exists(pk)",
            )
        except Exception as exc:
            # Type only: a client error message can echo item values.
            log.error("conversation write failed", run_id=turn.run_id, error_type=type(exc).__name__)
            self._client = None
            return False
        log.info("conversation turn saved", run_id=turn.run_id, thread_id=turn.thread_id, outcome="ok")
        return True
