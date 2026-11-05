"""Pre-call briefs: generate, reopen, list and edit (docs/adr/0009).

The flow follows the approved route (docs/adr/0001): the browser calls FE AppSync, which calls this
Lambda, which calls the AgentCore agent, which calls Bedrock. Deterministic code does everything that
must not be generated:

* access: the HCP must be inside the caller's RLS scope, at generation and again every time a saved
  brief is opened, listed or edited;
* evidence: this module reads the HCP's calls and recorded responses under RLS, consolidates call-product
  rows into calls, keeps parent-question context inside one interaction, and counts;
* freshness: the data-through date, a per-HCP source fingerprint, and the missing-information list.

The agent only writes the prose (statements, discussion prompts, agenda), may cite nothing but the evidence
this module handed it, and saves the finished brief to FE DynamoDB itself (docs/adr/0005). This Lambda
reads it back through a narrow role, so the brief it returns is exactly what was persisted.

Logs carry ids, counts and enums only. Objectives, HCP names and recorded answers are never logged.
"""

from __future__ import annotations

import os
import datetime as dt
import re
import threading
import uuid
from collections.abc import Callable, Mapping
from typing import Any, Protocol

import psycopg

from a2g_logging import get_logger

from .agent_client import AgentRuntime
from .errors import BadRequest, Forbidden, NotFound, Unavailable
from .identity import Identity
from .resolvers import _data_through, _profile, _require_hcp_search_access, _scope

log = get_logger(__name__)

MAX_OBJECTIVE = 500
MIN_OBJECTIVE = 3
MAX_CALLS = 10
MAX_RESPONSES = 20
MAX_LISTED = 25
MAX_ITEMS = 12
MAX_ITEM_TEXT = 600
MAX_ITEM_DETAIL = 800
STALE_AFTER_DAYS = 180
#: AppSync cuts a resolver off at 30 seconds, so the agent call must give up before that.
#: Local stacks whose model is a subscription CLI (several seconds slower than Bedrock) raise it with
#: A2G_AGENT_TIMEOUT_SECONDS; the default is the AWS value.
AGENT_TIMEOUT_SECONDS = float(os.environ.get("A2G_AGENT_TIMEOUT_SECONDS", "25"))
_ID = re.compile(r"^br-[0-9]{14}-[0-9a-f]{8}$")
_HCP_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9:_.\-]{0,127}$")
_ITEM_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,63}$")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
SECTIONS = ("engagement", "perspectives", "followUps")


class BriefStore(Protocol):
    def get(self, user_id: str, brief_id: str) -> dict[str, Any] | None: ...

    def list_for(self, user_id: str) -> list[dict[str, Any]]: ...

    def update_edits(self, user_id: str, brief_id: str, changes: dict[str, Any]) -> bool: ...


