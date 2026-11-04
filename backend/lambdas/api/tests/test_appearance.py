"""The saved appearance: validated choices, owner-keyed storage, kept out of the saved-view list.

Proven end to end through AppSync in tests/api/test_appearance.py; these cover the checks that run before storage.
"""

from __future__ import annotations

from typing import Any

import boto3
import pytest

from a2g_api import resolvers
from a2g_api.errors import BadRequest
from a2g_api.saved_views import APPEARANCE_KEY, SavedViews
from a2g_api.settings import Settings


class FakeDynamo:
    """Just enough of the DynamoDB client: items keyed by (owner, sort key), and the query arguments recorded."""

    def __init__(self) -> None:
        self.items: dict[tuple[str, str], dict[str, Any]] = {}
        self.queries: list[dict[str, Any]] = []

    def put_item(self, TableName: str, Item: dict[str, Any], **_k: Any) -> None:
        self.items[(Item["ownerUserId"]["S"], Item["savedViewId"]["S"])] = Item

    def get_item(self, TableName: str, Key: dict[str, Any], **_k: Any) -> dict[str, Any]:
        item = self.items.get((Key["ownerUserId"]["S"], Key["savedViewId"]["S"]))
        return {"Item": item} if item else {}

    def query(self, **kwargs: Any) -> dict[str, Any]:
        self.queries.append(kwargs)
        owner = kwargs["ExpressionAttributeValues"][":owner"]["S"]
        return {"Items": [i for (o, _sk), i in self.items.items() if o == owner]}


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> tuple[SavedViews, FakeDynamo]:
    fake = FakeDynamo()
    monkeypatch.setattr(boto3, "client", lambda *_a, **_k: fake)
    settings = Settings.from_env(
        {"A2G_ENV": "local", "A2G_COGNITO_ISSUER": "http://issuer.test", "A2G_COGNITO_CLIENT_IDS": "client", "A2G_DB_DSN": "postgresql://unused", "A2G_SAVED_VIEWS_TABLE": "views"}
    )
    return SavedViews(settings), fake


CHOICE = {"style": "clinical", "mode": "black", "density": "compact"}


def test_nothing_saved_means_no_preference(store):
    views, _ = store
    assert views.get_appearance("u1") is None


def test_a_choice_round_trips_for_its_owner_only(store):
    views, fake = store
    saved = views.set_appearance("u1", CHOICE)
    assert {k: saved[k] for k in CHOICE} == CHOICE
    assert views.get_appearance("u1") == saved
    assert views.get_appearance("u2") is None
    assert ("u1", APPEARANCE_KEY) in fake.items


def test_saving_again_replaces_the_choice(store):
    views, _ = store
    views.set_appearance("u1", CHOICE)
    views.set_appearance("u1", {"style": "auto", "mode": "device", "density": "auto"})
    assert views.get_appearance("u1")["mode"] == "device"


@pytest.mark.parametrize(
    "bad",
    [
        {**CHOICE, "style": "neon"},
        {**CHOICE, "mode": "dark"},
        {**CHOICE, "density": "tiny"},
        {"style": "warm", "mode": "light"},
        {**CHOICE, "style": None},
    ],
)
def test_unknown_values_are_refused_and_nothing_is_stored(store, bad):
    views, fake = store
    with pytest.raises(BadRequest):
        views.set_appearance("u1", bad)
    assert fake.items == {}


def test_the_resolver_requires_an_input_object(store):
    views, _ = store
    with pytest.raises(BadRequest):
        resolvers.set_appearance(None, None, "u1", {}, store=views)


def test_the_preference_never_appears_in_saved_views(store):
    views, _ = store
    views.set_appearance("u1", CHOICE)
    views.save("u1", {"name": "Lung pulse", "reportKind": "insight-discovery", "filters": {"questionId": "Q-1"}})
    listed = views.list("u1")
    assert [v["name"] for v in listed] == ["Lung pulse"]
