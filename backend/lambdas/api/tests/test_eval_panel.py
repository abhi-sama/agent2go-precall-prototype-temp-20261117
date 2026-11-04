"""Eval panel fields with a fake cursor and an in-memory store; the stored-run flow is proven through the API."""

from __future__ import annotations

import datetime as dt

import pytest

from eval_ideal import ideal

from a2g_api import eval_panel
from a2g_api.errors import BadRequest, Forbidden, NotFound, Unavailable
from a2g_api.eval_runner import LeakyCanaryRuntime, new_run_id, result_item, start_item, suite_fingerprint
from a2g_api.eval_scoring import Capture, Evidence, capture_from_events, score_question, summarise
from a2g_api.eval_store import RATINGS_PK, RUNS_PK, MemoryEvalStore
from a2g_api.eval_suites import SUITES

NOW = dt.datetime(2026, 11, 4, 12, 0, tzinfo=dt.UTC)


class Cursor:
    def __init__(self, *rows, admin=True):
        self.rows, self.admin, self.sql = list(rows), admin, []

    def execute(self, sql, params=None):
        self.sql.append((sql, params))

    def fetchone(self):
        if self.rows:
            return self.rows.pop(0)
        return (self.admin,)

    def fetchall(self):
        return []


class Identity:
    persona = "msl"
    db_persona = "MSL"


def started(store, persona="msl", **kw):
    calls = []
    out = eval_panel.start_eval_run(
        Cursor(),
        Identity(),
        "admin-region-01",
        {"input": {"persona": persona, **kw}},
        store=store,
        worker_function="a2g-be-eval",
        correlation_id="corr-1",
        invoker=lambda fn, payload: calls.append((fn, payload)),
        now=NOW,
    )
    return out, calls


def test_only_administrators_run_the_panel():
    store = MemoryEvalStore()
    for call in (eval_panel.eval_suites, lambda *a: eval_panel.eval_runs(*a, store=store)):
        with pytest.raises(Forbidden):
            call(Cursor(admin=False), Identity(), "u", {})
    with pytest.raises(Forbidden):
        eval_panel.start_eval_run(
            Cursor(admin=False), Identity(), "u", {"input": {"persona": "msl"}}, store=store, worker_function="f", correlation_id="c"
        )


def test_suites_list_every_persona():
    suites = eval_panel.eval_suites(Cursor(), Identity(), "u", {})
    assert [s["persona"] for s in suites] == ["msl", "director", "executive", "admin"]
    assert all(s["questions"] and s["fingerprint"] for s in suites)


def test_start_records_the_run_audits_it_and_starts_the_worker():
    store = MemoryEvalStore()
    run, calls = started(store)
    assert run["status"] == "RUNNING" and run["persona"] == "msl" and run["questionCount"] == len(SUITES["msl"].questions)
    [(fn, payload)] = calls
    assert fn == "a2g-be-eval" and payload["run_id"] == run["runId"] and payload["admin_user_id"] == "admin-region-01"
    assert (RUNS_PK, f"RUN#{run['runId']}") in store.items


def test_a_second_run_for_the_same_persona_waits_for_the_first():
    store = MemoryEvalStore()
    started(store)
    with pytest.raises(BadRequest):
        started(store)
    started(store, persona="director")  # other personas are independent


def test_validation_and_worker_failures_are_refused():
    store = MemoryEvalStore()
    for bad in ({"persona": "nobody"}, {"persona": "msl", "source": "ELSEWHERE"}):
        with pytest.raises(BadRequest):
            eval_panel.start_eval_run(Cursor(), Identity(), "u", {"input": bad}, store=store, worker_function="f", correlation_id="c")
    with pytest.raises(Unavailable):
        eval_panel.start_eval_run(Cursor(), Identity(), "u", {"input": {"persona": "msl"}}, store=store, worker_function=None, correlation_id="c")

    def boom(*_):
        raise RuntimeError("no worker")

    with pytest.raises(Unavailable):
        eval_panel.start_eval_run(
            Cursor(), Identity(), "u", {"input": {"persona": "msl"}}, store=store, worker_function="f", correlation_id="c", invoker=boom, now=NOW
        )
    [run] = [v for k, v in store.items.items() if k[0] == RUNS_PK]
    assert run["status"] == "ERROR", "a worker that never started leaves a failed run, not a stuck one"


def test_a_run_whose_worker_vanished_shows_as_timed_out():
    item = start_item("ev-20261104100000-aaaaaaaa", SUITES["msl"], "AGENT", NOW - dt.timedelta(hours=1), "u")
    shown = eval_panel._present_run(item, now=NOW)
    assert shown["status"] == "ERROR" and shown["errorCode"] == "TIMED_OUT" and shown["verdict"] == "FAIL"


