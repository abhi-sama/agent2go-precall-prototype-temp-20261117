"""What Ask the agent remembers about how a person likes to work (docs/adr/0022).

An item is a short preference ("I prefer tables", "default to 90 days") with a category. It is never a data fact: counts,
calls, HCPs and responses always come fresh from RLS-scoped SQL. Items live in the FE DynamoDB table of saved views,
keyed by the verified user id (partition) and ``MEM#<id>`` (sort key), exactly like the saved appearance (docs/adr/0012),
so nobody can read, write or delete another person's items: the caller never names an owner.

``check_preference`` is the authoritative guard. The agent runs the same rules when it proposes a save and again when it
puts the items in its prompt (``msl_agent.memory``); both are tested against ``backend/agent_memory_guard_cases.json``.
"""

from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from a2g_logging import get_logger

from .errors import BadRequest, NotFound, Unavailable
from .saved_views import SavedViews

log = get_logger(__name__)

MEMORY_PREFIX = "MEM#"
#: A dismissed suggestion (docs/adr/0023) is stored as ``MEMX#<key>``: the key is a hash of the text, so the store keeps
#: no preference words for something the person declined. At most MAX_DISMISSED are kept; the oldest give way.
DISMISSED_PREFIX = "MEMX#"
MAX_DISMISSED = 50
_KEY = re.compile(r"^[0-9a-f]{16}$")
CATEGORIES = ("FORMAT", "LENGTH", "DATE_RANGE", "FOCUS", "OTHER")
MAX_TEXT = 160
MAX_ITEMS = 30
_ID = re.compile(r"^[0-9]{14}-[0-9a-f]{8}$")

_RECORD_NOUNS = r"(?:calls?|hcps?|kols?|responses?|respondents?|visits?|meetings?|interactions?|patients?|prescriptions?|records?|territor(?:y|ies)|insights?|scripts?)"
# Each rule names why a preference was refused, in plain words a person can read.
_REJECT: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("identifier", re.compile(r"\b(?:HCP|NPI|CALL|RESP|TERR|T)-[A-Za-z0-9_-]*\d|\b[A-Z]{2}-\d{2}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b\d{5,}\b", re.I | re.A)),
    ("contact", re.compile(r"\S+@\S+\.\S+|\b\d{3}[-. ]\d{3}[-. ]\d{4}\b")),
    ("person", re.compile(r"\b(?:Dr|Mr|Ms|Mrs)\b\.?\s+[A-Z]|\b(?:Doctor|Prof|Professor)\b\.?\s+[A-Z]")),
    (
        "date",
        re.compile(
            r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}/\d{1,2}/\d{2,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b",
            re.I,
        ),
    ),
    (
        "figure",
        re.compile(
            rf"[%$€£]|\bpercent\b|\d+\.\d+|\d{{1,3}}(?:,\d{{3}})+|\b\d+\s*{_RECORD_NOUNS}\b|\b{_RECORD_NOUNS}\s*(?:was|were|is|are|=|:)\s*\d|\d{{4,}}",
            re.I,
        ),
    ),
    (
        "record_fact",
        re.compile(r"\b(?:met with|spoke (?:to|with)|told me|said (?:that|no|yes)|my (?:call|meeting|visit)\b|call(?:ed)? with|opinion leader)\b", re.I),
    ),
    (
        "instruction",
        re.compile(
            r"\b(?:ignore|disregard|override|bypass|jailbreak)\b|system prompt|previous instructions|\breveal\b|other users?\b|all (?:territories|hcps?|records)\b|everything\b",
            re.I,
        ),
    ),
)


def check_preference(text: Any) -> str | None:
    """The reason a preference is refused, or None when it only says how the person likes to work."""
    if not isinstance(text, str):
        return "empty"
    stripped = text.strip()
    if not stripped:
        return "empty"
    if len(stripped) > MAX_TEXT:
        return "too_long"
    if any(ch in stripped for ch in "\n\r\t") or any(ord(ch) < 32 for ch in stripped):
        return "multiline"
    for reason, pattern in _REJECT:
        if pattern.search(stripped):
            return reason
    return None


def suggestion_key(text: str) -> str:
    """The key a dismissal is stored under. Same text ignoring case and spacing, same key; ``msl_agent.memory_suggest`` agrees."""
    return hashlib.sha256(" ".join(text.split()).casefold().encode()).hexdigest()[:16]


