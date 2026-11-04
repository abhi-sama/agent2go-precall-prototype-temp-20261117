"""Executive themes, matrix and leadership summaries against a real migrated and seeded Postgres.

Skipped unless ``A2G_OWNER_DB_URL`` points at one (backend/infra/scripts/test.sh sets it). The full path through
Cognito and AppSync is proven in tests/api/test_executive_themes.py; this file proves the Lambda logic straight
against RLS, with a fake agent runtime and an in-memory store standing in for AgentCore and FE DynamoDB.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import os
import re
from typing import Any

import psycopg
import pytest

from a2g_api import executive_themes, leadership
from a2g_api.errors import BadRequest, Forbidden, NoScope, NotFound
from a2g_api.identity import Identity

OWNER_DSN = os.environ.get("A2G_OWNER_DB_URL")
pytestmark = pytest.mark.skipif(not OWNER_DSN, reason="needs a migrated, seeded Postgres (A2G_OWNER_DB_URL)")

FROM, TO = "2026-08-01", "2026-10-31"
EXEC = Identity("sub-exec", "executive", "Executive", "Exec One", "exec@example.test", "header")
MSL = Identity("sub-msl", "msl", "MSL", "Msl One", "msl@example.test", "header")


def app_dsn() -> str:
    return re.sub(r"//[^@]+@", "//app_user:app_user@", OWNER_DSN or "")


@contextlib.contextmanager
def session(user_id: str, persona: str = "Executive"):
    with psycopg.connect(app_dsn()) as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("SELECT app.set_request_identity(%s, %s, %s)", (user_id, persona, "test-corr"))
        yield cur


@pytest.fixture
def owner():
    with psycopg.connect(OWNER_DSN, autocommit=True) as conn:
        yield conn


@contextlib.contextmanager
def extra_regions(owner, user_id: str, regions: list[str]):
    """Give an Executive further explicit regions for a test, then take them away."""
    for region in regions:
        owner.execute(
            "INSERT INTO user_scope_assignments(user_id, territory_id, assignment_type, effective_from) "
            "VALUES (%s, %s, 'executive', '2024-01-01T00:00:00Z')",
            (user_id, region),
        )
    try:
        yield
    finally:
        owner.execute("DELETE FROM user_scope_assignments WHERE user_id = %s AND territory_id = ANY(%s)", (user_id, regions))


@contextlib.contextmanager
def record_permission(owner, user_id: str):
    owner.execute("INSERT INTO roles VALUES ('test-t13-records', 'Executive with record-level drill-down')")
    owner.execute("INSERT INTO role_permissions VALUES ('test-t13-records', 'source.records.read')")
    owner.execute(
        "INSERT INTO user_role_assignments(user_id, role_id, effective_from) VALUES (%s, 'test-t13-records', now() - interval '1 minute')",
        (user_id,),
    )
    try:
        yield
    finally:
        owner.execute("DELETE FROM user_role_assignments WHERE role_id = 'test-t13-records'")
        owner.execute("DELETE FROM role_permissions WHERE role_id = 'test-t13-records'")
        owner.execute("DELETE FROM roles WHERE role_id = 'test-t13-records'")


class MemoryStore:
    def __init__(self) -> None:
        self.items: dict[tuple[str, str], dict[str, Any]] = {}

    def get(self, user_id: str, summary_id: str) -> dict[str, Any] | None:
        return self.items.get((user_id, summary_id))

    def list_for(self, user_id: str) -> list[dict[str, Any]]:
        return [v for (u, _s), v in sorted(self.items.items(), reverse=True) if u == user_id]


class FakeRuntime:
    """Plays the agent: restates the facts it is given and saves the item, exactly like the stub runner."""

    def __init__(self, store: MemoryStore) -> None:
        self.store = store
        self.tasks: list[dict[str, Any]] = []

    def invoke(self, payload: dict[str, Any], *, timeout: float):
        task = payload["task"]
        self.tasks.append(task)
        user_id = payload["identity"]["user_id"]
        statements = [
            {"statementId": f"s-{i}", "section": f["section"], "text": f["text"], "citationIds": f["citation_ids"]}
            for i, f in enumerate(task["facts"], 1)
        ]
        self.store.items[(user_id, task["summary_id"])] = {
            "pk": f"USER#{user_id}",
            "sk": f"SUMMARY#{task['summary_id']}",
            "summaryId": task["summary_id"],
            "ownerUserId": user_id,
            "title": task["title"],
            "from": task["from_date"],
            "to": task["to_date"],
            "dataThrough": task["data_through"],
            "generatedAt": "2026-11-04T10:00:00Z",
            "scopeLabel": task["scope_label"],
            "scopeTerritoryIds": task["scope_territory_ids"],
            "accessLevel": task["access_level"],
            "definitionVersion": task["definition_version"],
            "modelMode": "stub",
            "numberCheck": "unchecked",
            "droppedStatements": 0,
            "keyFigures": task["key_figures"],
            "statements": statements,
            "sampleLimitations": task["sample_limitations"],
            "definitions": task["definitions"],
            "citations": task["evidence"],
            "disclosure": task["disclosure"],
        }
        yield {"type": "CUSTOM", "name": "summary_saved", "value": {"saved": True}}
        yield {"type": "RUN_FINISHED"}


def generate(cur, store, runtime, **args):
    return leadership.generate_leadership_summary(
        cur, EXEC, "executive-region-01", {"from": FROM, "to": TO, **args}, store=store, runtime=runtime, correlation_id="c1"
    )


def test_themes_and_matrix_are_aggregate_only_and_scoped_to_the_explicit_region(owner):
    with extra_regions(owner, "executive-region-01", ["REGION-02", "REGION-03"]):
        with session("executive-region-01") as cur:
            themes = executive_themes.executive_themes(cur, EXEC, "executive-region-01", {"from": FROM, "to": TO, "facet": "MOLECULE"})
            matrix = executive_themes.executive_topic_matrix(cur, EXEC, "executive-region-01", {"from": FROM, "to": TO})
    assert themes["accessLevel"] == "AGGREGATE_ONLY" and themes["facet"] == "MOLECULE" and len(themes["groups"]) == 4
    assert [r["regionId"] for r in matrix["regions"]] == ["REGION-01", "REGION-02", "REGION-03"]
    ctdna = next(r for r in matrix["rows"] if r["topic"].startswith("ctDNA"))
    assert ctdna["crossRegion"] is True and ctdna["regionsRising"] >= 2


def test_nothing_is_served_to_other_personas_or_to_an_executive_without_an_assignment(owner):
    with session("msl-t01-01", "MSL") as cur:
        with pytest.raises(Forbidden):
            executive_themes.executive_themes(cur, MSL, "msl-t01-01", {})
    owner.execute("UPDATE user_scope_assignments SET effective_to = now() - interval '1 day' WHERE user_id = 'executive-region-02'")
    try:
        with session("executive-region-02") as cur:
            with pytest.raises(NoScope):
                executive_themes.executive_topic_matrix(cur, EXEC, "executive-region-02", {})
    finally:
        owner.execute("UPDATE user_scope_assignments SET effective_to = NULL WHERE user_id = 'executive-region-02'")


def test_bad_arguments_are_refused():
    with session("executive-region-01") as cur:
        for args in ({"facet": "TEAM"}, {"facet": "STUDY", "facetValue": "no such study"}, {"from": TO, "to": FROM}, {"facetValue": "x" * 200}):
            with pytest.raises(BadRequest):
                executive_themes.executive_topic_matrix(cur, EXEC, "executive-region-01", args)


def test_a_summary_is_generated_saved_listed_reopened_and_exported_with_an_audit_row(owner):
    store = MemoryStore()
    runtime = FakeRuntime(store)
    with session("executive-region-01") as cur:
        created = generate(cur, store, runtime)
        task = runtime.tasks[0]
        assert task["type"] == "leadership_summary" and task["access_level"] == "AGGREGATE_ONLY"
        assert task["scope_territory_ids"] == sorted(task["scope_territory_ids"]) and len(task["scope_territory_ids"]) == 6
        assert {f["section"] for f in task["facts"]} == {"overview", "themes", "crossRegion"}
        cited = {c["citationId"] for c in task["evidence"]}
        assert all(set(f["citation_ids"]) <= cited for f in task["facts"])
        assert created["from"] == FROM and created["to"] == TO and created["stale"] is False
        assert created["sampleLimitations"] and created["definitions"] and created["citations"]
        assert [k["label"] for k in created["keyFigures"]][:3] == ["Distinct calls", "Responses", "Engaged HCPs"]

        listed = leadership.my_leadership_summaries(cur, EXEC, "executive-region-01", {}, store=store)
        assert [(i["summaryId"], i["accessible"], i["stale"]) for i in listed] == [(created["summaryId"], True, False)]
        reopened = leadership.get_leadership_summary(cur, EXEC, "executive-region-01", {"summaryId": created["summaryId"]}, store=store)
        assert reopened["summaryId"] == created["summaryId"]

        doc = leadership.export_leadership_summary(cur, EXEC, "executive-region-01", {"summaryId": created["summaryId"]}, store=store)
        assert doc["from"] == FROM and doc["to"] == TO and doc["exportedAt"] and doc["definitions"] and doc["disclosureText"]
        assert doc["citations"] and doc["statements"] and doc["sampleLimitations"]
    (audit,) = owner.execute(
        "SELECT count(*) FROM audit_events WHERE action = 'leadership_summary.exported' AND resource_id = %s", (created["summaryId"],)
    ).fetchone()
    assert audit == 1
    owner.execute("DELETE FROM audit_events WHERE action = 'leadership_summary.exported' AND resource_id = %s", (created["summaryId"],))


def test_open_and_export_recheck_access_when_a_territory_leaves_the_scope(owner):
    store = MemoryStore()
    runtime = FakeRuntime(store)
    with extra_regions(owner, "executive-region-01", ["REGION-02"]):
        with session("executive-region-01") as cur:
            created = generate(cur, store, runtime)
    # REGION-02 is no longer in the Executive's explicit scope.
    with session("executive-region-01") as cur:
        with pytest.raises(Forbidden):
            leadership.get_leadership_summary(cur, EXEC, "executive-region-01", {"summaryId": created["summaryId"]}, store=store)
        with pytest.raises(Forbidden):
            leadership.export_leadership_summary(cur, EXEC, "executive-region-01", {"summaryId": created["summaryId"]}, store=store)
        (item,) = leadership.my_leadership_summaries(cur, EXEC, "executive-region-01", {}, store=store)
        assert item["accessible"] is False and item["title"] is None and item["from"] is None
    (audit,) = owner.execute(
        "SELECT count(*) FROM audit_events WHERE action = 'leadership_summary.exported' AND resource_id = %s", (created["summaryId"],)
    ).fetchone()
    assert audit == 0, "a refused export leaves no audit row and no document"


def test_a_summary_with_record_level_material_is_refused_once_the_permission_is_withdrawn(owner):
    store = MemoryStore()
    runtime = FakeRuntime(store)
    with record_permission(owner, "executive-region-01"):
        with session("executive-region-01") as cur:
            created = generate(cur, store, runtime)
            assert created["accessLevel"] == "RECORD_DRILLDOWN" and created["disclosure"]["applied"] is False
            assert any(c["kind"] == "RECORD" for c in created["citations"])
    with session("executive-region-01") as cur:
        with pytest.raises(Forbidden):
            leadership.export_leadership_summary(cur, EXEC, "executive-region-01", {"summaryId": created["summaryId"]}, store=store)


def test_another_users_summary_and_unknown_ids_look_the_same():
    store = MemoryStore()
    runtime = FakeRuntime(store)
    with session("executive-region-01") as cur:
        created = generate(cur, store, runtime)
    with session("executive-region-02") as cur:
        for sid in (created["summaryId"], "ls-20260101000000-deadbeef"):
            with pytest.raises(NotFound):
                leadership.get_leadership_summary(cur, EXEC, "executive-region-02", {"summaryId": sid}, store=store)
        with pytest.raises(BadRequest):
            leadership.export_leadership_summary(cur, EXEC, "executive-region-02", {"summaryId": "../etc"}, store=store)


def test_newer_data_marks_a_saved_summary_stale():
    store = MemoryStore()
    runtime = FakeRuntime(store)
    with session("executive-region-01") as cur:
        created = generate(cur, store, runtime)
        item = store.items[("executive-region-01", created["summaryId"])]
        item["dataThrough"] = (dt.datetime.fromisoformat(item["dataThrough"].replace("Z", "+00:00")) - dt.timedelta(days=2)).isoformat()
        reopened = leadership.get_leadership_summary(cur, EXEC, "executive-region-01", {"summaryId": created["summaryId"]}, store=store)
    assert reopened["stale"] is True and reopened["staleReasons"] == ["NEWER_DATA_LOADED"]


def test_the_evidence_handed_to_the_agent_holds_no_withheld_number(owner):
    """Small cells never reach the model: every fact is built only from values the API would show."""
    store = MemoryStore()
    runtime = FakeRuntime(store)
    with session("executive-region-01") as cur:
        generate(cur, store, runtime, **{"from": "2026-10-20", "to": "2026-10-31"})  # a short window: small groups everywhere
    task = runtime.tasks[0]
    assert task["facts"], "the window still has figures to restate"
    counted = re.compile(r"(?<![\w.%-])([1-4])(?:,\d+)?\s+(?:of\b|responses?\b|free-text\b|distinct\b|insight\b|HCPs?\b)")
    for fact in task["facts"]:
        assert not counted.search(fact["text"]), fact["text"]
    for figure in task["key_figures"]:
        assert figure["value"]["value"] is None or not 1 <= figure["value"]["value"] <= 4
