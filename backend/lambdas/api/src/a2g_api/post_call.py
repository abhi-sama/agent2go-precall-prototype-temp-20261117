"""Optional MSL post-call workflows.

No model is called here.  Draft lines are a lossless split of user-entered notes,
task rows are inserted only by the confirmation mutation, and alert counts are SQL.
"""

from __future__ import annotations

import datetime as dt
import uuid
from collections.abc import Mapping
from typing import Any

import psycopg

from a2g_logging import get_logger

from .errors import BadRequest, Forbidden
from .identity import Identity

log = get_logger(__name__)


def _require_msl(identity: Identity) -> None:
    if identity.persona.lower() != "msl":
        raise Forbidden("msl_optional_workflow_required")


def _notes(value: object) -> tuple[str, list[str]]:
    if not isinstance(value, str):
        raise BadRequest("invalid_post_call_notes")
    notes = value.strip()
    if not 1 <= len(notes) <= 8_000:
        raise BadRequest("invalid_post_call_notes")
    # Preserve each non-empty observation exactly; there is intentionally no rewrite or inference.
    lines = [line.strip() for line in notes.splitlines() if line.strip()]
    if not lines:
        raise BadRequest("invalid_post_call_notes")
    return notes, lines


def _draft(row: tuple[Any, ...]) -> dict[str, Any]:
    draft_id, notes, lines, status, created_at = row
    return {"draftId": draft_id, "notes": notes, "structuredLines": list(lines), "status": status, "createdAt": created_at.isoformat()}


