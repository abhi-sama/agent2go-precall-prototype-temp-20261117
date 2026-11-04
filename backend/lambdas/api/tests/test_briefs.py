"""Brief validation, staleness and edit rules, with a fake store and cursor.

What matters end to end (scope, FE DynamoDB, reopen after reassignment, regenerate after a reload) is
proven through the API as personas in tests/api/test_precall_brief.py; these cover the checks that run
before anything is read or written.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

import pytest

from a2g_api import briefs
from a2g_api.errors import BadRequest, Forbidden, NotFound, Unavailable

NOW = dt.datetime(2026, 11, 4, 10, 0, tzinfo=dt.UTC)
BRIEF_ID = "br-20261104093000-0a1b2c3d"


def saved(**overrides: Any) -> dict[str, Any]:
    base = {
        "briefId": BRIEF_ID,
        "ownerUserId": "u1",
        "hcpId": "HCP-0001",
        "objective": "Discuss access",
        "scopeLabel": "T01-01",
        "dataThrough": "2026-11-03T08:00:00Z",
        "generatedAt": "2026-11-04T09:30:00Z",
        "fingerprint": {"hcpLoadedThrough": "2026-11-03T08:00:00Z", "callCount": 2, "responseCount": 3},
        "evidence": [{"evidenceId": "call:C1", "dataset": "call_activity", "recordId": "C1", "label": "Call", "date": "2026-11-03"}],
        "engagement": [{"statementId": "s-e1", "text": "Call on 2026-11-03.", "evidenceIds": ["call:C1"]}],
        "prompts": [{"itemId": "g-q1", "text": "Ask?", "detail": None, "evidenceIds": ["call:C1"], "origin": "GENERATED", "edited": False}],
        "agenda": [{"itemId": "g-a1", "text": "Open", "detail": "d", "evidenceIds": [], "origin": "GENERATED", "edited": False}],
    }
    return {**base, **overrides}


class Store:
    def __init__(self, *items: dict[str, Any]) -> None:
        self.items = {(i["ownerUserId"], i["briefId"]): i for i in items}
        self.updates: list[dict[str, Any]] = []

    def get(self, user_id, brief_id):
        return self.items.get((user_id, brief_id))

    def list_for(self, user_id):
        return [i for (u, _), i in self.items.items() if u == user_id]

    def update_edits(self, user_id, brief_id, changes):
        if (user_id, brief_id) not in self.items:
            return False
        self.updates.append(changes)
        self.items[(user_id, brief_id)] = {**self.items[(user_id, brief_id)], **changes}
        return True


class Cursor:
    def __init__(self) -> None:
        self.rows: list[Any] = []
        self.statements: list[tuple[Any, Any]] = []

    def execute(self, *args, **kwargs) -> None:
        self.statements.append((args, kwargs))

    def fetchone(self):
        return None

    def fetchall(self):
        return []


@pytest.fixture
def world(monkeypatch):
    """Authorization, fingerprint and data-through are the things each test flips."""
    state = {
        "allowed": True,
        "fingerprint": {"hcpLoadedThrough": "2026-11-03T08:00:00Z", "callCount": 2, "responseCount": 3},
        "through": dt.datetime(2026, 11, 3, 8, tzinfo=dt.UTC),
    }

    def authorize(cur, identity, hcp_id):
        if not state["allowed"]:
            raise Forbidden("hcp_not_in_scope")
        return ("HCP-0001", "Dr Test", None, None, None, "Clinic", None, "T01-01")

    monkeypatch.setattr(briefs, "_authorize", authorize)
    monkeypatch.setattr(briefs, "source_fingerprint", lambda cur, hcp: dict(state["fingerprint"]))
    monkeypatch.setattr(briefs, "_data_through", lambda cur: state["through"])
    return state


def test_a_current_brief_is_not_stale(world):
    out = briefs.get_brief(Cursor(), None, "u1", {"briefId": BRIEF_ID}, store=Store(saved()))
    assert out["stale"] is False and out["staleReasons"] == []
    assert out["hcpName"] == {"value": "Dr Test", "state": "PRESENT"}


def test_sub_second_load_times_do_not_make_an_unchanged_brief_stale(world):
    world["through"] = dt.datetime(2026, 11, 3, 8, 0, 0, 456789, tzinfo=dt.UTC)
    out = briefs.get_brief(Cursor(), None, "u1", {"briefId": BRIEF_ID}, store=Store(saved()))
    assert out["stale"] is False


def test_new_hcp_data_or_a_newer_load_marks_the_brief_stale(world):
    world["fingerprint"]["responseCount"] = 4
    out = briefs.get_brief(Cursor(), None, "u1", {"briefId": BRIEF_ID}, store=Store(saved()))
    assert out["stale"] and out["staleReasons"] == ["HCP_DATA_CHANGED"]

    world["fingerprint"]["responseCount"] = 3
    world["through"] = dt.datetime(2026, 11, 4, 1, tzinfo=dt.UTC)
    out = briefs.get_brief(Cursor(), None, "u1", {"briefId": BRIEF_ID}, store=Store(saved()))
    assert out["staleReasons"] == ["NEWER_DATA_LOADED"]
    assert out["currentDataThrough"] == "2026-11-04T01:00:00Z"


def test_reopening_after_access_was_lost_is_denied_and_listed_without_detail(world):
    world["allowed"] = False
    store = Store(saved())
    with pytest.raises(Forbidden):
        briefs.get_brief(Cursor(), None, "u1", {"briefId": BRIEF_ID}, store=store)
    with pytest.raises(Forbidden):
        briefs.save_brief_edits(Cursor(), None, "u1", {"input": {"briefId": BRIEF_ID, "objective": "new objective"}}, store=store)
    (row,) = briefs.my_briefs(Cursor(), None, "u1", {}, store=store)
    assert row["accessible"] is False
    assert row["hcpId"] is None and row["hcpName"] is None and row["objective"] is None


def test_export_rechecks_access_returns_print_fields_and_records_an_id_only_audit_event(world):
    cur = Cursor()
    out = briefs.export_brief(cur, None, "u1", {"briefId": BRIEF_ID}, store=Store(saved()), now=lambda: NOW)
    assert out["scopeLabel"] == "T01-01"
    assert out["dateRangeFrom"] == out["dateRangeTo"] == "2026-11-03"
    assert out["generatedAt"] == "2026-11-04T09:30:00Z"
    assert out["exportedAt"] == "2026-11-04T10:00:00Z"
    assert out["citations"] == [saved()["evidence"][0]]
    audit = cur.statements[-1][0]
    assert "INSERT INTO audit_events" in audit[0]
    assert audit[1] == ("u1", "brief.exported", "pre_call_brief", BRIEF_ID, "allowed")

    world["allowed"] = False
    with pytest.raises(Forbidden):
        briefs.export_brief(Cursor(), None, "u1", {"briefId": BRIEF_ID}, store=Store(saved()), now=lambda: NOW)


def test_another_users_brief_is_indistinguishable_from_an_unknown_one(world):
    store = Store(saved(ownerUserId="someone-else"))
    with pytest.raises(NotFound):
        briefs.get_brief(Cursor(), None, "u1", {"briefId": BRIEF_ID}, store=store)
    # Even if a store returned a foreign item, presenting it is refused.
    with pytest.raises(NotFound):
        briefs.present(Cursor(), None, "u1", saved(ownerUserId="someone-else"))


@pytest.mark.parametrize("brief_id", [None, "", "x", "br-1", "BR-20261104093000-0a1b2c3d", "br-20261104093000-ZZZZZZZZ"])
def test_malformed_brief_ids_are_rejected(world, brief_id):
    with pytest.raises(BadRequest):
        briefs.get_brief(Cursor(), None, "u1", {"briefId": brief_id}, store=Store())


@pytest.mark.parametrize("objective", [None, "", "  ", "ab", "x" * 501, 7])
def test_objective_must_be_present_and_bounded(world, objective):
    with pytest.raises(BadRequest):
        briefs.generate_brief(
            Cursor(), None, "u1", {"hcpId": "HCP-0001", "objective": objective}, store=Store(), runtime=None, correlation_id="c"
        )


def test_generate_fails_loudly_when_the_agent_did_not_save():
    class Runtime:
        def invoke(self, payload, *, timeout=None):
            yield {"type": "CUSTOM", "name": "brief_saved", "value": {"saved": False}}
            yield {"type": "RUN_FINISHED"}

    # Authorization and evidence are stubbed out by running against a throwaway cursor.
    import a2g_api.briefs as module

    original = (module._authorize, module._data_through, module._scope, module.build_evidence, module.source_fingerprint)
    module._authorize = lambda cur, identity, hcp: ("HCP-0001", "n", None, None, None, None, None, None)
    module._data_through = lambda cur: None
    module._scope = lambda cur, identity: ([], 1, "T01-01")
    module.build_evidence = lambda cur, hcp, profile, through: {"calls": [], "responses": [], "follow_ups": [], "facts": [], "missing": [], "evidence": [], "last_interaction_date": None}
    module.source_fingerprint = lambda cur, hcp: {"hcpLoadedThrough": None, "callCount": 0, "responseCount": 0}

    class Identity:
        db_persona = "MSL"
        full_name = "n"
        email = "e"

    try:
        with pytest.raises(Unavailable):
            briefs.generate_brief(
                Cursor(), Identity(), "u1", {"hcpId": "HCP-0001", "objective": "Discuss access"}, store=Store(), runtime=Runtime(), correlation_id="c"
            )
    finally:
        module._authorize, module._data_through, module._scope, module.build_evidence, module.source_fingerprint = original


def edit(store: Store, **fields):
    return briefs.save_brief_edits(Cursor(), None, "u1", {"input": {"briefId": BRIEF_ID, **fields}}, store=store, now=lambda: NOW)


def test_editing_keeps_generated_items_marked_generated_and_flags_what_changed(world):
    store = Store(saved())
    out = edit(
        store,
        objective="New objective",
        prompts=[{"itemId": "g-q1", "text": "Ask a better question?"}, {"text": "My own question"}],
        agenda=[{"itemId": "g-a1", "text": "Open", "detail": "d"}],
    )
    assert out["objective"] == "New objective" and out["updatedAt"] == "2026-11-04T10:00:00Z"
    generated, mine = out["prompts"]
    assert generated["origin"] == "GENERATED" and generated["edited"] is True
    assert generated["evidenceIds"] == ["call:C1"]  # an edit cannot add or change citations
    assert mine["origin"] == "USER" and mine["evidenceIds"] == [] and mine["itemId"].startswith("u-")
    assert out["agenda"][0]["edited"] is False  # unchanged text is not marked edited


def test_edits_cannot_claim_generated_ids_or_overflow(world):
    with pytest.raises(BadRequest):
        edit(Store(saved()), prompts=[{"itemId": "g-q99", "text": "Forged generated item"}])
    with pytest.raises(BadRequest):
        edit(Store(saved()), agenda=[{"text": f"item {i}"} for i in range(13)])
    with pytest.raises(BadRequest):
        edit(Store(saved()), prompts=[{"itemId": "g-q1", "text": "a"}, {"itemId": "g-q1", "text": "b"}])
    with pytest.raises(BadRequest):
        edit(Store(saved()), prompts=[{"text": ""}])
    with pytest.raises(BadRequest):
        edit(Store(saved()))  # nothing to save
    store = Store(saved())
    assert store.updates == []


def test_stale_comparison_handles_missing_history(world):
    assert briefs._stale_reasons({}, {"hcpLoadedThrough": None, "callCount": 0, "responseCount": 0}, None) == ["HCP_DATA_CHANGED"]
    assert briefs._parse_dt("2026-11-03T08:00:00Z") == dt.datetime(2026, 11, 3, 8, tzinfo=dt.UTC)
    assert briefs._parse_dt("garbage") is None
