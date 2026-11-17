"""Saved chat history remains caller-owned and is rechecked against the current RLS scope."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest

from a2g_api import chat_history
from a2g_api.errors import BadRequest


class Cursor:
    def __init__(self, territories: list[str]) -> None:
        self.territories = territories
        self.statements: list[str] = []

    def execute(self, statement: str) -> None:
        self.statements.append(statement)

    def fetchall(self) -> list[tuple[str]]:
        return [(territory,) for territory in self.territories]

    def fetchone(self) -> tuple[bool]:
        return (False,)


class Store:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.calls: list[tuple[str, int]] = []

    def list_for(self, user_id: str, limit: int) -> list[dict[str, Any]]:
        self.calls.append((user_id, limit))
        return self.rows


def row(**overrides: Any) -> dict[str, Any]:
    return {
        "thread_id": "thread-1",
        "run_id": "run-1",
        "user_message": "What changed?",
        "assistant_text": "Two calls changed.",
        "generated_at": "2026-11-04T09:30:00Z",
        "scope_territory_ids": ["T01-01"],
        "facts": [],
        "evidence": [],
        "visuals": [],
        "surfaces": [],
        "suggestions": [],
        **overrides,
    }


def test_history_queries_only_the_verified_users_partition_and_rechecks_scope() -> None:
    cur = Cursor(["T01-01"])
    store = Store([row(), row(run_id="lost-scope", scope_territory_ids=["T02-01"])])

    result = chat_history.my_chat_history(cur, None, "cognito|u1", {"limit": 10}, store=store)

    assert store.calls == [("cognito|u1", 10)]
    assert "current_scope_territories" in cur.statements[0]
    assert [turn["runId"] for turn in result] == ["run-1"]
    assert json.loads(result[0]["payload"])["facts"] == []


@pytest.mark.parametrize("limit", [0, 101, True, "10"])
def test_history_rejects_invalid_limits_before_the_dynamo_query(limit: object) -> None:
    store = Store([row()])
    with pytest.raises(BadRequest):
        chat_history.my_chat_history(Cursor(["T01-01"]), None, "u1", {"limit": limit}, store=store)
    assert store.calls == []


def test_history_drops_legacy_turns_without_a_scope_snapshot() -> None:
    result = chat_history.my_chat_history(Cursor(["T01-01"]), None, "u1", {}, store=Store([row(scope_territory_ids=None)]))
    assert result == []


def test_aggregate_only_executive_cannot_restore_an_old_record_level_answer() -> None:
    cur = Cursor(["T01-01"])
    store = Store([row()])
    result = chat_history.my_chat_history(cur, SimpleNamespace(persona="executive"), "u1", {}, store=store)
    assert result == [] and store.calls == []
