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
            return [self._view(self._decode(item)) for item in result.get("Items", [])]
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
