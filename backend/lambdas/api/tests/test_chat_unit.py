"""Chat field validation, worker relay and agent client framing, without a database or network."""

from __future__ import annotations

import json
import datetime as dt
from typing import Any

import pytest

from a2g_api import chat, chat_worker
from a2g_api.agent_client import AgentCoreRuntime, parse_sse
from a2g_api.errors import BadRequest, Unavailable
from a2g_api.identity import Identity
from a2g_api.settings import Settings

IDENTITY = Identity("cognito|s", "msl", "MSL", "Avery Clinician", "avery@example.test", "header")
RUN = "11111111-1111-1111-1111-111111111111"
THREAD = "22222222-2222-2222-2222-222222222222"


class Cursor:
    def __init__(self, insert_returns: Any = (RUN,)) -> None:
        self.sql: list[str] = []
        self._ret = insert_returns

    def execute(self, sql: str, params: Any = None) -> None:
        self.sql.append(" ".join(sql.split()))

    def fetchone(self) -> Any:
        return self._ret


def start(cur: Cursor, invoker, **args: Any) -> dict[str, Any]:
    base = {"threadId": THREAD, "runId": RUN, "message": "How many calls?"}
    return chat.start_chat_run(cur, IDENTITY, "msl-t01-01", {**base, **args}, worker_function="a2g-be-chat", correlation_id="c1", invoker=invoker)


def test_start_records_the_run_and_hands_the_verified_caller_to_the_worker() -> None:
    sent: list[tuple[str, dict]] = []
    result = start(Cursor(), lambda fn, payload: sent.append((fn, payload)), history=[{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}])
    assert result == {"runId": RUN, "status": "RUNNING"}
    [(fn, payload)] = sent
    assert fn == "a2g-be-chat"
    assert payload["user_id"] == "msl-t01-01" and payload["persona"] == "MSL"
    assert [m["role"] for m in payload["messages"]] == ["user", "assistant", "user"]
    assert payload["messages"][-1]["content"] == "How many calls?"


@pytest.mark.parametrize(
    "bad",
    [{"message": ""}, {"message": "x" * 2001}, {"runId": "short"}, {"threadId": "../etc"}, {"history": "nope"}, {"history": [{"role": "system", "content": "x"}]}],
)
def test_bad_arguments_are_refused_before_anything_starts(bad) -> None:
    sent: list = []
    with pytest.raises(BadRequest):
        start(Cursor(), lambda *a: sent.append(a), **bad)
    assert not sent


def test_a_taken_run_id_is_refused() -> None:
    with pytest.raises(BadRequest):
        start(Cursor(insert_returns=None), lambda *a: None)


def test_a_worker_that_cannot_start_fails_the_run() -> None:
    cur = Cursor()

    def boom(*_: Any) -> None:
        raise RuntimeError("down")

    with pytest.raises(Unavailable):
        start(cur, boom)
    assert any("status = 'failed'" in s for s in cur.sql)


def test_export_audit_is_written_only_after_the_record_access_lookup(monkeypatch) -> None:
    class CitationCursor:
        def __init__(self) -> None: self.sql: list[str] = []; self.params: list[Any] = []
        def execute(self, sql: str, params: Any = None) -> None: self.sql.append(" ".join(sql.split())); self.params.append(params)
        def fetchone(self) -> Any:
            if "has_permission" in self.sql[-1]: return (True,)
            if "FROM call_activity" in self.sql[-1]: return (dt.date(2026, 11, 3), "scientific", "field", 30, "T01-01", "HCP-1", ["Product"], None)
            return None
    cur = CitationCursor()
    result = chat.chat_citation(cur, IDENTITY, "msl-t01-01", {"dataset": "call_activity", "recordId": "CALL-00001", "auditExport": True})
    assert result["recordId"] == "CALL-00001"
    assert "INSERT INTO audit_events" in cur.sql[-1]
    assert cur.params[-1][1] == "chat_rows.exported"


def test_parse_sse_keeps_only_well_formed_events() -> None:
    lines = [b": ping\n", b'data: {"type":"RUN_STARTED"}\n', b"\n", b"data: not json\n", b'data: {"no":"type"}\n', b'data: {"type":"RUN_FINISHED"}\n']
    assert [e["type"] for e in parse_sse(lines)] == ["RUN_STARTED", "RUN_FINISHED"]


class FakeRuntime:
    def __init__(self, events: list[dict], fail: bool = False) -> None:
        self.events, self.fail, self.payload = events, fail, None

    def invoke(self, payload: dict):
        self.payload = payload
        yield from self.events
        if self.fail:
            raise ConnectionError("agent gone")


def settings() -> Settings:
    return Settings.from_env(
        {"A2G_ENV": "aws", "A2G_COGNITO_ISSUER": "http://i", "A2G_COGNITO_CLIENT_IDS": "c", "A2G_DB_DSN": "postgresql://x"}
    )


PAYLOAD = {
    "user_id": "msl-t01-01", "persona": "MSL", "full_name": "A", "email": "a@x.test", "correlation_id": "c1",
    "thread_id": THREAD, "run_id": RUN, "messages": [{"role": "user", "content": "q"}],
}


def test_worker_stores_every_event_in_order_and_stops_at_the_terminal_one(monkeypatch) -> None:
    stored: list[tuple[int, str]] = []
    monkeypatch.setattr(chat_worker, "_append", lambda s, e, p, seq: stored.append((seq, e["type"])))
    runtime = FakeRuntime([{"type": "RUN_STARTED"}, {"type": "TEXT_MESSAGE_CONTENT"}, {"type": "RUN_FINISHED"}, {"type": "IGNORED"}])
    assert chat_worker.run_chat(PAYLOAD, settings(), runtime) == "finished"
    assert stored == [(1, "RUN_STARTED"), (2, "TEXT_MESSAGE_CONTENT"), (3, "RUN_FINISHED")]
    assert runtime.payload["identity"]["user_id"] == "msl-t01-01" and runtime.payload["run_id"] == RUN


@pytest.mark.parametrize("events,fail", [([{"type": "RUN_STARTED"}], True), ([{"type": "RUN_STARTED"}], False), ([], False)])
def test_a_broken_or_truncated_stream_ends_in_a_generic_run_error(monkeypatch, events, fail) -> None:
    stored: list[dict] = []
    monkeypatch.setattr(chat_worker, "_append", lambda s, e, p, seq: stored.append(e))
    assert chat_worker.run_chat(PAYLOAD, settings(), FakeRuntime(events, fail)) == "failed"
    assert stored[-1]["type"] == "RUN_ERROR" and stored[-1]["code"] == "AGENT_UNAVAILABLE"
    assert "gone" not in json.dumps(stored)


def test_agentcore_adapter_sends_the_same_payload_with_a_session_per_thread() -> None:
    class Body:
        def iter_lines(self):
            yield b'data: {"type":"RUN_FINISHED"}'

    class Client:
        def invoke_agent_runtime(self, **kw: Any) -> dict:
            self.kw = kw
            return {"response": Body()}

    client = Client()
    events = list(AgentCoreRuntime("arn:aws:bedrock-agentcore:us-east-1:222222222222:runtime/r", client).invoke({"thread_id": THREAD, "x": 1}))
    assert events == [{"type": "RUN_FINISHED"}]
    assert client.kw["agentRuntimeArn"].endswith("runtime/r") and len(client.kw["runtimeSessionId"]) >= 33
    assert json.loads(client.kw["payload"]) == {"thread_id": THREAD, "x": 1}
