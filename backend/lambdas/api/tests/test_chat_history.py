"""Saved conversations stay caller-owned, are grouped by thread here, and are rechecked against the current RLS scope."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest

from a2g_api import chat_history
from a2g_api.errors import BadRequest

THREAD_A, THREAD_B = "thread-aaaa-1111", "thread-bbbb-2222"


class Cursor:
    def __init__(self, territories: list[str], *, records: bool = False) -> None:
        self.territories = territories
        self.records = records
        self.statements: list[str] = []

    def execute(self, statement: str) -> None:
        self.statements.append(statement)

    def fetchall(self) -> list[tuple[str]]:
        return [(territory,) for territory in self.territories]

    def fetchone(self) -> tuple[bool]:
        return (self.records,)


class Store:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.calls: list[tuple[Any, ...]] = []

    def list_turns(self, user_id: str) -> list[dict[str, Any]]:
        self.calls.append(("list", user_id))
        return self.rows

    def thread_turns(self, user_id: str, thread_id: str) -> list[dict[str, Any]]:
        self.calls.append(("thread", user_id, thread_id))
        return [row for row in self.rows if row.get("thread_id") == thread_id]


def row(**overrides: Any) -> dict[str, Any]:
    return {
        "thread_id": THREAD_A,
        "run_id": "run-1",
        "user_message": "What changed?",
        "assistant_text": "Two calls changed.",
        "generated_at": "2026-11-04T09:30:00+00:00",
        "scope_territory_ids": ["T01-01"],
        "facts": [],
        "evidence": [],
        "visuals": [],
        "surfaces": [],
        "suggestions": [],
        **overrides,
    }


def threads(rows: list[dict[str, Any]], args: dict[str, Any] | None = None, territories: tuple[str, ...] = ("T01-01",), identity: Any = None) -> list[dict[str, Any]]:
    return chat_history.my_chat_threads(Cursor(list(territories)), identity, "cognito|u1", args or {}, store=Store(rows))


def test_threads_group_turns_by_thread_and_order_by_the_newest_turn_not_the_key() -> None:
    result = threads(
        [
            # DynamoDB hands these back ordered by thread id, whatever the times are.
            row(thread_id=THREAD_A, run_id="a1", user_message="First question about calls", generated_at="2026-11-01T09:00:00+00:00"),
            row(thread_id=THREAD_A, run_id="a2", user_message="A follow-up", generated_at="2026-11-01T09:05:00+00:00"),
            row(thread_id=THREAD_B, run_id="b1", user_message="Newer thread", generated_at="2026-11-03T10:00:00+00:00"),
        ]
    )
    assert [t["threadId"] for t in result] == [THREAD_B, THREAD_A]
    assert result[1] == {
        "threadId": THREAD_A,
        "title": "First question about calls",
        "startedAt": "2026-11-01T09:00:00+00:00",
        "updatedAt": "2026-11-01T09:05:00+00:00",
        "turnCount": 2,
    }


def test_a_threads_title_is_its_earliest_question_even_when_rows_arrive_out_of_order() -> None:
    result = threads(
        [
            row(run_id="a2", user_message="Later question", generated_at="2026-11-01T09:05:00+00:00"),
            row(run_id="a1", user_message="  Earliest   question\nwith  spaces ", generated_at="2026-11-01T09:00:00+00:00"),
        ]
    )
    assert result[0]["title"] == "Earliest question with spaces"
    assert result[0]["startedAt"] == "2026-11-01T09:00:00+00:00"


def test_long_titles_are_cut_with_an_ellipsis() -> None:
    title = threads([row(user_message="word " * 60)])[0]["title"]
    assert len(title) == chat_history.TITLE_LENGTH and title.endswith("…")


def test_threads_queries_only_the_verified_users_partition_and_rechecks_scope() -> None:
    cur = Cursor(["T01-01"])
    store = Store([row(), row(run_id="lost-scope", thread_id=THREAD_B, scope_territory_ids=["T02-01"])])
    result = chat_history.my_chat_threads(cur, None, "cognito|u1", {"limit": 10}, store=store)
    assert store.calls == [("list", "cognito|u1")]
    assert "current_scope_territories" in cur.statements[0]
    # The thread whose only turn is out of scope is not listed; nothing about it leaks.
    assert [t["threadId"] for t in result] == [THREAD_A]


def test_a_thread_counts_only_the_turns_still_in_scope() -> None:
    result = threads([row(run_id="a1"), row(run_id="a2", scope_territory_ids=["T02-01"])])
    assert result[0]["turnCount"] == 1


def test_threads_limit_is_applied_after_ordering() -> None:
    rows = [row(thread_id=f"thread-{n:08d}", run_id=f"r{n}", generated_at=f"2026-11-0{n}T09:00:00+00:00") for n in range(1, 5)]
    assert [t["threadId"] for t in threads(rows, {"limit": 2})] == ["thread-00000004", "thread-00000003"]


@pytest.mark.parametrize("limit", [0, 101, True, "10", 1.5])
def test_threads_reject_invalid_limits_before_any_read(limit: object) -> None:
    store = Store([row()])
    with pytest.raises(BadRequest):
        chat_history.my_chat_threads(Cursor(["T01-01"]), None, "u1", {"limit": limit}, store=store)
    assert store.calls == []


def test_threads_drop_legacy_and_malformed_turns() -> None:
    assert threads([row(scope_territory_ids=None), row(scope_territory_ids=[1]), row(user_message=None), row(generated_at=None), row(thread_id=None)]) == []


def test_aggregate_only_executive_lists_and_reopens_nothing() -> None:
    store = Store([row()])
    executive = SimpleNamespace(persona="executive")
    assert chat_history.my_chat_threads(Cursor(["T01-01"]), executive, "u1", {}, store=store) == []
    assert chat_history.my_chat_thread(Cursor(["T01-01"]), executive, "u1", {"threadId": THREAD_A}, store=store) == []
    assert store.calls == []


def test_an_executive_with_record_access_can_use_history() -> None:
    result = chat_history.my_chat_threads(Cursor(["T01-01"], records=True), SimpleNamespace(persona="executive"), "u1", {}, store=Store([row()]))
    assert len(result) == 1


def test_thread_returns_the_saved_turns_with_their_evidence_for_the_verified_user() -> None:
    cur = Cursor(["T01-01"])
    store = Store(
        [
            row(run_id="a1", facts=[{"statement": "2 calls"}], surfaces=[[{"type": "createSurface"}]], visuals=[{"kind": "bar"}]),
            row(run_id="a2", generated_at="2026-11-04T09:31:00+00:00"),
            row(run_id="b1", thread_id=THREAD_B),
        ]
    )
    result = chat_history.my_chat_thread(cur, None, "cognito|u1", {"threadId": THREAD_A}, store=store)
    assert store.calls == [("thread", "cognito|u1", THREAD_A)]
    assert [turn["runId"] for turn in result] == ["a1", "a2"]
    payload = json.loads(result[0]["payload"])
    assert payload["facts"] == [{"statement": "2 calls"}] and payload["surfaces"] == [[{"type": "createSurface"}]] and payload["visuals"] == [{"kind": "bar"}]
    assert set(result[0]) == {"threadId", "runId", "userMessage", "assistantText", "generatedAt", "payload"}


def test_thread_rechecks_each_turns_scope_and_ignores_rows_of_other_threads() -> None:
    store = Store([row(run_id="ok"), row(run_id="lost", scope_territory_ids=["T02-01"]), row(run_id="legacy", scope_territory_ids=None)])
    assert [t["runId"] for t in chat_history.my_chat_thread(Cursor(["T01-01"]), None, "u1", {"threadId": THREAD_A}, store=store)] == ["ok"]

    class Misbehaving(Store):
        def thread_turns(self, user_id: str, thread_id: str) -> list[dict[str, Any]]:
            return self.rows

    mixed = Misbehaving([row(run_id="mine"), row(run_id="other", thread_id=THREAD_B)])
    assert [t["runId"] for t in chat_history.my_chat_thread(Cursor(["T01-01"]), None, "u1", {"threadId": THREAD_A}, store=mixed)] == ["mine"]


@pytest.mark.parametrize("thread_id", [None, "", "short", "a#b" * 5, "../" * 6, "x" * 65, 7, "has space   here"])
def test_thread_rejects_ids_that_could_address_anything_else(thread_id: object) -> None:
    store = Store([row()])
    with pytest.raises(BadRequest):
        chat_history.my_chat_thread(Cursor(["T01-01"]), None, "u1", {"threadId": thread_id}, store=store)
    assert store.calls == []


class FakeDynamo:
    """A DynamoDB client over a few items, with Limit and pagination as the real one behaves."""

    def __init__(self, items: list[dict[str, Any]], page: int = 2) -> None:
        self.items, self.page, self.requests = items, page, []

    def query(self, **request: Any) -> dict[str, Any]:
        self.requests.append(request)
        prefix = request["ExpressionAttributeValues"][":prefix"]["S"]
        matching = [item for item in self.items if item["sk"]["S"].startswith(prefix)]
        if not request["ScanIndexForward"]:
            matching.reverse()
        start = int(request.get("ExclusiveStartKey", {}).get("n", {"S": "0"})["S"]) if "ExclusiveStartKey" in request else 0
        size = min(self.page, request["Limit"])
        chunk = matching[start : start + size]
        out: dict[str, Any] = {"Items": chunk}
        if start + size < len(matching):
            out["LastEvaluatedKey"] = {"n": {"S": str(start + size)}}
        return out


def store_over(items: list[dict[str, Any]], page: int = 2) -> tuple[chat_history.DynamoChatHistoryStore, FakeDynamo]:
    store = chat_history.DynamoChatHistoryStore("table", "arn")
    fake = FakeDynamo(items, page)
    store._client = lambda: fake  # type: ignore[method-assign]
    return store, fake


def dynamo_item(thread: str, at: str, run: str) -> dict[str, Any]:
    return {"pk": {"S": "USER#u1"}, "sk": {"S": f"THREAD#{thread}#{at}#{run}"}, "thread_id": {"S": thread}, "run_id": {"S": run}}


def test_the_store_reads_one_partition_by_key_prefix_and_follows_pages() -> None:
    items = [dynamo_item(THREAD_A, f"2026-11-0{n}", f"r{n}") for n in range(1, 6)] + [dynamo_item(THREAD_B, "2026-11-09", "other")]
    store, fake = store_over(items)

    listed = store.list_turns("u1")
    assert len(listed) == 6 and len(fake.requests) == 3
    assert all(request["ExpressionAttributeValues"][":pk"] == {"S": "USER#u1"} for request in fake.requests)
    assert all(request["ProjectionExpression"] == chat_history._LIST_PROJECTION for request in fake.requests)

    fake.requests.clear()
    thread = store.thread_turns("u1", THREAD_A)
    assert [item["run_id"] for item in thread] == ["r1", "r2", "r3", "r4", "r5"]
    assert all(request["ExpressionAttributeValues"][":prefix"] == {"S": f"THREAD#{THREAD_A}#"} for request in fake.requests)
    assert all("ProjectionExpression" not in request for request in fake.requests)


def test_a_thread_longer_than_the_cap_returns_its_newest_turns_oldest_first(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(chat_history, "MAX_TURNS", 3)
    store, _ = store_over([dynamo_item(THREAD_A, f"2026-11-0{n}", f"r{n}") for n in range(1, 6)])
    assert [item["run_id"] for item in store.thread_turns("u1", THREAD_A)] == ["r3", "r4", "r5"]


def test_a_failed_read_is_reported_as_unavailable_without_the_error_text() -> None:
    from a2g_api.errors import Unavailable

    store = chat_history.DynamoChatHistoryStore("table", "arn")

    def boom() -> Any:
        raise RuntimeError("secret table arn:aws:dynamodb:...")

    store._client = boom  # type: ignore[method-assign]
    with pytest.raises(Unavailable) as caught:
        store.list_turns("u1")
    assert "secret" not in str(caught.value)
