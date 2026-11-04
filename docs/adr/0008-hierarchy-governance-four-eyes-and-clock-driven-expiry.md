# Hierarchy governance: validated graph, four-eyes scope changes, expiry by the clock

Status: accepted (ticket 15, #16)

## Decisions

1. **The hierarchy is validated, not assumed a tree.**
   `adminHierarchy` reads the effective versioned relationships and the source hierarchy feed, and reports `CYCLE`, `ORPHAN_TERRITORY`, `MISSING_LINK`, `OVERLAP` and `UNCOVERED_TERRITORY` findings (`hierarchy_graph.py`, pure code with unit tests).
   A territory with several parents is legal (glossary), so it is a warning; a cycle, an in-use territory with no links, or a source link that access does not follow are errors.
   Cycle detection is iterative so a deep hierarchy cannot hit the recursion limit, and `app.current_scope_territories()` already guards against cycles, so a damaged hierarchy never makes access loop.
2. **Transfers and temporary coverage are requested by one administrator and decided by another.**
   `scope_change_requests` keeps who asked, who decided, when and why; the assignments an approval writes carry `request_id`, so the timeline shows the trail beside each grant.
   A check constraint and the resolver both refuse a self-decision.
   Temporary coverage must have an end date; a transfer ends the old primary assignment and starts the new one at the same instant, so they never overlap.
   An approval cannot reach back: access starts at the later of the requested start and the approval.
3. **Expiry is the clock, not a job.**
   Access reads `user_scope_assignments` at `now()`, so coverage stops at `effective_to` with nothing to run.
   The timeline's `SCHEDULED / ACTIVE / EXPIRED` status is computed from the same clock.
4. **Catalog visibility and response access are two separate matrices.**
   They map to different permissions (`catalog.read` against `source.records.read` and `aggregate.read`), each has its own mutation that touches only its own permissions, and each is audited under its own action.
   `catalogQuestions` needs `catalog.read` only; `questionResponses` needs `source.records.read` and is still limited by territory scope under RLS.
   Seeing a catalog question therefore never grants its responses.

## Consequences

- Visibility is per role, not per question. Per-question catalog policy would need a new table and is a follow-up.
- The orphan check looks at territories seen in assignments, the roster, the call feed, the insight feed and the source hierarchy. `territory_geography` is excluded because its row policy hides territories outside the caller's scope, even from an administrator.
- Hierarchy edits themselves (adding or ending a relationship) are not exposed in the API yet; the screen validates and explains, it does not rewrite.
