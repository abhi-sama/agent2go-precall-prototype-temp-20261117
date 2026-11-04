"""Administrator hierarchy governance (ticket 15).

* ``adminHierarchy``: the territory graph with cycles, orphans, missing links, overlaps and
  inheritance validated (``hierarchy_graph``).
* ``adminAccessTimeline`` / ``requestScopeChange`` / ``decideScopeChange``: transfers and
  temporary coverage on an effective-dated timeline with a four-eyes approval trail.
* ``adminVisibility`` / ``setCatalogVisibility`` / ``setResponseAccess``: the catalog-access and
  response-access matrices, changed independently.
* ``catalogQuestions`` / ``questionResponses``: the two reads those matrices govern.

Everything is deterministic SQL under RLS; no AI decides access.  Logs carry ids and counts only.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from collections.abc import Mapping
from typing import Any

import psycopg

from a2g_logging import get_logger

from . import hierarchy_graph as graph
from .errors import BadRequest, Forbidden, NotFound
from .identity import Identity

log = get_logger(__name__)

REQUEST_KINDS = {"TRANSFER": "transfer", "TEMPORARY_COVERAGE": "temporary_coverage"}
KIND_NAMES = {v: k for k, v in REQUEST_KINDS.items()}
RESPONSE_LEVELS = ("NONE", "AGGREGATE_ONLY", "RECORDS")
MAX_TIMELINE_ROWS = 500
MAX_CATALOG_ROWS = 200
MAX_RESPONSE_ROWS = 100
CATALOG_PERMISSION = "catalog.read"
RECORDS_PERMISSION = "source.records.read"
AGGREGATE_PERMISSION = "aggregate.read"

_TERRITORY_EXISTS = """
  EXISTS (SELECT 1 FROM territory_rd_access WHERE child_territory_id = %(t)s OR parent_territory_id = %(t)s)
  OR EXISTS (SELECT 1 FROM territory_scope_relationships WHERE child_territory_id = %(t)s OR parent_territory_id = %(t)s)