class DynamoBriefStore:
    """FE DynamoDB read and edit access through a narrow cross-account role (assumed, then cached).

    The role may ``GetItem``, ``Query`` and ``UpdateItem`` on the briefs table. It cannot create, replace,
    delete or scan: new briefs are written only by the agent (ADR 0005).
    """

    def __init__(self, table: str, role_arn: str, *, prefix: str = "BRIEF#") -> None:
        self._table = table
        self._role_arn = role_arn
        #: Sort-key prefix: leadership summaries share this table and role under ``SUMMARY#`` (docs/adr/0013).
        self._prefix = prefix
        self._client_cache: tuple[Any, dt.datetime] | None = None
        self._lock = threading.Lock()

    def _client(self) -> Any:
        import boto3  # supplied by the Lambda runtime; imported lazily so unit tests need no AWS

        with self._lock:
            now = dt.datetime.now(dt.UTC)
            if self._client_cache and self._client_cache[1] - now > dt.timedelta(minutes=2):
                return self._client_cache[0]
            creds = boto3.client("sts").assume_role(
                RoleArn=self._role_arn, RoleSessionName="a2g-be-briefs", DurationSeconds=900
            )["Credentials"]
            client = boto3.client(
                "dynamodb",
                aws_access_key_id=creds["AccessKeyId"],
                aws_secret_access_key=creds["SecretAccessKey"],
                aws_session_token=creds["SessionToken"],
            )
            self._client_cache = (client, creds["Expiration"])
            return client

    @staticmethod
    def _plain(item: Mapping[str, Any]) -> dict[str, Any]:
        from boto3.dynamodb.types import TypeDeserializer

        de = TypeDeserializer()
        return {k: _decimals(de.deserialize(v)) for k, v in item.items()}

    def get(self, user_id: str, brief_id: str) -> dict[str, Any] | None:
        try:
            out = self._client().get_item(
                TableName=self._table, Key={"pk": {"S": f"USER#{user_id}"}, "sk": {"S": f"{self._prefix}{brief_id}"}}
            )
        except Exception as exc:
            log.error("brief store read failed", error_type=type(exc).__name__)
            raise Unavailable("briefs_read") from exc
        return self._plain(out["Item"]) if out.get("Item") else None

    def list_for(self, user_id: str) -> list[dict[str, Any]]:
        try:
            out = self._client().query(
                TableName=self._table,
                KeyConditionExpression="pk = :pk AND begins_with(sk, :p)",
                ExpressionAttributeValues={":pk": {"S": f"USER#{user_id}"}, ":p": {"S": self._prefix}},
                ScanIndexForward=False,
                Limit=MAX_LISTED,
            )
        except Exception as exc:
            log.error("brief store read failed", error_type=type(exc).__name__)
            raise Unavailable("briefs_read") from exc
        return [self._plain(item) for item in out.get("Items", [])]

    def update_edits(self, user_id: str, brief_id: str, changes: dict[str, Any]) -> bool:
        from boto3.dynamodb.types import TypeSerializer

        ser = TypeSerializer()
        names = {f"#{k}": k for k in changes}
        values = {f":{k}": ser.serialize(v) for k, v in changes.items()}
        expr = "SET " + ", ".join(f"#{k} = :{k}" for k in changes)
        try:
            self._client().update_item(
                TableName=self._table,
                Key={"pk": {"S": f"USER#{user_id}"}, "sk": {"S": f"{self._prefix}{brief_id}"}},
                UpdateExpression=expr,
                ExpressionAttributeNames={**names, "#owner": "ownerUserId"},
                ExpressionAttributeValues={**values, ":owner": {"S": user_id}},
                ConditionExpression="attribute_exists(pk) AND #owner = :owner",
            )
        except Exception as exc:
            if type(exc).__name__ == "ConditionalCheckFailedException":
                return False
            log.error("brief store write failed", error_type=type(exc).__name__)
            raise Unavailable("briefs_write") from exc
        return True


def _decimals(value: Any) -> Any:
    from decimal import Decimal

    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, list):
        return [_decimals(v) for v in value]
    if isinstance(value, dict):
        return {k: _decimals(v) for k, v in value.items()}
    return value


# --------------------------------------------------------------------------------------------------
# Validation helpers


def _clean(value: Any, name: str, *, minimum: int, maximum: int) -> str:
    if not isinstance(value, str):
        raise BadRequest(f"invalid_{name}")
    text = _CONTROL.sub("", value).strip()
    if not minimum <= len(text) <= maximum:
        raise BadRequest(f"invalid_{name}")
    return text


def _brief_id(args: Mapping[str, Any]) -> str:
    value = args.get("briefId")
    if not isinstance(value, str) or not _ID.match(value):
        raise BadRequest("invalid_brief_id")
    return value


def _hcp_id(args: Mapping[str, Any]) -> str:
    value = args.get("hcpId")
    if not isinstance(value, str) or not _HCP_ID.match(value.strip()):
        raise BadRequest("invalid_hcp_id")
    return value.strip()