def finished_run(store, persona, run_id, *, leak=False, wrong=False, drop=None, extra=None):
    suite = SUITES[persona]
    questions = list(suite.questions)
    if drop:
        questions = [q for q in questions if q.question_id != drop]
    if extra:
        questions = questions + [extra]
    scores = []
    for i, q in enumerate(questions):
        cap, ev = ideal(q, wrong=leak if q.kind == "LEAK_PROBE" else wrong)
        score = score_question(q, cap, ev)
        scores.append(score)
        store.put(result_item(run_id, i, q, cap, score))
    summary = summarise(scores, questions)
    item = start_item(run_id, suite, "AGENT", NOW, "admin-region-01")
    item |= {**summary, "status": "COMPLETE", "finishedAt": "2026-11-04T12:03:00.000Z", "durationMs": 180000, "answered": len(questions),
             "questionCount": len(questions), "suiteFingerprint": suite_fingerprint(questions)}
    store.put(item)


def test_run_detail_carries_scored_results_and_ratings_beside_them():
    store = MemoryEvalStore()
    finished_run(store, "msl", "ev-20261104120000-aaaaaaaa")
    store.put({"pk": RATINGS_PK, "sk": "RATING#r1", "chatRunId": "r1", "persona": "msl", "userId": "u", "rating": "UP",
               "note": "good", "ratedAt": "2026-11-04T11:00:00.000Z", "faithfulness": 1.0, "citations": 1.0})
    store.put({"pk": RATINGS_PK, "sk": "RATING#r2", "chatRunId": "r2", "persona": "director", "userId": "d", "rating": "DOWN",
               "ratedAt": "2026-11-04T11:00:00.000Z", "faithfulness": 0.2})
    run = eval_panel.eval_run(Cursor(), Identity(), "u", {"runId": "ev-20261104120000-aaaaaaaa"}, store=store)
    assert run["verdict"] == "PASS" and len(run["results"]) == run["questionCount"]
    assert run["humanRatings"] == {"total": 1, "up": 1, "down": 0, "withNote": 1, "faithfulness": 1.0, "citationCorrectness": 1.0}
    with pytest.raises(NotFound):
        eval_panel.eval_run(Cursor(), Identity(), "u", {"runId": "ev-20261104120000-bbbbbbbb"}, store=store)
    with pytest.raises(BadRequest):
        eval_panel.eval_run(Cursor(), Identity(), "u", {"runId": "../etc"}, store=store)


def test_a_leak_fails_the_stored_run():
    store = MemoryEvalStore()
    finished_run(store, "msl", "ev-20261104120000-aaaaaaaa", leak=True)
    run = eval_panel.eval_run(Cursor(), Identity(), "u", {"runId": "ev-20261104120000-aaaaaaaa"}, store=store)
    assert run["verdict"] == "FAIL" and run["leakCount"] >= 1 and "LEAK" in run["failureReasons"]
    assert any(r["leaked"] and "LEAK_RECORD_ID" in r["reasons"] for r in run["results"])


def test_two_runs_can_be_diffed():
    store = MemoryEvalStore()
    finished_run(store, "msl", "ev-20261104100000-aaaaaaaa", wrong=True, leak=True)
    finished_run(store, "msl", "ev-20261104120000-bbbbbbbb", drop="leak-secrets")
    diff = eval_panel.eval_run_diff(Cursor(), Identity(), "u", {"baseRunId": "ev-20261104100000-aaaaaaaa", "headRunId": "ev-20261104120000-bbbbbbbb"}, store=store)
    assert diff["verdictChange"] == "IMPROVED" and diff["suiteChanged"] is True
    by_id = {q["questionId"]: q for q in diff["questions"]}
    assert by_id["msl-calls-oct"]["change"] == "IMPROVED"
    assert by_id["leak-secrets"]["change"] == "REMOVED" and by_id["leak-secrets"]["head"] is None
    assert diff["counts"]["improved"] >= 1 and diff["counts"]["removed"] == 1
    leaks = next(m for m in diff["metrics"] if m["metric"] == "leakCount")
    assert leaks["base"] > 0 and leaks["head"] == 0 and leaks["delta"] < 0
    back = eval_panel.eval_run_diff(Cursor(), Identity(), "u", {"baseRunId": "ev-20261104120000-bbbbbbbb", "headRunId": "ev-20261104100000-aaaaaaaa"}, store=store)
    assert back["verdictChange"] == "REGRESSED"


def test_diff_refuses_unlike_or_unfinished_runs():
    store = MemoryEvalStore()
    finished_run(store, "msl", "ev-20261104100000-aaaaaaaa")
    finished_run(store, "director", "ev-20261104110000-bbbbbbbb")
    store.put(start_item("ev-20261104120000-cccccccc", SUITES["msl"], "AGENT", NOW, "u"))

    def diff(a, b):
        return eval_panel.eval_run_diff(Cursor(), Identity(), "u", {"baseRunId": a, "headRunId": b}, store=store)

    with pytest.raises(BadRequest):
        diff("ev-20261104100000-aaaaaaaa", "ev-20261104100000-aaaaaaaa")
    with pytest.raises(BadRequest):
        diff("ev-20261104100000-aaaaaaaa", "ev-20261104110000-bbbbbbbb")
    with pytest.raises(BadRequest):
        diff("ev-20261104100000-aaaaaaaa", "ev-20261104120000-cccccccc")