def create_post_call_draft(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    _require_msl(identity)
    input_ = args.get("input")
    if not isinstance(input_, Mapping):
        raise BadRequest("invalid_post_call_draft")
    notes, lines = _notes(input_.get("notes"))
    draft_id = f"draft-{uuid.uuid4()}"
    cur.execute(
        """INSERT INTO post_call_drafts(draft_id, owner_user_id, notes, structured_lines)
           VALUES (%s, %s, %s, %s::jsonb)
           RETURNING draft_id, notes, structured_lines, status, created_at""",
        (draft_id, user_id, notes, psycopg.types.json.Jsonb(lines)),
    )
    result = _draft(cur.fetchone())
    log.info("post-call draft created", user_id=user_id, draft_id=draft_id, line_count=len(lines))
    return result


def post_call_drafts(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> list[dict[str, Any]]:
    _require_msl(identity)
    cur.execute("SELECT draft_id, notes, structured_lines, status, created_at FROM post_call_drafts ORDER BY created_at DESC LIMIT 30")
    return [_draft(row) for row in cur.fetchall()]


def confirm_post_call_draft(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    _require_msl(identity)
    draft_id = str(args.get("draftId") or "").strip()
    if not draft_id or len(draft_id) > 128:
        raise BadRequest("invalid_post_call_draft")
    cur.execute(
        """UPDATE post_call_drafts SET status = 'CONFIRMED'
           WHERE draft_id = %s AND status = 'DRAFT'
           RETURNING draft_id, notes, structured_lines, status, created_at""",
        (draft_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise BadRequest("invalid_post_call_draft")
    result = _draft(row)
    log.info("post-call draft confirmed", user_id=user_id, draft_id=draft_id)
    return result


def _task(row: tuple[Any, ...]) -> dict[str, Any]:
    task_id, description, owner_user_id, due_date, status, source_draft_id, created_at = row
    return {"taskId": task_id, "description": description, "ownerUserId": owner_user_id, "dueDate": due_date.isoformat() if due_date else None, "status": status, "sourceDraftId": source_draft_id, "createdAt": created_at.isoformat()}


def confirm_follow_up_tasks(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> list[dict[str, Any]]:
    _require_msl(identity)
    inputs = args.get("input")
    if not isinstance(inputs, list) or not 1 <= len(inputs) <= 20:
        raise BadRequest("invalid_confirmed_tasks")
    results: list[dict[str, Any]] = []
    for item in inputs:
        if not isinstance(item, Mapping):
            raise BadRequest("invalid_confirmed_tasks")
        description = str(item.get("description") or "").strip()
        if not 1 <= len(description) <= 500:
            raise BadRequest("invalid_confirmed_tasks")
        due_raw = item.get("dueDate")
        try:
            due_date = dt.date.fromisoformat(str(due_raw)) if due_raw else None
        except ValueError as exc:
            raise BadRequest("invalid_confirmed_tasks") from exc
        source_draft_id = item.get("sourceDraftId")
        if source_draft_id is not None:
            source_draft_id = str(source_draft_id)
            cur.execute("SELECT 1 FROM post_call_drafts WHERE draft_id = %s", (source_draft_id,))
            if cur.fetchone() is None:
                raise BadRequest("invalid_confirmed_tasks")
        task_id = f"task-{uuid.uuid4()}"
        cur.execute(
            """INSERT INTO follow_up_tasks(task_id, owner_user_id, description, due_date, source_draft_id)
               VALUES (%s, %s, %s, %s, %s)
               RETURNING task_id, description, owner_user_id, due_date, status, source_draft_id, created_at""",
            (task_id, user_id, description, due_date, source_draft_id),
        )
        results.append(_task(cur.fetchone()))
    log.info("follow-up tasks confirmed", user_id=user_id, task_count=len(results))
    return results


def my_follow_up_tasks(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> list[dict[str, Any]]:
    _require_msl(identity)
    cur.execute("SELECT task_id, description, owner_user_id, due_date, status, source_draft_id, created_at FROM follow_up_tasks ORDER BY due_date NULLS LAST, created_at DESC")
    return [_task(row) for row in cur.fetchall()]


def _rule(row: tuple[Any, ...]) -> dict[str, Any]:
    rule_id, topic, threshold, period_days, created_at = row
    return {"ruleId": rule_id, "topic": topic, "threshold": int(threshold), "periodDays": int(period_days), "createdAt": created_at.isoformat()}


def create_topic_alert_rule(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    _require_msl(identity)
    input_ = args.get("input")
    if not isinstance(input_, Mapping):
        raise BadRequest("invalid_topic_alert_rule")
    topic = str(input_.get("topic") or "").strip()
    threshold, period_days = input_.get("threshold"), input_.get("periodDays")
    if not 2 <= len(topic) <= 120 or isinstance(threshold, bool) or isinstance(period_days, bool) or not isinstance(threshold, int) or not isinstance(period_days, int) or threshold < 1 or not 1 <= period_days <= 366:
        raise BadRequest("invalid_topic_alert_rule")
    rule_id = f"alert-{uuid.uuid4()}"
    cur.execute(
        """INSERT INTO topic_alert_rules(rule_id, owner_user_id, topic, threshold, period_days)
           VALUES (%s, %s, %s, %s, %s) RETURNING rule_id, topic, threshold, period_days, created_at""",
        (rule_id, user_id, topic, threshold, period_days),
    )
    result = _rule(cur.fetchone())
    log.info("topic alert rule created", user_id=user_id, rule_id=rule_id, threshold=threshold, period_days=period_days)
    return result


def topic_alert_rules(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> list[dict[str, Any]]:
    _require_msl(identity)
    cur.execute("SELECT rule_id, topic, threshold, period_days, created_at FROM topic_alert_rules ORDER BY created_at DESC")
    return [_rule(row) for row in cur.fetchall()]


def topic_alerts(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> list[dict[str, Any]]:
    _require_msl(identity)
    cur.execute("SELECT rule_id, topic, threshold, period_days, created_at FROM topic_alert_rules ORDER BY created_at DESC")
    alerts: list[dict[str, Any]] = []
    for rule_id, topic, threshold, period_days, _created_at in cur.fetchall():
        # RLS scopes this source query. Counts and evidence selection are deterministic SQL.
        cur.execute(
            """WITH matched AS (
                 SELECT DISTINCT uniq_rspns_id, date_of_interaction
                 FROM hcp_raw_insights
                 WHERE excluded_rspns_flag IS NOT TRUE
                   AND date_of_interaction >= current_date - (%s - 1)
                   AND (qstn_txt ILIKE '%%' || %s || '%%' OR rspns_txt ILIKE '%%' || %s || '%%')
               ), ranked AS (
                 SELECT uniq_rspns_id, row_number() OVER (ORDER BY date_of_interaction DESC, uniq_rspns_id) AS rank FROM matched
               )
               SELECT count(*), coalesce(array_agg(uniq_rspns_id ORDER BY rank) FILTER (WHERE rank <= 3), ARRAY[]::text[]) FROM ranked""",
            (int(period_days), topic, topic),
        )
        count, evidence = cur.fetchone()
        if int(count) >= int(threshold):
            alerts.append({"ruleId": rule_id, "topic": topic, "threshold": int(threshold), "periodDays": int(period_days), "count": int(count), "evidenceResponseIds": list(evidence)})
    log.info("topic alerts evaluated", user_id=user_id, alert_count=len(alerts))
    return alerts