def clean_item(raw: Any) -> dict[str, str]:
    """A valid ``{text, category}`` or ``BadRequest``; the reason is a stable code, never the rejected text."""
    if not isinstance(raw, dict):
        raise BadRequest("invalid_memory")
    text = " ".join(str(raw.get("text") or "").split())
    category = raw.get("category")
    if category not in CATEGORIES:
        raise BadRequest("invalid_memory_category")
    reason = check_preference(text)
    if reason:
        raise BadRequest(f"memory_rejected_{reason}")
    return {"text": text, "category": category}


class AgentMemory:
    """Per-user preference items, on the saved-views table's client; the owner always comes from the verified identity."""

    def __init__(self, views: SavedViews) -> None:
        self._views = views

    @staticmethod
    def _out(item: dict[str, Any]) -> dict[str, str]:
        return {
            "memoryId": str(item["savedViewId"])[len(MEMORY_PREFIX):],
            "text": item["text"],
            "category": item["category"],
            "createdAt": item["createdAt"],
        }

    def _items(self, owner_user_id: str) -> list[dict[str, Any]]:
        views = self._views
        try:
            result = views.client.query(
                TableName=views.table,
                KeyConditionExpression="ownerUserId = :owner AND begins_with(savedViewId, :p)",
                ExpressionAttributeValues={":owner": views._encode({"v": owner_user_id})["v"], ":p": views._encode({"v": MEMORY_PREFIX})["v"]},
                ConsistentRead=True,
            )
        except Exception as exc:
            raise Unavailable("agent_memory_read_failed") from exc
        items = [views._decode(item) for item in result.get("Items", [])]
        # The sort key starts with a timestamp, so key order is creation order.
        return sorted((i for i in items if str(i.get("savedViewId", "")).startswith(MEMORY_PREFIX) and "text" in i and "category" in i), key=lambda i: i["savedViewId"])

    def list(self, owner_user_id: str) -> list[dict[str, str]]:
        return [self._out(item) for item in self._items(owner_user_id)][:MAX_ITEMS]

    def save(self, owner_user_id: str, raw: Any) -> dict[str, str]:
        item = clean_item(raw)
        existing = self._items(owner_user_id)
        for old in existing:
            if old["text"].casefold() == item["text"].casefold():
                return self._out(old)  # saving the same preference twice keeps one item
        if len(existing) >= MAX_ITEMS:
            raise BadRequest("memory_full")
        now = datetime.now(timezone.utc)
        row = {
            "ownerUserId": owner_user_id,
            "savedViewId": f"{MEMORY_PREFIX}{now.strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}",
            **item,
            "createdAt": now.isoformat(),
        }
        try:
            self._views.client.put_item(
                TableName=self._views.table,
                Item=self._views._encode(row),
                ConditionExpression="attribute_not_exists(ownerUserId) AND attribute_not_exists(savedViewId)",
            )
        except Exception as exc:
            raise Unavailable("agent_memory_write_failed") from exc
        return self._out(row)

    def delete(self, owner_user_id: str, memory_id: Any) -> bool:
        if not isinstance(memory_id, str) or not _ID.match(memory_id):
            raise BadRequest("invalid_memory_id")
        views = self._views
        key = views._encode({"ownerUserId": owner_user_id, "savedViewId": f"{MEMORY_PREFIX}{memory_id}"})
        try:
            deleted = views.client.delete_item(TableName=views.table, Key=key, ReturnValues="ALL_OLD")
        except Exception as exc:
            raise Unavailable("agent_memory_write_failed") from exc
        if not deleted.get("Attributes"):
            raise NotFound("unknown_memory")
        return True

    def _dismissals(self, owner_user_id: str) -> list[dict[str, Any]]:
        views = self._views
        try:
            result = views.client.query(
                TableName=views.table,
                KeyConditionExpression="ownerUserId = :owner AND begins_with(savedViewId, :p)",
                ExpressionAttributeValues={":owner": views._encode({"v": owner_user_id})["v"], ":p": views._encode({"v": DISMISSED_PREFIX})["v"]},
                ConsistentRead=True,
            )
        except Exception as exc:
            raise Unavailable("agent_memory_read_failed") from exc
        items = [views._decode(item) for item in result.get("Items", [])]
        return sorted((i for i in items if str(i.get("savedViewId", "")).startswith(DISMISSED_PREFIX)), key=lambda i: (str(i.get("createdAt", "")), i["savedViewId"]))

    def dismissed_keys(self, owner_user_id: str) -> list[str]:
        """The keys of the suggestions this person dismissed, oldest first."""
        return [k for i in self._dismissals(owner_user_id) if _KEY.match(k := str(i["savedViewId"])[len(DISMISSED_PREFIX):])]

    def dismiss(self, owner_user_id: str, text: Any) -> bool:
        """Record that a suggestion was declined so it is not offered again. Only a preference can be dismissed."""
        cleaned = " ".join(str(text or "").split())
        reason = check_preference(cleaned)
        if reason:
            raise BadRequest(f"memory_rejected_{reason}")
        key = suggestion_key(cleaned)
        views = self._views
        existing = self._dismissals(owner_user_id)
        if any(str(i["savedViewId"]) == f"{DISMISSED_PREFIX}{key}" for i in existing):
            return True  # dismissing twice is the same as once
        try:
            views.client.put_item(
                TableName=views.table,
                Item=views._encode({"ownerUserId": owner_user_id, "savedViewId": f"{DISMISSED_PREFIX}{key}", "createdAt": datetime.now(timezone.utc).isoformat()}),
            )
            # Past the cap the oldest give way, so the list cannot grow without bound.
            for old in existing[: max(0, len(existing) + 1 - MAX_DISMISSED)]:
                views.client.delete_item(TableName=views.table, Key=views._encode({"ownerUserId": owner_user_id, "savedViewId": old["savedViewId"]}))
        except Exception as exc:
            raise Unavailable("agent_memory_write_failed") from exc
        return True

    def clear(self, owner_user_id: str) -> int:
        """Forget everything: the preferences (counted) and the dismissed suggestions (so they may be offered afresh)."""
        removed = 0
        for item in self._items(owner_user_id):
            try:
                self._views.client.delete_item(
                    TableName=self._views.table,
                    Key=self._views._encode({"ownerUserId": owner_user_id, "savedViewId": item["savedViewId"]}),
                )
            except Exception as exc:
                raise Unavailable("agent_memory_write_failed") from exc
            removed += 1
        for dismissal in self._dismissals(owner_user_id):
            try:
                self._views.client.delete_item(
                    TableName=self._views.table,
                    Key=self._views._encode({"ownerUserId": owner_user_id, "savedViewId": dismissal["savedViewId"]}),
                )
            except Exception as exc:
                raise Unavailable("agent_memory_write_failed") from exc
        return removed