class RatingCursor:
    """Chat run lookups for ``rate_answer``: status, then the run's events, then citation checks."""

    def __init__(self, status, events):
        self.status, self.events, self.last = status, events, ""

    def execute(self, sql, params=None):
        self.last = sql

    def fetchone(self):
        return None if self.status is None else (self.status,)

    def fetchall(self):
        if "chat_run_events" in self.last:
            return [(e,) for e in self.events]
        if "hcp_raw_insights" in self.last:
            return [("RESP-000001", "Access is the main barrier we hear about from patients.", "Q?")]
        return []


EVENTS = [
    {"type": "CUSTOM", "name": "citations", "value": [{"dataset": "hcp_raw_insights", "record_id": "RESP-000001", "label": "r"}]},
    {"type": "TEXT_MESSAGE_CONTENT", "delta": 'One HCP said "Access is the main barrier we hear about from patients".'},
    {"type": "CUSTOM", "name": "number_check", "value": {"status": "verified", "count": 0, "checked": True}},
    {"type": "RUN_FINISHED"},
]


def rate(store, cursor, **fields):
    return eval_panel.rate_answer(cursor, Identity(), "msl-t01-01", {"input": fields}, store=store, now=NOW)


def test_a_thumb_is_stored_with_the_answers_automated_scores():
    store = MemoryEvalStore()
    out = rate(store, RatingCursor("finished", EVENTS), runId="run-12345678", rating="DOWN", note="  Too vague \x07 ")
    assert out["rating"] == "DOWN" and out["note"] == "Too vague" and out["persona"] == "msl"
    assert out["faithfulness"] == 1.0 and out["citationCorrectness"] == 1.0 and out["citationsCited"] == 1
    again = rate(store, RatingCursor("finished", EVENTS), runId="run-12345678", rating="UP")
    assert again["rating"] == "UP" and again["note"] is None
    assert len([k for k in store.items if k[0] == RATINGS_PK]) == 1, "the latest rating replaces the earlier one"


def test_ratings_need_a_finished_run_the_caller_owns():
    store = MemoryEvalStore()
    with pytest.raises(NotFound):
        rate(store, RatingCursor(None, []), runId="run-12345678", rating="UP")
    with pytest.raises(BadRequest):
        rate(store, RatingCursor("running", []), runId="run-12345678", rating="UP")
    for bad in ({"runId": "x", "rating": "UP"}, {"runId": "run-12345678", "rating": "MEH"}, {"runId": "run-12345678", "rating": "UP", "note": "n" * 501}):
        with pytest.raises(BadRequest):
            rate(store, RatingCursor("finished", EVENTS), **bad)
    assert not store.items


def test_admin_lists_ratings_with_their_scores():
    store = MemoryEvalStore()
    rate(store, RatingCursor("finished", EVENTS), runId="run-12345678", rating="UP", note="great")
    out = eval_panel.eval_ratings(Cursor(), Identity(), "u", {"persona": "msl"}, store=store)
    assert out["summary"]["total"] == 1 and out["summary"]["withNote"] == 1
    assert out["items"][0]["note"] == "great" and out["items"][0]["faithfulness"] == 1.0
    assert eval_panel.eval_ratings(Cursor(), Identity(), "u", {"persona": "director"}, store=store)["items"] == []
    with pytest.raises(Forbidden):
        eval_panel.eval_ratings(Cursor(admin=False), Identity(), "u", {}, store=store)


def test_the_leaky_stand_in_leaks_what_it_is_given():
    suite = SUITES["msl"]
    sample = {"record_id": "CALL-77777", "name": "Synthetic Quill", "territory": "T02-01"}
    runtime = LeakyCanaryRuntime(suite, {"msl-leak-region": sample})
    probe = suite.question("msl-leak-region")
    cap = capture_from_events(list(runtime.invoke({"messages": [{"content": probe.prompt}]})))
    assert "CALL-77777" in cap.text and cap.citations[0]["record_id"] == "CALL-77777" and cap.error is None
    ev = Evidence(foreign_record_ids=["CALL-77777"], foreign_names=["Synthetic Quill"], foreign_territories=("T02-01",))
    score = score_question(probe, cap, ev)
    assert score.leaked and {"CITATION", "RECORD_ID", "HCP_NAME"} <= set(score.leak_kinds)
    mail = capture_from_events(list(runtime.invoke({"messages": [{"content": suite.question("leak-emails").prompt}]})))
    assert score_question(suite.question("leak-emails"), mail, Evidence()).leak_kinds == ["EMAIL"]


def test_run_ids_sort_by_start_time_and_the_fingerprint_tracks_wording():
    assert new_run_id(NOW) < new_run_id(NOW + dt.timedelta(seconds=1))
    qs = SUITES["msl"].questions
    assert suite_fingerprint(qs) == suite_fingerprint(qs) != suite_fingerprint(qs[:-1])
