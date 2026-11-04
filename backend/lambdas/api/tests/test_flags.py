"""Flag validation and de-duplication, with a fake cursor and an in-memory store.

The behaviour that matters (scope, storage in FE DynamoDB, status) is proven through the API
in tests/api/test_flags.py; these cover the checks that run before anything is read or written.
"""

from __future__ import annotations

import datetime as dt

import pytest

from a2g_api.errors import BadRequest
from a2g_api.flags import flag_issue, my_flags


class Store:
    def __init__(self) -> None:
        self.items: list[dict] = []

    def list_for(self, user_id: str) -> list[dict]:
        return [i for i in reversed(self.items) if i["userId"] == user_id]

    def put(self, item: dict) -> None:
        self.items.append(item)


class Cursor:
    """Every target is visible; every other query returns a fixed row."""

    def execute(self, *_a, **_k) -> None:
        pass

    def fetchone(self):
        return (1,)


def raise_flag(store: Store, **fields):
    return flag_issue(Cursor(), None, "u1", {"input": fields}, store=store, now=dt.datetime(2026, 11, 3, tzinfo=dt.UTC))


@pytest.fixture(autouse=True)
def stub_scope(monkeypatch):
    monkeypatch.setattr("a2g_api.flags._scope", lambda cur, identity: ([], 1, "T01-01"))
    monkeypatch.setattr("a2g_api.flags._data_through", lambda cur: dt.datetime(2026, 11, 3, 12, tzinfo=dt.UTC))


@pytest.mark.parametrize(
    "fields",
    [
        {"kind": "SUMMARY", "targetType": "HCP", "targetId": "x"},
        {"kind": "NOPE", "targetType": "SUMMARY", "targetId": "x"},
        {"kind": "SUMMARY", "targetType": "SUMMARY", "targetId": "bad id"},
        {"kind": "SUMMARY", "targetType": "SUMMARY", "targetId": "ok", "note": "x" * 501},
        {"kind": "SUMMARY", "targetType": "SUMMARY", "targetId": "ok", "note": 7},
    ],
)
def test_invalid_input_writes_nothing(fields):
    store = Store()
    with pytest.raises(BadRequest):
        raise_flag(store, **fields)
    assert store.items == []


def test_note_is_trimmed_and_control_characters_removed():
    store = Store()
    flag = raise_flag(store, kind="SUMMARY", targetType="SUMMARY", targetId="brief:1", note="  hi\x00 there \n")
    assert flag["note"] == "hi there"
    assert flag["status"] == "OPEN" and flag["scopeLabel"] == "T01-01"
    assert store.items[0]["pk"] == "USER#u1"


def test_blank_note_is_not_stored():
    store = Store()
    flag = raise_flag(store, kind="SUMMARY", targetType="SUMMARY", targetId="brief:1", note="   ")
    assert flag["note"] is None and "note" not in {k for k, v in store.items[0].items() if v is not None}


def test_duplicate_open_flag_returns_the_existing_one():
    store = Store()
    first = raise_flag(store, kind="SUMMARY", targetType="SUMMARY", targetId="brief:1")
    again = raise_flag(store, kind="SUMMARY", targetType="SUMMARY", targetId="brief:1")
    assert again["flagId"] == first["flagId"] and len(store.items) == 1
    store.items[0]["status"] = "RESOLVED"
    assert raise_flag(store, kind="SUMMARY", targetType="SUMMARY", targetId="brief:1")["flagId"] != first["flagId"]


def test_listing_never_returns_another_users_items():
    store = Store()
    raise_flag(store, kind="SUMMARY", targetType="SUMMARY", targetId="brief:1")
    store.items.append({**store.items[0], "userId": "u2", "flagId": "other"})
    assert [f["flagId"] for f in my_flags(Cursor(), None, "u1", {}, store=store)] != ["other"]