def load_for_prompt(store: AgentMemory, owner_user_id: str) -> list[dict[str, str]]:
    """The items sent to the agent with each run: only valid preferences, in creation order, never more than the cap."""
    out: list[dict[str, str]] = []
    for item in store.list(owner_user_id):
        if check_preference(item["text"]) is None:
            out.append({"text": item["text"], "category": item["category"]})
    return out


def load_dismissed(store: AgentMemory, owner_user_id: str) -> list[str]:
    """The dismissed-suggestion keys sent to the agent with each run (never the text of anything)."""
    return store.dismissed_keys(owner_user_id)[-MAX_DISMISSED:]


# AppSync field resolvers. The owner is always the verified user id; no argument names another person.
def my_agent_memory(cur: Any, identity: Any, user_id: str, args: Any, *, store: AgentMemory) -> list[dict[str, str]]:
    return store.list(user_id)


def save_agent_memory(cur: Any, identity: Any, user_id: str, args: Any, *, store: AgentMemory) -> dict[str, str]:
    saved = store.save(user_id, args.get("input"))
    log.info("agent memory saved", user_id=user_id, category=saved["category"])
    return saved


def delete_agent_memory(cur: Any, identity: Any, user_id: str, args: Any, *, store: AgentMemory) -> bool:
    store.delete(user_id, args.get("memoryId"))
    log.info("agent memory deleted", user_id=user_id)
    return True


def clear_agent_memory(cur: Any, identity: Any, user_id: str, args: Any, *, store: AgentMemory) -> int:
    removed = store.clear(user_id)
    log.info("agent memory cleared", user_id=user_id, removed=removed)
    return removed


def dismiss_agent_memory_suggestion(cur: Any, identity: Any, user_id: str, args: Any, *, store: AgentMemory) -> bool:
    store.dismiss(user_id, args.get("text"))
    log.info("agent memory suggestion dismissed", user_id=user_id)
    return True
