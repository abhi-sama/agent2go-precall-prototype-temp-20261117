"""Eval worker Lambda: runs one golden suite for ``startEvalRun`` (docs/adr/0013).

Invoked asynchronously with the administrator already verified and mapped to a user. It asks the agent over
the approved route, scores the answers and stores the run in FE DynamoDB. It never raises to the Lambda
runtime (an async retry would replay a whole suite): a failed run is stored as ``ERROR``.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Mapping
from typing import Any

from a2g_logging import configure, correlation, get_logger

from .agent_client import runtime_for
from .eval_runner import RUN_ID, SOURCES, run_suite
from .eval_store import DynamoEvalStore, EvalStore
from .eval_suites import SUITES
from .settings import Settings

configure(service="a2g-be-eval")
log = get_logger(__name__)


def handler(event: Mapping[str, Any], context: Any = None, *, store: EvalStore | None = None) -> dict[str, str]:
    with correlation(str(event.get("correlation_id") or "")) as cid:
        try:
            run_id, persona, source = event["run_id"], event["persona"], event.get("source", "AGENT")
            if not RUN_ID.match(run_id) or persona not in SUITES or source not in SOURCES:
                raise ValueError("invalid_event")
            settings = Settings.from_env()
            if store is None:
                if not (settings.eval_table and settings.eval_role_arn):
                    raise RuntimeError("eval_unconfigured")
                store = DynamoEvalStore(settings.eval_table, settings.eval_role_arn)
            started = event.get("started_at")
            summary = run_suite(
                run_id=run_id,
                suite=SUITES[persona],
                source=source,
                settings=settings,
                store=store,
                runtime=runtime_for(settings),
                admin_user_id=event["admin_user_id"],
                correlation_id=cid,
                started_at=dt.datetime.fromisoformat(started.replace("Z", "+00:00")) if started else None,
            )
        except Exception as exc:
            log.error("eval worker crashed", error_type=type(exc).__name__)
            return {"status": "crashed"}
    return {"status": str(summary["status"])}