def _iso(value: dt.datetime | dt.date | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value.astimezone(dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    return value.isoformat()


def _parse_dt(value: Any) -> dt.datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.UTC)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


# --------------------------------------------------------------------------------------------------
# Evidence: everything read here runs under the caller's RLS session.

_CALLS_SQL = """
SELECT c.crm_call_id, max(c.call_dt),
       coalesce(array_agg(DISTINCT c.call_chnl) FILTER (WHERE c.call_chnl IS NOT NULL), '{}'),
       coalesce(array_agg(DISTINCT c.call_type) FILTER (WHERE c.call_type IS NOT NULL), '{}'),
       coalesce(array_agg(DISTINCT c.prd_nm) FILTER (WHERE c.prd_nm IS NOT NULL), '{}'),
       coalesce(array_agg(DISTINCT c.reason_for_visit) FILTER (WHERE c.reason_for_visit IS NOT NULL), '{}')
         || coalesce(array_agg(DISTINCT c.derived_disease_state) FILTER (WHERE c.derived_disease_state IS NOT NULL), '{}')
FROM call_activity c
JOIN hcp_identifier_crosswalk x
  ON x.source_system = 'call_activity.cust_mdm_id' AND x.source_identifier = c.cust_mdm_id
WHERE x.hcp_id = %s AND c.crm_call_id IS NOT NULL
GROUP BY c.crm_call_id
ORDER BY max(c.call_dt) DESC NULLS LAST, c.crm_call_id DESC
"""

_RESPONSES_SQL = """
SELECT i.source_row_id, i.uniq_rspns_id, i.insight_intrctn_dtl_sfdc_id, i.qstn_ext_id, i.qstn_pid,
       i.qstn_txt, i.rspns_txt, i.date_of_interaction, i.follow_up_qstn_tag, i.followup_qstn, i.followup_rspns
FROM hcp_raw_insights i
JOIN hcp_identifier_crosswalk x
  ON x.source_system = 'hcp_raw_insights.cust_mdm_id' AND x.source_identifier = i.cust_mdm_id
WHERE x.hcp_id = %s AND coalesce(i.excluded_rspns_flag, false) = false
ORDER BY i.date_of_interaction DESC NULLS LAST, i.source_row_id DESC
"""

_FINGERPRINT_SQL = """
SELECT
  (SELECT max(c.sys_inserted_datetime) FROM call_activity c JOIN hcp_identifier_crosswalk x
     ON x.source_system = 'call_activity.cust_mdm_id' AND x.source_identifier = c.cust_mdm_id WHERE x.hcp_id = %(h)s),
  (SELECT max(i.sys_inserted_datetime) FROM hcp_raw_insights i JOIN hcp_identifier_crosswalk x
     ON x.source_system = 'hcp_raw_insights.cust_mdm_id' AND x.source_identifier = i.cust_mdm_id WHERE x.hcp_id = %(h)s),
  (SELECT count(DISTINCT c.crm_call_id) FROM call_activity c JOIN hcp_identifier_crosswalk x
     ON x.source_system = 'call_activity.cust_mdm_id' AND x.source_identifier = c.cust_mdm_id WHERE x.hcp_id = %(h)s),
  (SELECT count(*) FROM hcp_raw_insights i JOIN hcp_identifier_crosswalk x
     ON x.source_system = 'hcp_raw_insights.cust_mdm_id' AND x.source_identifier = i.cust_mdm_id
     WHERE x.hcp_id = %(h)s AND coalesce(i.excluded_rspns_flag, false) = false)
"""


def source_fingerprint(cur: psycopg.Cursor, hcp_id: str) -> dict[str, Any]:
    """What the caller can currently see about one HCP: latest load time and record counts."""
    cur.execute(_FINGERPRINT_SQL, {"h": hcp_id})
    call_loaded, response_loaded, calls, responses = cur.fetchone()
    loaded = max((v for v in (call_loaded, response_loaded) if v is not None), default=None)
    return {"hcpLoadedThrough": _iso(loaded), "callCount": int(calls), "responseCount": int(responses)}


def _short(text: str, limit: int = 400) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def build_evidence(cur: psycopg.Cursor, hcp_id: str, profile: tuple[Any, ...], data_through: dt.datetime | None) -> dict[str, Any]:
    """Collect the cited material for one HCP. Returns the pack the agent writes the brief from."""
    cur.execute(_CALLS_SQL, (hcp_id,))
    call_rows = cur.fetchall()
    calls: list[dict[str, Any]] = []
    evidence: dict[str, dict[str, Any]] = {}
    for call_id, day, channels, types, products, topics in call_rows[:MAX_CALLS]:
        evidence_id = f"call:{call_id}"
        calls.append(
            {
                "evidence_id": evidence_id,
                "date": day.isoformat() if day else None,
                "channels": sorted(set(channels)),
                "types": sorted(set(types)),
                "products": sorted(set(products)),
                "topics": sorted(set(topics)),
            }
        )
        evidence[evidence_id] = {
            "evidenceId": evidence_id,
            "dataset": "call_activity",
            "recordId": call_id,
            "label": f"Call {day.isoformat() if day else 'undated'}",
            "date": day.isoformat() if day else None,
        }

    cur.execute(_RESPONSES_SQL, (hcp_id,))
    raw = cur.fetchall()
    id_counts: dict[str, int] = {}
    for row in raw:
        if row[1]:
            id_counts[row[1]] = id_counts.get(row[1], 0) + 1
    # A response is citable only through a record id the citation drawer can open unambiguously.
    citable = [r for r in raw if r[1] and id_counts[r[1]] == 1]
    uncitable = len(raw) - len(citable)
    by_key: dict[tuple[str, str], list[tuple[Any, ...]]] = {}
    for r in raw:
        if r[2] and r[3]:
            by_key.setdefault((r[2], r[3]), []).append(r)

    responses: list[dict[str, Any]] = []
    follow_ups: list[dict[str, Any]] = []
    for row in citable[:MAX_RESPONSES]:
        _rid, uniq, interaction, question_id, parent_qid, question, answer, day, tag, fu_question, fu_response = row
        evidence_id = f"response:{uniq}"
        entry: dict[str, Any] = {
            "evidence_id": evidence_id,
            "date": day.isoformat() if day else None,
            "question": _short(question or "", 200),
            "answer": _short(answer or "", 400),
        }
        if parent_qid and interaction:
            # Parent context is resolved by code, inside one interaction only.
            parents = by_key.get((interaction, parent_qid), [])
            if len(parents) == 1 and parents[0][1] and id_counts.get(parents[0][1]) == 1:
                entry["parent_question"] = _short(parents[0][5] or "", 200)
                entry["parent_answer"] = _short(parents[0][6] or "", 250)
                entry["parent_evidence_id"] = f"response:{parents[0][1]}"
        responses.append(entry)
        evidence[evidence_id] = {
            "evidenceId": evidence_id,
            "dataset": "hcp_raw_insights",
            "recordId": uniq,
            "label": f"Recorded response {day.isoformat() if day else 'undated'}",
            "date": day.isoformat() if day else None,
        }
        if fu_question and fu_question.strip():
            follow_ups.append(
                {
                    "evidence_id": evidence_id,
                    "date": day.isoformat() if day else None,
                    "tag": _short(tag or "", 120) or None,
                    "topic": _short(fu_question, 300),
                    "recorded_answer": _short(fu_response or "", 300) or None,
                }
            )
    # A parent that was cited as context must itself be openable from the evidence list.
    for entry in responses:
        parent = entry.get("parent_evidence_id")
        if parent and parent not in evidence:
            record_id = parent.split(":", 1)[1]
            evidence[parent] = {
                "evidenceId": parent,
                "dataset": "hcp_raw_insights",
                "recordId": record_id,
                "label": "Recorded response (parent question)",
                "date": None,
            }

    total_calls = len(call_rows)
    total_responses = len(raw)
    facts: list[dict[str, Any]] = [
        {"label": "Calls on record", "value": str(total_calls), "evidenceIds": [c["evidence_id"] for c in calls[:5]]},
        {"label": "Recorded responses", "value": str(total_responses), "evidenceIds": [r["evidence_id"] for r in responses[:5]]},
    ]
    if calls and calls[0]["date"]:
        facts.append({"label": "Most recent call", "value": calls[0]["date"], "evidenceIds": [calls[0]["evidence_id"]]})
    if responses and responses[0]["date"]:
        facts.append({"label": "Latest recorded response", "value": responses[0]["date"], "evidenceIds": [responses[0]["evidence_id"]]})
    facts = [f for f in facts if f["evidenceIds"] or f["value"] == "0"]

    missing: list[dict[str, str]] = []
    if not calls:
        missing.append({"code": "NO_CALLS", "message": "No previous calls are recorded for this HCP in your authorized data."})
    if not responses:
        missing.append({"code": "NO_RESPONSES", "message": "No recorded insight responses are available for this HCP."})
    elif not follow_ups:
        missing.append({"code": "NO_FOLLOW_UPS", "message": "No follow-up topics are recorded for this HCP."})
    for index, label in ((2, "Specialty"), (5, "Institution")):
        if profile[index] is None:
            missing.append({"code": f"PROFILE_{label.upper()}_MISSING", "message": f"{label} is not recorded for this HCP."})
    if uncitable:
        missing.append(
            {
                "code": "UNCITABLE_RESPONSES",
                "message": f"{uncitable} recorded response(s) have no single record id and are left out of the brief.",
            }
        )
    if total_calls > MAX_CALLS:
        missing.append({"code": "CALLS_TRUNCATED", "message": f"Only the latest {MAX_CALLS} of {total_calls} calls are summarized."})
    if len(citable) > MAX_RESPONSES:
        missing.append(
            {"code": "RESPONSES_TRUNCATED", "message": f"Only the latest {MAX_RESPONSES} of {len(citable)} responses are summarized."}
        )
    reference_day = (data_through or _now()).date()
    latest_days = [d for d in ((calls[0]["date"] if calls else None), (responses[0]["date"] if responses else None)) if d]
    if latest_days and (reference_day - dt.date.fromisoformat(max(latest_days))).days > STALE_AFTER_DAYS:
        missing.append({"code": "NO_RECENT_INTERACTION", "message": "No interaction is recorded in the last six months."})

    return {
        "calls": calls,
        "responses": responses,
        "follow_ups": follow_ups[:10],
        "facts": facts,
        "missing": missing,
        "evidence": list(evidence.values()),
        "last_interaction_date": max(latest_days) if latest_days else None,
    }


# --------------------------------------------------------------------------------------------------
# Presenting a saved brief to the caller


def _stale_reasons(saved: Mapping[str, Any], fingerprint: Mapping[str, Any], data_through: dt.datetime | None) -> list[str]:
    reasons: list[str] = []
    old = saved.get("fingerprint") or {}
    if (
        old.get("hcpLoadedThrough") != fingerprint.get("hcpLoadedThrough")
        or old.get("callCount") != fingerprint.get("callCount")
        or old.get("responseCount") != fingerprint.get("responseCount")
    ):
        reasons.append("HCP_DATA_CHANGED")
    # Saved dates are whole seconds; compare at that precision so an unchanged load is never "newer".
    through = data_through.replace(microsecond=0) if data_through is not None else None
    saved_through = _parse_dt(saved.get("dataThrough"))
    if through is not None and (saved_through is None or through > saved_through):
        reasons.append("NEWER_DATA_LOADED")
    return reasons


def _statements(items: Any) -> list[dict[str, Any]]:
    return [
        {"statementId": s["statementId"], "text": s["text"], "evidenceIds": list(s.get("evidenceIds") or [])}
        for s in (items or [])
    ]


def _editable(items: Any) -> list[dict[str, Any]]:
    return [
        {
            "itemId": i["itemId"],
            "text": i["text"],
            "detail": i.get("detail"),
            "evidenceIds": list(i.get("evidenceIds") or []),
            "origin": i.get("origin", "GENERATED"),
            "edited": bool(i.get("edited", False)),
        }
        for i in (items or [])
    ]


def _authorize(cur: psycopg.Cursor, identity: Identity, hcp_id: str) -> tuple[Any, ...]:
    """The HCP's profile row, or ``Forbidden``. Absent and out-of-scope look the same."""
    _require_hcp_search_access(cur, identity)
    profile = _profile(cur, hcp_id)
    if profile is None:
        raise Forbidden("hcp_not_in_scope")
    return profile


def present(cur: psycopg.Cursor, identity: Identity, user_id: str, item: Mapping[str, Any]) -> dict[str, Any]:
    """Re-check access, then describe a saved brief with its current staleness."""
    if item.get("ownerUserId") != user_id:
        raise NotFound("brief_not_owned")
    profile = _authorize(cur, identity, item["hcpId"])
    fingerprint = source_fingerprint(cur, item["hcpId"])
    through = _data_through(cur)
    reasons = _stale_reasons(item, fingerprint, through)
    return {
        "briefId": item["briefId"],
        "hcpId": item["hcpId"],
        "hcpName": {"value": profile[1], "state": "MISSING" if profile[1] is None else "PRESENT"},
        "objective": item["objective"],
        "ownerUserId": item["ownerUserId"],
        "scopeLabel": item.get("scopeLabel", ""),
        "scopeTerritoryIds": list(item.get("scopeTerritoryIds") or []),
        "dataThrough": item.get("dataThrough"),
        "generatedAt": item["generatedAt"],
        "updatedAt": item.get("updatedAt", item["generatedAt"]),
        "modelMode": item.get("modelMode", "claude"),
        "numberCheck": item.get("numberCheck", "unchecked"),
        "droppedStatements": int(item.get("droppedStatements", 0)),
        "stale": bool(reasons),
        "staleReasons": reasons,
        "currentDataThrough": _iso(through),
        "lastInteractionDate": item.get("lastInteractionDate"),
        "facts": [
            {"label": f["label"], "value": f["value"], "evidenceIds": list(f.get("evidenceIds") or [])}
            for f in item.get("facts") or []
        ],
        "engagement": _statements(item.get("engagement")),
        "perspectives": _statements(item.get("perspectives")),
        "followUps": _statements(item.get("followUps")),
        "prompts": _editable(item.get("prompts")),
        "agenda": _editable(item.get("agenda")),
        "missing": [{"code": m["code"], "message": m["message"]} for m in item.get("missing") or []],
        "evidence": [
            {
                "evidenceId": e["evidenceId"],
                "dataset": e["dataset"],
                "recordId": e["recordId"],
                "label": e["label"],
                "date": e.get("date"),
            }
            for e in item.get("evidence") or []
        ],
        "regeneratesBriefId": item.get("regeneratesBriefId"),
    }


# --------------------------------------------------------------------------------------------------
# Resolvers


def _new_brief_id(now: dt.datetime) -> str:
    return f"br-{now.strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"


def generate_brief(
    cur: psycopg.Cursor,
    identity: Identity,
    user_id: str,
    args: Mapping[str, Any],
    *,
    store: BriefStore,
    runtime: AgentRuntime,
    correlation_id: str,
    now: Callable[[], dt.datetime] = _now,
) -> dict[str, Any]:
    hcp_id = _hcp_id(args)
    objective = _clean(args.get("objective"), "objective", minimum=MIN_OBJECTIVE, maximum=MAX_OBJECTIVE)
    regenerates = args.get("regeneratesBriefId")
    if regenerates not in (None, "") and (not isinstance(regenerates, str) or not _ID.match(regenerates)):
        raise BadRequest("invalid_brief_id")

    profile = _authorize(cur, identity, hcp_id)
    through = _data_through(cur)
    _assigned, _effective, scope_label = _scope(cur, identity)
    cur.execute("SELECT territory_id FROM app.current_scope_territories() ORDER BY territory_id LIMIT 200")
    territories = [r[0] for r in cur.fetchall()]
    evidence = build_evidence(cur, hcp_id, profile, through)
    fingerprint = source_fingerprint(cur, hcp_id)

    started = now()
    brief_id = _new_brief_id(started)
    task = {
        "type": "pre_call_brief",
        "brief_id": brief_id,
        "hcp_id": hcp_id,
        "objective": objective,
        "regenerates_brief_id": regenerates or None,
        "scope_label": scope_label,
        "scope_territory_ids": territories,
        "data_through": _iso(through),
        "fingerprint": fingerprint,
        **evidence,
    }
    payload = {
        "identity": {
            "user_id": user_id,
            "persona": identity.db_persona,
            "full_name": identity.full_name,
            "email": identity.email,
            "correlation_id": correlation_id,
        },
        "thread_id": brief_id,
        "run_id": brief_id,
        "messages": [{"role": "user", "content": "Generate the pre-call brief."}],
        "task": task,
    }
    saved = False
    try:
        for event in runtime.invoke(payload, timeout=AGENT_TIMEOUT_SECONDS):
            kind = event.get("type")
            if kind == "RUN_ERROR":
                raise Unavailable("brief_generation_failed")
            if kind == "CUSTOM" and event.get("name") == "brief_saved":
                saved = bool((event.get("value") or {}).get("saved"))
            if kind == "RUN_FINISHED":
                break
    except Unavailable:
        raise
    except Exception as exc:
        log.error("brief agent call failed", brief_id=brief_id, error_type=type(exc).__name__)
        raise Unavailable("brief_agent") from exc
    if not saved:
        raise Unavailable("brief_not_saved")
    item = store.get(user_id, brief_id)
    if item is None:
        raise Unavailable("brief_not_persisted")
    log.info(
        "brief generated",
        brief_id=brief_id,
        user_id=user_id,
        count=len(item.get("evidence") or []),
        outcome="ok",
    )
    return present(cur, identity, user_id, item)


def get_brief(
    cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, store: BriefStore
) -> dict[str, Any]:
    brief_id = _brief_id(args)
    item = store.get(user_id, brief_id)
    if item is None:
        raise NotFound("unknown_brief")
    result = present(cur, identity, user_id, item)  # raises Forbidden when the HCP is no longer authorized
    log.info("brief opened", brief_id=brief_id, user_id=user_id, outcome="stale" if result["stale"] else "current")
    return result


def _export_dates(evidence: list[Mapping[str, Any]]) -> tuple[str | None, str | None]:
    """Return the included record-date bounds without trusting arbitrary persisted strings."""
    dates: list[str] = []
    for record in evidence:
        value = record.get("date")
        if not isinstance(value, str):
            continue
        try:
            dates.append(dt.date.fromisoformat(value).isoformat())
        except ValueError:
            continue
    return (min(dates), max(dates)) if dates else (None, None)


def export_brief(
    cur: psycopg.Cursor,
    identity: Identity,
    user_id: str,
    args: Mapping[str, Any],
    *,
    store: BriefStore,
    now: Callable[[], dt.datetime] = _now,
) -> dict[str, Any]:
    """Authorize a printable snapshot and record only its id-level audit trail.

    ``present`` deliberately runs first: it owns the owner check and the current RLS-backed HCP
    authorization check, so a territory change refuses export before any document or audit event exists.
    """
    brief_id = _brief_id(args)
    item = store.get(user_id, brief_id)
    if item is None:
        raise NotFound("unknown_brief")
    brief = present(cur, identity, user_id, item)
    exported_at = _iso(now())
    cur.execute(
        "INSERT INTO audit_events(actor_user_id, action, resource_type, resource_id, outcome, correlation_id) "
        "VALUES (%s, %s, %s, %s, %s, current_setting('app.correlation_id', true))",
        (user_id, "brief.exported", "pre_call_brief", brief_id, "allowed"),
    )
    citations = brief["evidence"]
    date_from, date_to = _export_dates(citations)
    log.info("brief exported", brief_id=brief_id, user_id=user_id, citation_count=len(citations), outcome="allowed")
    return {
        "briefId": brief_id,
        "hcpName": brief["hcpName"]["value"] or "HCP name not recorded",
        "objective": brief["objective"],
        "scopeLabel": brief["scopeLabel"],
        "dateRangeFrom": date_from,
        "dateRangeTo": date_to,
        "dataThrough": brief["dataThrough"],
        "generatedAt": brief["generatedAt"],
        "exportedAt": exported_at,
        "facts": brief["facts"],
        "engagement": brief["engagement"],
        "perspectives": brief["perspectives"],
        "followUps": brief["followUps"],
        "prompts": brief["prompts"],
        "agenda": brief["agenda"],
        "missing": brief["missing"],
        "citations": citations,
    }


def my_briefs(
    cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, store: BriefStore
) -> list[dict[str, Any]]:
    through = _data_through(cur)
    out: list[dict[str, Any]] = []
    for item in store.list_for(user_id):
        if item.get("ownerUserId") != user_id:
            continue
        accessible, name, stale = True, None, False
        try:
            profile = _authorize(cur, identity, item["hcpId"])
            name = profile[1]
            stale = bool(_stale_reasons(item, source_fingerprint(cur, item["hcpId"]), through))
        except Forbidden:
            accessible = False  # kept in the list so the owner sees why it cannot be opened; nothing else is revealed
        out.append(
            {
                "briefId": item["briefId"],
                "hcpId": item["hcpId"] if accessible else None,
                "hcpName": {"value": name, "state": "MISSING" if name is None else "PRESENT"} if accessible else None,
                "objective": item["objective"] if accessible else None,
                "generatedAt": item["generatedAt"],
                "dataThrough": item.get("dataThrough"),
                "accessible": accessible,
                "stale": stale,
            }
        )
    log.info("briefs listed", user_id=user_id, count=len(out))
    return out


def _edited_items(
    raw: Any, existing: list[Mapping[str, Any]], evidence_ids: set[str], name: str
) -> list[dict[str, Any]]:
    if not isinstance(raw, list) or len(raw) > MAX_ITEMS:
        raise BadRequest(f"invalid_{name}")
    previous = {i["itemId"]: i for i in existing}
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in raw:
        if not isinstance(entry, Mapping):
            raise BadRequest(f"invalid_{name}")
        text = _clean(entry.get("text"), f"{name}_text", minimum=1, maximum=MAX_ITEM_TEXT)
        detail_raw = entry.get("detail")
        detail = _clean(detail_raw, f"{name}_detail", minimum=0, maximum=MAX_ITEM_DETAIL) if detail_raw not in (None, "") else None
        item_id = entry.get("itemId")
        if item_id in (None, ""):
            item_id = f"u-{uuid.uuid4().hex[:10]}"
        elif not isinstance(item_id, str) or not _ITEM_ID.match(item_id):
            raise BadRequest(f"invalid_{name}_id")
        if item_id in seen:
            raise BadRequest(f"duplicate_{name}_id")
        seen.add(item_id)
        before = previous.get(item_id)
        if before is None and not str(item_id).startswith("u-"):
            # Only the generator mints generated ids; a client cannot claim one.
            raise BadRequest(f"invalid_{name}_id")
        if before is None:
            out.append({"itemId": item_id, "text": text, "detail": detail, "evidenceIds": [], "origin": "USER", "edited": False})
            continue
        # Evidence stays whatever the generator attached: an edit cannot cite records it was never given.
        edited = bool(before.get("edited")) or text != before["text"] or (detail or None) != (before.get("detail") or None)
        out.append(
            {
                "itemId": item_id,
                "text": text,
                "detail": detail,
                "evidenceIds": [e for e in before.get("evidenceIds") or [] if e in evidence_ids],
                "origin": before.get("origin", "GENERATED"),
                "edited": edited,
            }
        )
    return out


def save_brief_edits(
    cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any], *, store: BriefStore, now: Callable[[], dt.datetime] = _now
) -> dict[str, Any]:
    payload = args.get("input")
    if not isinstance(payload, Mapping):
        raise BadRequest("invalid_input")
    brief_id = _brief_id(payload)
    item = store.get(user_id, brief_id)
    if item is None:
        raise NotFound("unknown_brief")
    _authorize(cur, identity, item["hcpId"])  # a brief for an HCP the caller can no longer see cannot be edited either
    evidence_ids = {e["evidenceId"] for e in item.get("evidence") or []}
    changes: dict[str, Any] = {}
    if payload.get("objective") is not None:
        changes["objective"] = _clean(payload.get("objective"), "objective", minimum=MIN_OBJECTIVE, maximum=MAX_OBJECTIVE)
    if payload.get("prompts") is not None:
        changes["prompts"] = _edited_items(payload["prompts"], item.get("prompts") or [], evidence_ids, "prompts")
    if payload.get("agenda") is not None:
        changes["agenda"] = _edited_items(payload["agenda"], item.get("agenda") or [], evidence_ids, "agenda")
    if not changes:
        raise BadRequest("nothing_to_save")
    changes["updatedAt"] = _iso(now())
    if not store.update_edits(user_id, brief_id, changes):
        raise NotFound("unknown_brief")
    updated = store.get(user_id, brief_id)
    if updated is None:
        raise NotFound("unknown_brief")
    log.info("brief edited", brief_id=brief_id, user_id=user_id, count=len(changes))
    return present(cur, identity, user_id, updated)