"""


def _require_admin(cur: psycopg.Cursor) -> None:
    cur.execute("SELECT app.has_permission('admin.manage')")
    if not cur.fetchone()[0]:
        raise Forbidden("admin_manage_required")


def _audit(cur: psycopg.Cursor, actor: str, action: str, resource_type: str, resource_id: str, outcome: str) -> None:
    cur.execute(
        "INSERT INTO audit_events(actor_user_id, action, resource_type, resource_id, outcome, correlation_id) "
        "VALUES (%s, %s, %s, %s, %s, current_setting('app.correlation_id', true))",
        (actor, action, resource_type, resource_id, outcome),
    )


def _iso(value: dt.datetime | None) -> str | None:
    return value.isoformat() if value else None


def _timestamp(value: Any, name: str, *, required: bool = False) -> dt.datetime | None:
    if value in (None, ""):
        if required:
            raise BadRequest(f"missing_{name}")
        return None
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise BadRequest(f"invalid_{name}") from exc
    if parsed.tzinfo is None:
        raise BadRequest(f"invalid_{name}")
    return parsed


def _text(value: Any, name: str, *, limit: int = 200) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise BadRequest(f"invalid_{name}")
    return value.strip()


# --------------------------------------------------------------------------------------------
# Hierarchy graph
# --------------------------------------------------------------------------------------------


def admin_hierarchy(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    _require_admin(cur)
    cur.execute(
        """
        SELECT child_territory_id, parent_territory_id, min(effective_from), count(*)
        FROM territory_scope_relationships
        WHERE effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
        GROUP BY 1, 2
        """
    )
    scope_rows = cur.fetchall()
    scope_pairs = {(c, p) for c, p, _f, _n in scope_rows}
    from_by_pair = {(c, p): _iso(f) for c, p, f, _n in scope_rows}
    # Duplicated links: the same pair recorded twice whose effective windows overlap now.
    duplicate_pairs = {(c, p) for c, p, _f, n in scope_rows if n > 1}

    cur.execute("SELECT DISTINCT child_territory_id, parent_territory_id, child_territory_name FROM territory_rd_access WHERE child_territory_id IS NOT NULL")
    names: dict[str, str] = {}
    source_pairs: set[tuple[str, str]] = set()
    parentless: set[str] = set()
    for child, parent, child_name in cur.fetchall():
        if child_name:
            names.setdefault(child, child_name)
        if parent is None:
            parentless.add(child)
        else:
            source_pairs.add((child, parent))

    cur.execute(
        """
        SELECT territory_id FROM user_scope_assignments WHERE effective_to IS NULL OR effective_to > now()
        UNION SELECT territory_id FROM medical_roster WHERE territory_id IS NOT NULL
        UNION SELECT territory_id FROM call_activity WHERE territory_id IS NOT NULL
        UNION SELECT territory_id FROM hcp_raw_insights WHERE territory_id IS NOT NULL
        UNION SELECT child_territory_id FROM territory_rd_access WHERE child_territory_id IS NOT NULL
        """
    )
    universe = {row[0] for row in cur.fetchall()}

    cur.execute(
        """
        SELECT a.user_id, coalesce(u.display_name, ''), a.assignment_type, a.territory_id
        FROM user_scope_assignments a JOIN users u ON u.user_id = a.user_id
        WHERE a.effective_from <= now() AND (a.effective_to IS NULL OR a.effective_to > now())
        """
    )
    holders = [graph.Holder(uid, name, kind, territory) for uid, name, kind, territory in cur.fetchall()]

    edges = graph.merge_edges(scope_pairs, source_pairs, from_by_pair)
    analysis = graph.analyze(edges, universe, names, holders, source_pairs, scope_pairs, parentless, duplicate_pairs)
    findings = [
        {"code": f.code, "severity": f.severity, "territoryIds": f.territory_ids, "message": f.message}
        for f in analysis.findings
    ]
    log.info(
        "hierarchy validated",
        node_count=len(analysis.nodes),
        edge_count=len(edges),
        error_count=sum(1 for f in findings if f["severity"] == graph.ERROR),
    )
    return {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "nodes": list(analysis.nodes.values()),
        "edges": [
            {"childId": e.child, "parentId": e.parent, "source": e.source, "effectiveFrom": e.effective_from}
            for e in edges
        ],
        "findings": findings,
        "errorCount": sum(1 for f in findings if f["severity"] == graph.ERROR),
        "warningCount": sum(1 for f in findings if f["severity"] == graph.WARNING),
    }


# --------------------------------------------------------------------------------------------
# Access timeline, transfers and temporary coverage
# --------------------------------------------------------------------------------------------

_REQUEST_COLUMNS = """
  r.request_id, r.kind, r.user_id, coalesce(u.display_name, ''), r.from_territory_id, r.to_territory_id,
  r.effective_from, r.effective_to, r.reason, r.status, r.requested_by, r.requested_at,
  r.decided_by, r.decided_at, r.decision_note
