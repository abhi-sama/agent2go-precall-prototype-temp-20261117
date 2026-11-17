"""Owner-scoped saved filters in the FE-account DynamoDB table.

The browser still reaches this through FE AppSync -> BE Lambda. The primary key starts
with the verified application user id, so a caller cannot select another owner's views.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import boto3
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer

from .errors import BadRequest, Unavailable
from .settings import Settings

_serializer = TypeSerializer()
_deserializer = TypeDeserializer()
_FILTER_KEYS = ("from", "to", "territoryId", "molecule", "landscape", "study", "survey", "questionId")
# The per-user appearance choice lives in the same owner-keyed table under a fixed sort key. The prefix keeps it out of
# the saved-view list; the verified user id is the partition key, so nobody can read or write another person's choice.
PREFERENCE_PREFIX = "PREF#"
# What Ask the agent remembers about the person (docs/adr/0022), and the suggestions they dismissed (0023), share the table under its own prefix, for the same reason.
NON_VIEW_PREFIXES = (PREFERENCE_PREFIX, "MEM#", "MEMX#")
APPEARANCE_KEY = f"{PREFERENCE_PREFIX}appearance"
APPEARANCE_CHOICES: dict[str, tuple[str, ...]] = {
    "style": ("auto", "warm", "clinical"),
    "mode": ("device", "light", "charcoal", "black"),
    "density": ("auto", "comfortable", "compact"),
}


class SavedViews:
    def __init__(self, settings: Settings):
        self.table = settings.saved_views_table
        if not self.table:
            raise RuntimeError("A2G_SAVED_VIEWS_TABLE is required")
        kwargs: dict[str, Any] = {"region_name": settings.saved_views_region}
        if settings.saved_views_endpoint:
            kwargs["endpoint_url"] = settings.saved_views_endpoint
        # floci selects an account from the access key. Settings refuses this local
        # test credential outside A2G_ENV=local; deployed Lambda uses its role.
        if settings.saved_views_access_key:
            kwargs["aws_access_key_id"] = settings.saved_views_access_key
            kwargs["aws_secret_access_key"] = "test"
        self.client = boto3.client("dynamodb", **kwargs)

    @staticmethod
    def _encode(item: dict[str, Any]) -> dict[str, Any]:
        return {key: _serializer.serialize(value) for key, value in item.items()}

    @staticmethod
    def _decode(item: dict[str, Any]) -> dict[str, Any]:
        return {key: _deserializer.deserialize(value) for key, value in item.items()}

    @staticmethod
    def _view(item: dict[str, Any]) -> dict[str, Any]:
        return {"savedViewId": item["savedViewId"], "name": item["name"], "reportKind": item["reportKind"], "filters": item.get("filters") or {}, "createdAt": item["createdAt"]}

    def list(self, owner_user_id: str) -> list[dict[str, Any]]:
        try:
            result = self.client.query(TableName=self.table, KeyConditionExpression="ownerUserId = :owner", ExpressionAttributeValues={":owner": _serializer.serialize(owner_user_id)}, ScanIndexForward=False)
            items = [self._decode(item) for item in result.get("Items", [])]
            # The person's preference and memory items share the table; they are not saved views.
            return [self._view(item) for item in items if not str(item["savedViewId"]).startswith(NON_VIEW_PREFIXES)]
        except Exception as exc:
            raise Unavailable("saved_views_read_failed") from exc

    def save(self, owner_user_id: str, input_: dict[str, Any]) -> dict[str, Any]:
        name, kind, raw_filters = str(input_.get("name") or "").strip(), str(input_.get("reportKind") or "").strip(), input_.get("filters")
        if not name or len(name) > 80 or not kind or not isinstance(raw_filters, dict):
            raise BadRequest("invalid_saved_view")
        item = {"ownerUserId": owner_user_id, "savedViewId": str(uuid.uuid4()), "name": name, "reportKind": kind, "filters": {key: str(value) for key, value in raw_filters.items() if key in _FILTER_KEYS and value not in (None, "")}, "createdAt": datetime.now(timezone.utc).isoformat()}
        try:
            self.client.put_item(TableName=self.table, Item=self._encode(item), ConditionExpression="attribute_not_exists(ownerUserId) AND attribute_not_exists(savedViewId)")
        except Exception as exc:
            raise Unavailable("saved_views_write_failed") from exc
        return self._view(item)

    @staticmethod
    def _appearance(item: dict[str, Any]) -> dict[str, str]:
        return {"style": item["style"], "mode": item["mode"], "density": item["density"], "updatedAt": item["updatedAt"]}

    def get_appearance(self, owner_user_id: str) -> dict[str, str] | None:
        """The saved appearance, or None when the person never chose one (the client then uses their persona defaults)."""
        try:
            result = self.client.get_item(TableName=self.table, Key=self._encode({"ownerUserId": owner_user_id, "savedViewId": APPEARANCE_KEY}), ConsistentRead=True)
        except Exception as exc:
            raise Unavailable("appearance_read_failed") from exc
        item = result.get("Item")
        return self._appearance(self._decode(item)) if item else None

    def set_appearance(self, owner_user_id: str, input_: dict[str, Any]) -> dict[str, str]:
        choice = {key: input_.get(key) for key in APPEARANCE_CHOICES}
        if any(choice[key] not in allowed for key, allowed in APPEARANCE_CHOICES.items()):
            raise BadRequest("invalid_appearance")
        item = {"ownerUserId": owner_user_id, "savedViewId": APPEARANCE_KEY, **choice, "updatedAt": datetime.now(timezone.utc).isoformat()}
        try:
            self.client.put_item(TableName=self.table, Item=self._encode(item))
        except Exception as exc:
            raise Unavailable("appearance_write_failed") from exc
        return self._appearance(item)
