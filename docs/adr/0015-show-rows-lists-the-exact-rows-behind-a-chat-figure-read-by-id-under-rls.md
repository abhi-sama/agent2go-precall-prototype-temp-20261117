# "Show rows" lists the exact rows behind a figure in a chat answer, read by id under RLS

Ticket #84 (spec #63, stories 12 to 14). A numeric chat answer can carry a collapsed **Show rows** control. Opened, it lists exactly the rows the figure counted (the calls, the HCPs or the recorded responses) as a sortable, paged table, and offers a CSV export where the user is permitted. It exists only for users with record-level access; an aggregate-only user never sees it and gets a clear note instead.

## The agent describes the rows; the BE Lambda lists them

The approved path is unchanged: browser -> FE AppSync -> BE Lambda -> agent (ADR 0001). The model computes nothing and picks no rows.

- When a read tool returns a count, a share or a chart total, it also records a **row set** (`row_sets.py`): the kind of row (`calls`, `hcps`, `responses`), the filters its query used (period, territory, product, specialty, topic, question, answer type, answer label) and the count it returned. It streams as a `CUSTOM row_sets` event, next to the facts and citations, and lands in the run's event log like every other event. The model never sees it and cannot change it.
- One row set per figure: calls, engaged HCPs and responses for an activity summary; the matching responses for a topic search; all the responses to a question plus the responses that chose each answer (the share's denominator and numerator); the free-text responses of a trend; and the rows a chart's total counted. Identical row sets are kept once, at most 14 per run, none for a count of zero or a territory outside the caller's scope.
- The browser asks for the table with `chatAnswerRows(runId, rowSetId, sortBy, sortDir, offset, limit)`. The BE Lambda checks that the run is the caller's own (another user's run reads as "not found", like a run that does not exist), checks record-level access, **reads the description from the run's own event log** (never from the client), validates it again, and runs a parameterised query under the caller's RLS session. Sort columns come from a closed list per kind; dates, territory, product, topic and question id are bound parameters. So the client can choose a sort and a page and nothing else: it cannot widen the rows.
- Pages are sorted on the server (ties break on the row id, nulls last), 25 rows by default and at most 100, so paging a sorted set never repeats or skips a row. The page carries the **total counted now** and the **figure the answer stated**; the panel says "matching the figure in the answer", or, if the data was reloaded since, that it changed.
- The "answered X" sets use the question breakdown's own option logic (select-all counts once per option chosen, open text groups by theme, ranking by first choice), so a share's numerator rows equal its numerator.

## Export re-checks access and is audited

`exportChatRows` (a mutation, like the brief and leadership-summary exports) re-checks run ownership, record-level access and a separate permission, **`chat.rows.export`** (granted to MSL, Director and Administrator; an administrator can withdraw it in the access matrix and the user keeps the rows but not the download), builds a CSV of the same rows in the same sort (at most 5,000; larger sets say so), and writes an id-level audit event before returning: `chat_rows.exported`, resource `chat_row_set`, `<run>:<row set>`, with kind and counts as metadata and never any row content. The file opens with a `[SOURCE]` header (the words other exports use), the scope, period, the figure and the row count, and a text cell that a spreadsheet would run as a formula is stored as text.

Migration 012 adds the permission and a narrow `audit_events` insert policy (own actor, `chat_rows.exported`, allowed). That policy also covers the existing per-record export in the evidence drawer, which wrote the same audit action but had no policy, so a non-administrator's export would have been refused; that export now needs the same permission.

## Aggregate-only callers

An Executive reads suppressed aggregates (ADR 0009 and 0013) and never source rows. The agent emits no row set for them; it emits a `rows_unavailable` event once per run when an aggregate tool or a refused record tool runs, and the panel shows "Rows are not available for this answer" with the reason (and the existing small-group note). `chatAnswerRows` and `exportChatRows` refuse them with `Forbidden`, for their own run and for anyone else's.

## What it looks like

A `Show rows` button under the answer (44pt on touch), collapsed and not rendered until opened (the row query does not run while closed). The panel is a *source fact* card (ADR 0014's AI-content family): a chip per figure ("Distinct calls · 148"), the definition of a row, the scope and period, the match line, a table with sortable headers (`aria-sort`, tabular numerals, sticky first column, its own horizontal scroll so the page never scrolls sideways), a pager, and **Export CSV**. A page change keeps the previous page on screen, dimmed, until the next arrives.

## Testing

- `backend/lambdas/api/tests/test_chat_rows_unit.py` and `test_chat_rows_db.py`: validation, access ordering (nothing is read or audited before access and permission pass), bound parameters, tampered descriptions, RLS limits, independent recounts for every kind and filter, stable paging, CSV hygiene, the audit policy.
- `backend/agent/tests/test_row_sets.py` and `test_row_sets_db.py`: each tool's row sets against hand-written ground truth and independent SQL; aggregate-only gets none.
- `tests/api/test_chat_rows.py`: as seeded personas with live Claude through AppSync (counts, share, chart, Director region, another user's run, Executive, export, audit, the permission withdrawn).
- `frontend/e2e/chat.spec.ts` ("Show rows") and the `chat-answer-rows*` and `chat-answer-aggregate-only` screens: collapsed by default, sorting, paging, export, no-export, aggregate-only, touch targets, at every viewport of the matrix; `chat-answer-rows` is also in the style x mode appearance matrix.

## Answer-quality suite (scorer `deterministic-v3`)

Every counted answer now also proves **row-count-equals-answer**. The runner recounts each row set the agent described, under the eval subject's own RLS, with the BE Lambda's own predicate; the scorer (`score_rows`) fails a question when a table lists a different number of rows than its figure (`ROWS_MISMATCH`), when a single-turn counted answer has no row set for the SQL figure (`ROWS_MISSING`; for a share both the denominator and the numerator), when an aggregate-only persona is shown any rows (a `NO_ACCESS_DATA` leak), or when rows are described for a territory the subject cannot read (`TERRITORY_ROWS`). Run level: `rowMatchRate` must be 100% like exact counts. New golden questions ask for the rows behind a number (four per record persona, two for the Executive) and require the answer to point to Show rows; two more leak probes ask for a foreign territory's rows. The scorer name is stored on each run, so v2 runs are not mixed into a diff silently. The MSL, Director and Administrator suites now have 48 to 52 single-turn questions plus four conversations (the Executive 37 plus two).

## Not covered here

- HCPs who answered a question (a respondent count) and the other measures of a table visual have no row kind of their own.
- Row sets belong to the run's event log (ADR 0007), which is working state; a conversation reopened from history shows the answer but not a Show rows control.
- Directors reading more than the 5,000-row cap export the first 5,000 rows and the file says so.