"""


def _request_dict(row: tuple[Any, ...]) -> dict[str, Any]:
    (rid, kind, uid, name, frm, to, eff_from, eff_to, reason, status, by, at, decided_by, decided_at, note) = row
    return {
        "requestId": str(rid),
        "kind": KIND_NAMES[kind],
        "userId": uid,
        "displayName": name,
        "fromTerritoryId": frm,
        "toTerritoryId": to,
        "effectiveFrom": _iso(eff_from),
        "effectiveTo": _iso(eff_to),
        "reason": reason,
        "status": status.upper(),
        "requestedBy": by,
        "requestedAt": _iso(at),
        "decidedBy": decided_by,
        "decidedAt": _iso(decided_at),
        "decisionNote": note,
    }


def _requests(cur: psycopg.Cursor, *, user_id: str | None = None, request_id: int | None = None) -> list[dict[str, Any]]:
    cur.execute(
        f"""
        SELECT {_REQUEST_COLUMNS}
        FROM scope_change_requests r JOIN users u ON u.user_id = r.user_id
        WHERE (%(u)s::text IS NULL OR r.user_id = %(u)s) AND (%(r)s::bigint IS NULL OR r.request_id = %(r)s)
        ORDER BY r.requested_at DESC, r.request_id DESC LIMIT {MAX_TIMELINE_ROWS}
        """,
        {"u": user_id, "r": request_id},
    )
    return [_request_dict(row) for row in cur.fetchall()]


def _entries(cur: psycopg.Cursor, user_id: str | None) -> list[dict[str, Any]]:
    cur.execute(
        f"""
        SELECT a.assignment_id, a.user_id, coalesce(u.display_name, ''), a.territory_id, a.assignment_type,
               a.effective_from, a.effective_to, a.approved_by, a.request_id,
               CASE WHEN a.effective_from > now() THEN 'SCHEDULED'
                    WHEN a.effective_to IS NOT NULL AND a.effective_to <= now() THEN 'EXPIRED'
                    ELSE 'ACTIVE' END,
               CASE WHEN a.effective_to IS NOT NULL AND a.effective_to > now()
                    THEN extract(epoch FROM (a.effective_to - now()))::bigint END,
               NOT ({_TERRITORY_EXISTS.replace('%(t)s', 'a.territory_id')})
        FROM user_scope_assignments a JOIN users u ON u.user_id = a.user_id
        WHERE (%(u)s::text IS NULL OR a.user_id = %(u)s)
        ORDER BY a.effective_from DESC, a.assignment_id DESC LIMIT {MAX_TIMELINE_ROWS}
        """,
        {"u": user_id},
    )
    return [
        {
            "assignmentId": str(aid),
            "userId": uid,
            "displayName": name,
            "territoryId": territory,
            "assignmentType": kind,
            "effectiveFrom": _iso(frm),
            "effectiveTo": _iso(to),
            "approvedBy": approver,
            "requestId": str(rid) if rid is not None else None,
            "status": status,
            "secondsRemaining": remaining,
            "unresolvedTerritory": bool(unresolved),
            "_from": frm,
            "_to": to,
        }
        for aid, uid, name, territory, kind, frm, to, approver, rid, status, remaining, unresolved in cur.fetchall()
    ]


def _overlaps(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    live = [e for e in entries if e["status"] != "EXPIRED"]
    found: list[dict[str, Any]] = []
    by_user_territory: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    primaries: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in live:
        by_user_territory[(entry["userId"], entry["territoryId"])].append(entry)
        if entry["assignmentType"] == "primary":
            primaries[entry["territoryId"]].append(entry)
    for (uid, territory), group in sorted(by_user_territory.items()):
        for i, a in enumerate(group):
            for b in group[i + 1:]:
                if graph.windows_overlap(a["_from"], a["_to"], b["_from"], b["_to"]):
                    found.append({
                        "kind": "SAME_USER_DUPLICATE", "userId": uid, "territoryId": territory,
                        "assignmentIds": sorted([a["assignmentId"], b["assignmentId"]], key=int),
                        "message": f"{uid} holds {territory} through more than one assignment at the same time.",
                    })
    for territory, group in sorted(primaries.items()):
        for i, a in enumerate(group):
            for b in group[i + 1:]:
                if a["userId"] != b["userId"] and graph.windows_overlap(a["_from"], a["_to"], b["_from"], b["_to"]):
                    found.append({
                        "kind": "SHARED_PRIMARY", "userId": None, "territoryId": territory,
                        "assignmentIds": sorted([a["assignmentId"], b["assignmentId"]], key=int),
                        "message": f"{territory} has two primary holders ({a['userId']}, {b['userId']}) at the same time.",
                    })
    return found


def admin_access_timeline(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    _require_admin(cur)
    target = args.get("userId")
    if target is not None and (not isinstance(target, str) or not target.strip()):
        raise BadRequest("invalid_user_id")
    entries = _entries(cur, target)
    overlaps = _overlaps(entries)
    for entry in entries:
        entry.pop("_from")
        entry.pop("_to")
    return {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "entries": entries,
        "requests": _requests(cur, user_id=target),
        "overlaps": overlaps,
    }


def _check_territory(cur: psycopg.Cursor, territory: str) -> None:
    cur.execute(f"SELECT {_TERRITORY_EXISTS}", {"t": territory})
    if not cur.fetchone()[0]:
        raise BadRequest("unresolved_territory")


def _held_primary(cur: psycopg.Cursor, target: str, territory: str, at: dt.datetime) -> int | None:
    cur.execute(
        """
        SELECT assignment_id FROM user_scope_assignments
        WHERE user_id = %s AND territory_id = %s AND assignment_type = 'primary'
          AND effective_from < %s AND (effective_to IS NULL OR effective_to > %s)
        ORDER BY effective_from DESC LIMIT 1 FOR UPDATE
        """,
        (target, territory, at, at),
    )
    row = cur.fetchone()
    return int(row[0]) if row else None


def request_scope_change(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    _require_admin(cur)
    q = args.get("input") or {}
    kind_name = q.get("kind")
    if kind_name not in REQUEST_KINDS:
        raise BadRequest("invalid_kind")
    kind = REQUEST_KINDS[kind_name]
    target = _text(q.get("userId"), "user_id")
    to_territory = _text(q.get("toTerritoryId"), "to_territory_id")
    from_territory = q.get("fromTerritoryId")
    reason = _text(q.get("reason"), "reason", limit=500)
    eff_from = _timestamp(q.get("effectiveFrom"), "effective_from", required=True)
    eff_to = _timestamp(q.get("effectiveTo"), "effective_to")
    now = dt.datetime.now(dt.timezone.utc)

    cur.execute("SELECT 1 FROM users WHERE user_id = %s", (target,))
    if not cur.fetchone():
        raise BadRequest("unknown_user")
    _check_territory(cur, to_territory)

    if kind == "transfer":
        from_territory = _text(from_territory, "from_territory_id")
        if eff_to is not None:
            raise BadRequest("transfer_has_no_end_date")
        if from_territory == to_territory:
            raise BadRequest("transfer_to_same_territory")
        if _held_primary(cur, target, from_territory, max(eff_from, now)) is None:
            raise BadRequest("no_primary_assignment_to_transfer")
    else:
        from_territory = None
        if eff_to is None:
            raise BadRequest("coverage_needs_end_date")
        if eff_to <= eff_from or eff_to <= now:
            raise BadRequest("invalid_coverage_window")

    cur.execute(
        """
        INSERT INTO scope_change_requests(kind, user_id, from_territory_id, to_territory_id, effective_from, effective_to, reason, requested_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING request_id
        """,
        (kind, target, from_territory, to_territory, eff_from, eff_to, reason, user_id),
    )
    rid = int(cur.fetchone()[0])
    _audit(cur, user_id, "scope_change.requested", "scope_change_request", str(rid), "pending")
    return _requests(cur, request_id=rid)[0]


def _insert_assignment(cur: psycopg.Cursor, target: str, territory: str, kind: str, start: dt.datetime, end: dt.datetime | None, approver: str, rid: int) -> int:
    cur.execute(
        "INSERT INTO user_scope_assignments(user_id, territory_id, assignment_type, effective_from, effective_to, approved_by, request_id) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING assignment_id",
        (target, territory, kind, start, end, approver, rid),
    )
    aid = int(cur.fetchone()[0])
    _audit(cur, approver, "scope_assignment.created", "user_scope_assignment", str(aid), "scheduled" if start > dt.datetime.now(dt.timezone.utc) else "applied")
    return aid


def decide_scope_change(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    _require_admin(cur)
    q = args.get("input") or {}
    try:
        rid = int(q.get("requestId"))
    except (TypeError, ValueError) as exc:
        raise BadRequest("invalid_request_id") from exc
    decision = q.get("decision")
    if decision not in ("APPROVE", "REJECT"):
        raise BadRequest("invalid_decision")
    note = q.get("note")
    if note is not None:
        note = _text(note, "note", limit=500)

    # A plain read first: the update policy hides decided requests from FOR UPDATE, which would
    # otherwise read as "not found" instead of "already decided".
    cur.execute("SELECT status FROM scope_change_requests WHERE request_id = %s", (rid,))
    seen = cur.fetchone()
    if seen is None:
        raise NotFound("unknown_request")
    if seen[0] != "pending":
        raise BadRequest("request_already_decided")
    cur.execute(
        "SELECT kind, user_id, from_territory_id, to_territory_id, effective_from, effective_to, status, requested_by "
        "FROM scope_change_requests WHERE request_id = %s FOR UPDATE",
        (rid,),
    )
    row = cur.fetchone()
    if row is None:
        raise NotFound("unknown_request")
    kind, target, from_territory, to_territory, eff_from, eff_to, _status, requested_by = row
    if requested_by == user_id:
        raise Forbidden("self_approval")

    now = dt.datetime.now(dt.timezone.utc)
    if decision == "REJECT":
        new_status, outcome = "rejected", "rejected"
    else:
        new_status, outcome = "approved", "applied"
        # An approval cannot reach back: access starts no earlier than the approval itself.
        start = max(eff_from, now)
        if eff_to is not None and eff_to <= start:
            raise BadRequest("coverage_already_expired")
        _check_territory(cur, to_territory)
        if kind == "transfer":
            old = _held_primary(cur, target, from_territory, start)
            if old is None:
                raise BadRequest("no_primary_assignment_to_transfer")
            cur.execute("UPDATE user_scope_assignments SET effective_to = %s WHERE assignment_id = %s", (start, old))
            _audit(cur, user_id, "scope_assignment.ended", "user_scope_assignment", str(old), "scheduled" if start > now else "applied")
            _insert_assignment(cur, target, to_territory, "primary", start, None, user_id, rid)
        else:
            _insert_assignment(cur, target, to_territory, "temporary", start, eff_to, user_id, rid)

    cur.execute(
        "UPDATE scope_change_requests SET status = %s, decided_by = %s, decided_at = now(), decision_note = %s WHERE request_id = %s",
        (new_status, user_id, note, rid),
    )
    _audit(cur, user_id, f"scope_change.{new_status}", "scope_change_request", str(rid), outcome)
    return _requests(cur, request_id=rid)[0]


# --------------------------------------------------------------------------------------------
# Catalog visibility vs response access
# --------------------------------------------------------------------------------------------


def _permission_sets(cur: psycopg.Cursor, role_id: str | None = None) -> list[tuple[str, str, set[str]]]:
    cur.execute(
        "SELECT r.role_id, r.role_name, coalesce(array_agg(rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), ARRAY[]::text[]) "
        "FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.role_id "
        "WHERE (%(r)s::text IS NULL OR r.role_id = %(r)s) GROUP BY r.role_id, r.role_name ORDER BY r.role_id",
        {"r": role_id},
    )
    return [(rid, name, set(codes)) for rid, name, codes in cur.fetchall()]


def _level(codes: set[str]) -> str:
    if RECORDS_PERMISSION in codes:
        return "RECORDS"
    return "AGGREGATE_ONLY" if AGGREGATE_PERMISSION in codes else "NONE"


def _catalog_row(rid: str, name: str, codes: set[str]) -> dict[str, Any]:
    return {"roleId": rid, "roleName": name, "catalogVisible": CATALOG_PERMISSION in codes}


def _response_row(rid: str, name: str, codes: set[str]) -> dict[str, Any]:
    return {"roleId": rid, "roleName": name, "level": _level(codes)}


def admin_visibility(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    _require_admin(cur)
    sets = _permission_sets(cur)
    return {
        "catalogMatrix": [_catalog_row(*s) for s in sets],
        "responseMatrix": [_response_row(*s) for s in sets],
    }


def _known_role(cur: psycopg.Cursor, value: Any) -> str:
    role = _text(value, "role_id")
    if not _permission_sets(cur, role):
        raise BadRequest("unknown_role")
    return role


def set_catalog_visibility(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    """Grant or withdraw ``catalog.read`` for a role. No response permission is read or written."""
    _require_admin(cur)
    q = args.get("input") or {}
    role = _known_role(cur, q.get("roleId"))
    visible = q.get("visible")
    if not isinstance(visible, bool):
        raise BadRequest("invalid_visible")
    if visible:
        cur.execute("INSERT INTO role_permissions(role_id, permission_code) VALUES (%s, %s) ON CONFLICT DO NOTHING", (role, CATALOG_PERMISSION))
    else:
        cur.execute("DELETE FROM role_permissions WHERE role_id = %s AND permission_code = %s", (role, CATALOG_PERMISSION))
    _audit(cur, user_id, "catalog_visibility.updated", "role", role, "applied")
    return _catalog_row(*_permission_sets(cur, role)[0])


def set_response_access(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    """Set how much of the HCP responses a role may see. ``catalog.read`` is never touched."""
    _require_admin(cur)
    q = args.get("input") or {}
    role = _known_role(cur, q.get("roleId"))
    level = q.get("level")
    if level not in RESPONSE_LEVELS:
        raise BadRequest("invalid_level")
    wanted = {"RECORDS": {RECORDS_PERMISSION, AGGREGATE_PERMISSION}, "AGGREGATE_ONLY": {AGGREGATE_PERMISSION}, "NONE": set()}[level]
    cur.execute("DELETE FROM role_permissions WHERE role_id = %s AND permission_code = ANY(%s)", (role, [RECORDS_PERMISSION, AGGREGATE_PERMISSION]))
    cur.executemany("INSERT INTO role_permissions(role_id, permission_code) VALUES (%s, %s)", [(role, code) for code in sorted(wanted)])
    _audit(cur, user_id, "response_access.updated", "role", role, "applied")
    return _response_row(*_permission_sets(cur, role)[0])


def catalog_questions(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Catalog questions: gated by ``catalog.read`` alone."""
    cur.execute("SELECT app.can_read_catalog()")
    if not cur.fetchone()[0]:
        raise Forbidden("catalog_visibility_required")
    limit = args.get("limit", 50)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_CATALOG_ROWS:
        raise BadRequest("invalid_limit")
    cur.execute(
        """
        SELECT DISTINCT ON (qstn_ext_id) qstn_ext_id, qstn_txt, qstn_tag_status, molecule_type, tumor_type, study_name, survey_type
        FROM question_tag WHERE qstn_ext_id IS NOT NULL ORDER BY qstn_ext_id, source_row_id DESC LIMIT %s
        """,
        (limit,),
    )
    return [
        {"questionId": qid, "text": text, "status": status, "molecule": molecule, "tumorType": tumor, "study": study, "survey": survey}
        for qid, text, status, molecule, tumor, study, survey in cur.fetchall()
    ]


def question_responses(cur: psycopg.Cursor, identity: Identity, user_id: str, args: Mapping[str, Any]) -> dict[str, Any]:
    """Recorded HCP responses to one question: gated by ``source.records.read`` and territory scope.

    Holding ``catalog.read`` is deliberately irrelevant here.
    """
    cur.execute("SELECT app.has_permission(%s)", (RECORDS_PERMISSION,))
    if not cur.fetchone()[0]:
        raise Forbidden("response_access_required")
    question = _text(args.get("questionId"), "question_id")
    limit = args.get("limit", 25)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_RESPONSE_ROWS:
        raise BadRequest("invalid_limit")
    cur.execute(
        "SELECT count(DISTINCT uniq_rspns_id) FROM hcp_raw_insights WHERE qstn_ext_id = %s AND excluded_rspns_flag IS NOT TRUE",
        (question,),
    )
    total = int(cur.fetchone()[0])
    cur.execute(
        """
        SELECT DISTINCT ON (uniq_rspns_id) uniq_rspns_id, territory_id, date_of_interaction, rspns_txt
        FROM hcp_raw_insights WHERE qstn_ext_id = %s AND excluded_rspns_flag IS NOT TRUE AND uniq_rspns_id IS NOT NULL
        ORDER BY uniq_rspns_id LIMIT %s
        """,
        (question, limit),
    )
    rows = cur.fetchall()
    return {
        "questionId": question,
        "total": total,
        "responses": [
            {"responseId": rid, "territoryId": territory, "interactionDate": day.isoformat() if day else None, "text": text}
            for rid, territory, day, text in rows
        ],
    }
