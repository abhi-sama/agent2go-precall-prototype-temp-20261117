"""What Ask the agent remembers (docs/adr/0022): the guard, the owner-keyed store, and loading it into a run.

Proven end to end through AppSync in tests/api/test_agent_memory.py; these cover the checks that run before storage.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import boto3
import pytest

from a2g_api import agent_memory, chat
from a2g_api.agent_memory import MAX_ITEMS, AgentMemory, check_preference, clean_item
from a2g_api.errors import BadRequest, NotFound, Unavailable
from a2g_api.saved_views import APPEARANCE_KEY, SavedViews
from a2g_api.settings import Settings

CASES = json.loads((Path(__file__).resolve().parents[3] / "agent_memory_guard_cases.json").read_text())
REJECTED = [(reason, text) for reason, texts in CASES["rejected"].items() for text in texts]


class FakeDynamo:
    """Just enough of the DynamoDB client: items keyed by (owner, sort key)."""

    def __init__(self) -> None:
        self.items: dict[tuple[str, str], dict[str, Any]] = {}
        self.fail = False

    def put_item(self, TableName: str, Item: dict[str, Any], **_k: Any) -> None:
        if self.fail:
            raise RuntimeError("down")
        self.items[(Item["ownerUserId"]["S"], Item["savedViewId"]["S"])] = Item

    def query(self, **kwargs: Any) -> dict[str, Any]:
        if self.fail:
            raise RuntimeError("down")
        owner = kwargs["ExpressionAttributeValues"][":owner"]["S"]
        prefix = kwargs["ExpressionAttributeValues"][":p"]["S"]
        return {"Items": [i for (o, sk), i in self.items.items() if o == owner and sk.startswith(prefix)]}

    def delete_item(self, TableName: str, Key: dict[str, Any], ReturnValues: str = "NONE") -> dict[str, Any]:
        old = self.items.pop((Key["ownerUserId"]["S"], Key["savedViewId"]["S"]), None)
        return {"Attributes": old} if old and ReturnValues == "ALL_OLD" else {}


@pytest.fixture
def memory(monkeypatch: pytest.MonkeyPatch) -> tuple[AgentMemory, FakeDynamo]:
    fake = FakeDynamo()
    monkeypatch.setattr(boto3, "client", lambda *_a, **_k: fake)
    settings = Settings.from_env(
        {"A2G_ENV": "local", "A2G_COGNITO_ISSUER": "http://issuer.test", "A2G_COGNITO_CLIENT_IDS": "client", "A2G_DB_DSN": "postgresql://unused", "A2G_SAVED_VIEWS_TABLE": "views"}
    )
    return AgentMemory(SavedViews(settings)), fake


@pytest.mark.parametrize("text", CASES["accepted"])
def test_a_preference_about_how_to_work_is_accepted(text: str) -> None:
    assert check_preference(text) is None


@pytest.mark.parametrize(("reason", "text"), REJECTED)
def test_anything_that_looks_like_a_record_fact_is_refused(reason: str, text: str) -> None:
    assert check_preference(text) == reason


def test_an_item_needs_a_known_category_and_a_clean_text() -> None:
    assert clean_item({"text": "  I prefer   tables ", "category": "FORMAT"}) == {"text": "I prefer tables", "category": "FORMAT"}
    for bad in (None, "x", {"text": "tables", "category": "NOPE"}, {"text": "tables"}):
        with pytest.raises(BadRequest):
            clean_item(bad)
    with pytest.raises(BadRequest) as refused:
        clean_item({"text": "HCP-0001 prefers email", "category": "OTHER"})
    assert refused.value.reason == "memory_rejected_identifier"


def test_nothing_saved_means_an_empty_list(memory) -> None:
    store, _ = memory
    assert store.list("u1") == []


def test_an_item_round_trips_for_its_owner_only(memory) -> None:
    store, fake = memory
    saved = store.save("u1", {"text": "I prefer tables", "category": "FORMAT"})
    assert saved["text"] == "I prefer tables" and saved["category"] == "FORMAT" and "ownerUserId" not in saved
    assert store.list("u1") == [saved]
    assert store.list("u2") == []
    # The stored sort key carries the prefix; the owner is the partition key, never a field of the input.
    [(owner, sort_key)] = fake.items
    assert owner == "u1" and sort_key == f"MEM#{saved['memoryId']}"


def test_the_input_cannot_name_another_owner(memory) -> None:
    store, fake = memory
    store.save("u1", {"text": "I prefer tables", "category": "FORMAT", "ownerUserId": "u2", "savedViewId": "MEM#x"})
    assert [owner for owner, _ in fake.items] == ["u1"]


def test_the_same_preference_is_kept_once(memory) -> None:
    store, _ = memory
    first = store.save("u1", {"text": "I prefer tables", "category": "FORMAT"})
    again = store.save("u1", {"text": "i PREFER tables", "category": "FORMAT"})
    assert again["memoryId"] == first["memoryId"] and len(store.list("u1")) == 1


def test_a_refused_item_stores_nothing(memory) -> None:
    store, fake = memory
    with pytest.raises(BadRequest):
        store.save("u1", {"text": "Dr. Smith had 12 calls", "category": "OTHER"})
    assert fake.items == {}


def test_the_list_is_capped(memory) -> None:
    store, _ = memory
    for i in range(MAX_ITEMS):
        store.save("u1", {"text": f"Prefer style {chr(97 + i % 26)}{chr(97 + i // 26)}", "category": "OTHER"})
    with pytest.raises(BadRequest) as full:
        store.save("u1", {"text": "One more preference", "category": "OTHER"})
    assert full.value.reason == "memory_full"


def test_delete_removes_one_item_of_the_caller_only(memory) -> None:
    store, _ = memory
    mine = store.save("u1", {"text": "I prefer tables", "category": "FORMAT"})
    theirs = store.save("u2", {"text": "I prefer charts", "category": "FORMAT"})
    with pytest.raises(NotFound):  # another person's id is indistinguishable from one that does not exist
        store.delete("u1", theirs["memoryId"])
    assert store.list("u2") == [theirs]
    assert store.delete("u1", mine["memoryId"]) is True
    assert store.list("u1") == []
    with pytest.raises(NotFound):
        store.delete("u1", mine["memoryId"])
    for bad in (None, "", "PREF#appearance", "../x", 5):
        with pytest.raises(BadRequest):
            store.delete("u1", bad)


def test_clear_removes_only_the_callers_items_and_not_their_other_preferences(memory) -> None:
    store, fake = memory
    store.save("u1", {"text": "I prefer tables", "category": "FORMAT"})
    store.save("u1", {"text": "Default to the last 90 days", "category": "DATE_RANGE"})
    store.save("u2", {"text": "I prefer charts", "category": "FORMAT"})
    fake.items[("u1", APPEARANCE_KEY)] = {"ownerUserId": {"S": "u1"}, "savedViewId": {"S": APPEARANCE_KEY}}
    assert store.clear("u1") == 2
    assert store.list("u1") == [] and len(store.list("u2")) == 1
    assert ("u1", APPEARANCE_KEY) in fake.items


def test_a_store_that_is_down_is_unavailable_not_silent(memory) -> None:
    store, fake = memory
    fake.fail = True
    for call in (lambda: store.list("u1"), lambda: store.save("u1", {"text": "I prefer tables", "category": "FORMAT"})):
        with pytest.raises(Unavailable):
            call()


def test_memory_items_are_not_saved_views(memory) -> None:
    store, fake = memory
    store.save("u1", {"text": "I prefer tables", "category": "FORMAT"})
    views = SavedViews.__new__(SavedViews)
    views.client, views.table = fake, "views"
    fake_query = fake.query
    fake.query = lambda **_k: {"Items": list(fake.items.values())}  # a raw owner query returns every item
    try:
        assert views.list("u1") == []
    finally:
        fake.query = fake_query


def test_the_run_loads_only_valid_items(memory) -> None:
    store, fake = memory
    store.save("u1", {"text": "I prefer tables", "category": "FORMAT"})
    # An item written some other way (an old build, a manual edit) that the guard would refuse never reaches the prompt.
    fake.items[("u1", "MEM#20990101000000-deadbeef")] = {
        "ownerUserId": {"S": "u1"}, "savedViewId": {"S": "MEM#20990101000000-deadbeef"},
        "text": {"S": "HCP-0001 prefers email"}, "category": {"S": "OTHER"}, "createdAt": {"S": "2099-01-01T00:00:00+00:00"},
    }
    assert agent_memory.load_for_prompt(store, "u1") == [{"text": "I prefer tables", "category": "FORMAT"}]


# --- the run ---------------------------------------------------------------------------------------------------------


class Cursor:
    def __init__(self) -> None:
        self.sql: list[str] = []

    def execute(self, sql: str, params: Any = None) -> None:
        self.sql.append(" ".join(sql.split()))

    def fetchone(self) -> Any:
        return ("11111111-1111-1111-1111-111111111111",)


def _start(memory_loader):
    from a2g_api.identity import Identity

    sent: list[dict] = []
    chat.start_chat_run(
        Cursor(), Identity("cognito|s", "msl", "MSL", "Avery", "a@example.test", "header"), "msl-1",
        {"threadId": "22222222-2222-2222-2222-222222222222", "runId": "11111111-1111-1111-1111-111111111111", "message": "How many calls?"},
        worker_function="a2g-be-chat", correlation_id="c1", invoker=lambda _fn, payload: sent.append(payload), memory=memory_loader,
    )
    return sent[0]


def test_every_run_carries_the_callers_items_read_for_the_verified_user() -> None:
    asked: list[str] = []

    def loader(user_id: str) -> list[dict[str, str]]:
        asked.append(user_id)
        return [{"text": "I prefer tables", "category": "FORMAT"}]

    payload = _start(loader)
    assert asked == ["msl-1"] and payload["memory"] == [{"text": "I prefer tables", "category": "FORMAT"}]


def test_a_run_without_items_has_no_memory_key() -> None:
    assert "memory" not in _start(lambda _user: [])
    assert "memory" not in _start(None)


def test_the_resume_path_accepts_the_save_preference_kind() -> None:
    interrupted = {
        "type": "RUN_FINISHED",
        "outcome": {"type": "interrupt", "interrupts": [{"id": "write-x", "reason": "approval", "metadata": {"kind": "save_preference", "title": "Remember this preference", "values": {"text": "I prefer tables", "category": "FORMAT"}}}]},
    }
    assert chat._write_approval_event(interrupted)["kind"] == "save_preference"
    assert chat._clean_write_values({"text": "Keep it short"}, {"text": "x", "category": "FORMAT"}) == {"text": "Keep it short"}
    with pytest.raises(BadRequest):
        chat._clean_write_values({"owner": "u2"}, {"text": "x", "category": "FORMAT"})


def test_the_worker_forwards_the_items_to_the_agent(monkeypatch) -> None:
    from a2g_api import chat_worker

    class Runtime:
        payload: dict | None = None

        def invoke(self, payload: dict):
            self.payload = payload
            yield {"type": "RUN_FINISHED"}

    base = {
        "user_id": "msl-1", "persona": "MSL", "full_name": "A", "email": "a@x.test", "correlation_id": "c1",
        "thread_id": "22222222-2222-2222-2222-222222222222", "run_id": "11111111-1111-1111-1111-111111111111",
        "messages": [{"role": "user", "content": "q"}],
    }
    settings = Settings.from_env({"A2G_ENV": "aws", "A2G_COGNITO_ISSUER": "http://i", "A2G_COGNITO_CLIENT_IDS": "c", "A2G_DB_DSN": "postgresql://x"})
    monkeypatch.setattr(chat_worker, "_append", lambda *a: None)
    runtime = Runtime()
    chat_worker.run_chat({**base, "memory": [{"text": "I prefer tables", "category": "FORMAT"}]}, settings, runtime)
    assert runtime.payload["memory"] == [{"text": "I prefer tables", "category": "FORMAT"}]
    runtime = Runtime()
    chat_worker.run_chat(base, settings, runtime)
    assert "memory" not in runtime.payload
