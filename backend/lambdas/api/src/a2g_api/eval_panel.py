"""Admin evaluation panel fields: suites, runs, diffs, and human ratings of live answers (docs/adr/0013).

* ``evalSuites`` / ``startEvalRun`` / ``evalRuns`` / ``evalRun`` / ``evalRunDiff`` are Administrator-only
  (``admin.manage``). ``startEvalRun`` records the run, writes an audit event and starts the eval worker
  asynchronously, like a chat run, because a whole suite outlives AppSync's 30 second resolver limit.
* ``rateAnswer`` is open to every signed-in persona but only for their own finished chat run (chat runs are
  owner-only under RLS, so another person's run looks like one that does not exist). It scores the live
  answer automatically on the spot, so the rating and the scores are stored together.
* ``evalRatings`` is Administrator-only: ratings sit next to their automated scores.

Notes and answer excerpts are stored and returned to administrators, never logged.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from collections.abc import Callable, Mapping
from typing import Any

import psycopg

from a2g_logging import get_logger

from .chat import invoke_worker
from .errors import BadRequest, Forbidden, NotFound, Unavailable
from .eval_runner import RUN_ID, SOURCES, iso, new_run_id, start_item, suite_fingerprint, visible_citations
from .eval_scoring import SCORER, Evidence, capture_from_events, question_change, score_live_answer, unique_citations
from .eval_store import RATINGS_PK, RUNS_PK, EvalStore, run_pk
from .eval_suites import PERSONAS, SUITES, Suite
from .identity import Identity

log = get_logger(__name__)

MAX_NOTE = 500
LIST_LIMIT = 100
#: A run still "running" after this long lost its worker; the panel shows it as timed out.
STALL_AFTER = dt.timedelta(minutes=20)
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_CHAT_RUN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
Invoker = Callable[[str, dict[str, Any]], None]
RATINGS = ("UP", "DOWN")

_SUMMARY_KEYS = (
    "questionCount",
    "passedCount",
    "failedCount",
    "faithfulness",
    "citationCorrectness",
    "exactCountRate",
    "directionRate",
    "visualMatchRate",
    "visualCoverage",
    "rowMatchRate",
    "themeCoverage",
    "chainCount",
    "chainDepth",
    "chainsCorrect",
    "categories",
    "leakCount",
    "probeCount",
    "verdict",
    "failureReasons",
)


def _require_admin(cur: psycopg.Cursor) -> None:
    cur.execute("SELECT app.has_permission('admin.manage')")
    if not cur.fetchone()[0]:
        raise Forbidden("admin_manage_required")


def _persona(value: Any) -> str:
    if value not in PERSONAS:
        raise BadRequest("invalid_persona")
    return str(value)


def _run_id(value: Any, name: str = "runId") -> str:
    if not isinstance(value, str) or not RUN_ID.match(value):
        raise BadRequest(f"invalid_{name}")
    return value


def _suite_view(suite: Suite) -> dict[str, Any]:
    return {
        "persona": suite.persona,
        "label": suite.label,
        "subjectLabel": suite.subject_label,
        "fingerprint": suite_fingerprint(suite.questions),
        "questions": [
            {
                "questionId": q.question_id,
                "kind": q.kind,
                "category": q.category,
                "chainId": q.chain,
                "turn": q.turn or None,
                "title": q.title,
                "prompt": q.prompt,
            }
            for q in suite.questions
        ],
    }


def eval_suites(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> list[dict[str, Any]]:
    _require_admin(cur)
    return [_suite_view(SUITES[p]) for p in PERSONAS]


def _present_run(item: Mapping[str, Any], *, now: dt.datetime | None = None) -> dict[str, Any]:
    status = item.get("status", "ERROR")
    error_code = item.get("errorCode")
    started = dt.datetime.fromisoformat(item["startedAt"].replace("Z", "+00:00"))
    if status in ("RUNNING", "SCORING") and (now or dt.datetime.now(dt.UTC)) - started > STALL_AFTER:
        status, error_code = "ERROR", "TIMED_OUT"
    out = {
        "runId": item["runId"],
        "persona": item["persona"],
        "personaLabel": item.get("personaLabel", item["persona"]),
        "subjectLabel": item.get("subjectLabel", ""),
        "source": item.get("source", "AGENT"),
        "scorer": item.get("scorer", SCORER),
        "status": status,
        "errorCode": error_code,
        "startedAt": item["startedAt"],
        "finishedAt": item.get("finishedAt"),
        "durationMs": item.get("durationMs"),
        "answered": item.get("answered", 0),
        "suiteFingerprint": item.get("suiteFingerprint", ""),
        "failureReasons": [],
        "categories": [],
        "leakCount": 0,
    }
    for key in _SUMMARY_KEYS:
        if key in item:
            out[key] = item[key]
    if status == "ERROR":
        out["verdict"] = "FAIL"
    return out


def _present_result(item: Mapping[str, Any]) -> dict[str, Any]:
    keys = (
        "questionId", "kind", "category", "chainId", "turn", "title", "prompt", "verdict", "faithfulness", "citations",
        "exactness", "expected", "expectedText", "direction", "visual", "visualMatch", "rowsMatch", "coverage", "uncertainty",
        "visualsDrawn", "factsShown", "rowSetsShown", "leaked", "leakKinds", "reasons", "answerExcerpt", "citationsCited",
        "citationsReadable", "numbersClaimed", "numbersUnverified", "quotesChecked", "quotesFound",
        "agentNumberCheck", "agentError", "durationMs",
    )  # fmt: skip
    out = {k: item.get(k) for k in keys}
    out["category"] = item.get("category") or {"LEAK_PROBE": "LEAK_PROBE", "QUALITATIVE": "QUALITATIVE_THEME"}.get(
        str(item.get("kind")), "EXACT_COUNT"
    )
    out["visualNotes"] = list(item.get("visualNotes") or [])
    out["rowNotes"] = list(item.get("rowNotes") or [])
    out["unverifiedSample"] = list(item.get("unverifiedSample") or [])
    out["leakKinds"] = list(item.get("leakKinds") or [])
    out["reasons"] = list(item.get("reasons") or [])
    out["leaked"] = bool(item.get("leaked"))
    return out


def _all_runs(store: EvalStore) -> list[dict[str, Any]]:
    return store.query(RUNS_PK, newest_first=True, limit=500)


def start_eval_run(
    cur: psycopg.Cursor,
    identity: Identity,
    user_id: str,
    args: Mapping[str, Any],
    *,
    store: EvalStore,
    worker_function: str | None,
    correlation_id: str,
    invoker: Invoker = invoke_worker,
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    _require_admin(cur)
    payload = args.get("input")
    if not isinstance(payload, Mapping):
        raise BadRequest("invalid_input")
    persona = _persona(payload.get("persona"))
    source = payload.get("source") or "AGENT"
    if source not in SOURCES:
        raise BadRequest("invalid_source")
    if not worker_function:
        raise Unavailable("eval_not_configured")
    suite = SUITES[persona]
    moment = now or dt.datetime.now(dt.UTC)

    for run in _all_runs(store)[:50]:
        shown = _present_run(run, now=moment)
        if run.get("persona") == persona and shown["status"] in ("RUNNING", "SCORING"):
            raise BadRequest("run_in_progress")

    run_id = new_run_id(moment)
    item = start_item(run_id, suite, source, moment, user_id)
    store.put(item)
    cur.execute(
        """INSERT INTO audit_events(actor_user_id, action, resource_type, resource_id, outcome, correlation_id, metadata)
           VALUES (%s, 'eval.run.started', 'eval_run', %s, 'accepted', %s, %s::jsonb)""",
        (user_id, run_id, correlation_id, json.dumps({"persona": persona, "source": source})),
    )
    try:
        invoker(
            worker_function,
            {
                "run_id": run_id,
                "persona": persona,
                "source": source,
                "admin_user_id": user_id,
                "correlation_id": correlation_id,
                "started_at": item["startedAt"],
            },
        )
    except Exception as exc:
        log.error("eval worker start failed", run_id=run_id, error_type=type(exc).__name__)
        store.put({**item, "status": "ERROR", "errorCode": "WORKER_START", "verdict": "FAIL", "failureReasons": ["RUN_FAILED"]})
        raise Unavailable("worker_start") from exc
    log.info("eval run started", run_id=run_id, persona=persona, source=source, outcome="accepted")
    return _present_run(item, now=moment)


def eval_runs(
    cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, store: EvalStore
) -> list[dict[str, Any]]:
    _require_admin(cur)
    persona = _persona(args["persona"]) if args.get("persona") else None
    limit = args.get("limit") or 30
    if not isinstance(limit, int) or not 1 <= limit <= LIST_LIMIT:
        raise BadRequest("invalid_limit")
    runs = [_present_run(i) for i in _all_runs(store) if persona is None or i.get("persona") == persona]
    log.info("eval runs listed", count=len(runs[:limit]))
    return runs[:limit]


def _load_run(store: EvalStore, run_id: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    item = next((i for i in _all_runs(store) if i.get("runId") == run_id), None)
    if item is None:
        raise NotFound("unknown_run")
    results = [_present_result(i) for i in store.query(run_pk(run_id), newest_first=False)]
    return _present_run(item), results


def _ratings_summary(items: list[Mapping[str, Any]]) -> dict[str, Any]:
    def mean(key: str) -> float | None:
        values = [i[key] for i in items if i.get(key) is not None]
        return round(sum(values) / len(values), 4) if values else None

    return {
        "total": len(items),
        "up": sum(1 for i in items if i.get("rating") == "UP"),
        "down": sum(1 for i in items if i.get("rating") == "DOWN"),
        "withNote": sum(1 for i in items if i.get("note")),
        "faithfulness": mean("faithfulness"),
        "citationCorrectness": mean("citations"),
    }


def _rating_items(store: EvalStore, persona: str | None) -> list[dict[str, Any]]:
    items = [i for i in store.query(RATINGS_PK, newest_first=True) if persona is None or i.get("persona") == persona]
    return sorted(items, key=lambda i: i.get("ratedAt", ""), reverse=True)


def eval_run(
    cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, store: EvalStore
) -> dict[str, Any]:
    _require_admin(cur)
    run, results = _load_run(store, _run_id(args.get("runId")))
    ratings = _ratings_summary(_rating_items(store, run["persona"]))
    return {**run, "results": results, "humanRatings": ratings}


_DELTA_METRICS = (
    ("faithfulness", "Faithfulness"),
    ("citationCorrectness", "Citation correctness"),
    ("exactCountRate", "Exact counts"),
    ("directionRate", "Trend and comparison direction"),
    ("visualMatchRate", "Chart numbers match SQL"),
    ("rowMatchRate", "Show rows match the answer"),
    ("themeCoverage", "Theme coverage"),
    ("leakCount", "Leaks"),
    ("passedCount", "Questions passed"),
)


def eval_run_diff(
    cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, store: EvalStore
) -> dict[str, Any]:
    _require_admin(cur)
    base_id, head_id = _run_id(args.get("baseRunId"), "baseRunId"), _run_id(args.get("headRunId"), "headRunId")
    if base_id == head_id:
        raise BadRequest("same_run")
    (base, base_results), (head, head_results) = _load_run(store, base_id), _load_run(store, head_id)
    if base["persona"] != head["persona"]:
        raise BadRequest("different_persona")
    for run in (base, head):
        if run["status"] != "COMPLETE":
            raise BadRequest("run_not_complete")

    metrics = []
    for key, label in _DELTA_METRICS:
        a, b = base.get(key), head.get(key)
        metrics.append({"metric": key, "label": label, "base": a, "head": b, "delta": None if a is None or b is None else round(b - a, 4)})

    by_base = {r["questionId"]: r for r in base_results}
    by_head = {r["questionId"]: r for r in head_results}
    order = [r["questionId"] for r in head_results] + [q for q in by_base if q not in by_head]
    questions = []
    counts = {"improved": 0, "regressed": 0, "unchanged": 0, "added": 0, "removed": 0}
    for qid in order:
        b, h = by_base.get(qid), by_head.get(qid)
        if b and h:
            change = question_change(b, h)
        else:
            change = "ADDED" if h else "REMOVED"
        counts[change.lower()] += 1
        sample = h or b
        questions.append(
            {"questionId": qid, "title": sample["title"], "kind": sample["kind"], "change": change, "base": b, "head": h}
        )
    verdict_change = "UNCHANGED"
    if base.get("verdict") != head.get("verdict"):
        verdict_change = "IMPROVED" if head.get("verdict") == "PASS" else "REGRESSED"
    log.info("eval runs diffed", base_run_id=base_id, head_run_id=head_id, outcome=verdict_change)
    return {
        "base": base,
        "head": head,
        "suiteChanged": base["suiteFingerprint"] != head["suiteFingerprint"],
        "verdictChange": verdict_change,
        "metrics": metrics,
        "counts": counts,
        "questions": questions,
    }


# -- human ratings -----------------------------------------------------------------------------------------------


def _clean_note(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise BadRequest("invalid_note")
    note = _CONTROL.sub("", value).strip()
    if len(note) > MAX_NOTE:
        raise BadRequest("note_too_long")
    return note or None


def _present_rating(item: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "ratingId": item["chatRunId"],
        "chatRunId": item["chatRunId"],
        "persona": item["persona"],
        "userId": item["userId"],
        "rating": item["rating"],
        "note": item.get("note"),
        "ratedAt": item["ratedAt"],
        "faithfulness": item.get("faithfulness"),
        "citationCorrectness": item.get("citations"),
        "citationsCited": item.get("citationsCited", 0),
        "numbersUnverified": item.get("numbersUnverified", 0),
        "agentNumberCheck": item.get("agentNumberCheck"),
    }


def rate_answer(
    cur: psycopg.Cursor,
    identity: Identity,
    user_id: str,
    args: Mapping[str, Any],
    *,
    store: EvalStore,
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    payload = args.get("input")
    if not isinstance(payload, Mapping):
        raise BadRequest("invalid_input")
    chat_run_id, rating = payload.get("runId"), payload.get("rating")
    if not isinstance(chat_run_id, str) or not _CHAT_RUN.match(chat_run_id) or rating not in RATINGS:
        raise BadRequest("invalid_rating")
    note = _clean_note(payload.get("note"))

    # Owner-only under RLS: someone else's run is indistinguishable from one that does not exist.
    cur.execute("SELECT status FROM chat_runs WHERE run_id = %s", (chat_run_id,))
    row = cur.fetchone()
    if row is None:
        raise NotFound("unknown_run")
    if row[0] != "finished":
        raise BadRequest("run_not_finished")
    cur.execute("SELECT event FROM chat_run_events WHERE run_id = %s ORDER BY seq LIMIT 2000", (chat_run_id,))
    cap = capture_from_events([r[0] if isinstance(r[0], dict) else json.loads(r[0]) for r in cur.fetchall()])
    visible, cited_text = visible_citations(cur, unique_citations(cap.citations))
    faithfulness, citations, detail = score_live_answer(cap, Evidence(visible_citations=visible, cited_text=cited_text))

    item = {
        "pk": RATINGS_PK,
        "sk": f"RATING#{chat_run_id}",
        "chatRunId": chat_run_id,
        "persona": identity.persona,
        "userId": user_id,
        "rating": rating,
        "note": note,
        "ratedAt": iso(now or dt.datetime.now(dt.UTC)),
        "faithfulness": round(faithfulness, 4),
        "citations": None if citations is None else round(citations, 4),
        "scorer": SCORER,
        **{k: detail[k] for k in ("citationsCited", "numbersUnverified", "agentNumberCheck")},
    }
    store.put(item)
    log.info("answer rated", run_id=chat_run_id, persona=identity.persona, rating=rating, has_note=note is not None)
    return _present_rating(item)


def eval_ratings(
    cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, store: EvalStore
) -> dict[str, Any]:
    _require_admin(cur)
    persona = _persona(args["persona"]) if args.get("persona") else None
    limit = args.get("limit") or 50
    if not isinstance(limit, int) or not 1 <= limit <= LIST_LIMIT:
        raise BadRequest("invalid_limit")
    items = _rating_items(store, persona)
    log.info("eval ratings listed", count=len(items))
    return {"summary": _ratings_summary(items), "items": [_present_rating(i) for i in items[:limit]]}


__all__ = [
    "eval_ratings",
    "eval_run",
    "eval_run_diff",
    "eval_runs",
    "eval_suites",
    "rate_answer",
    "start_eval_run",
]
