# Feature map

The foundation (ticket 01, #2) is the shared base.
Every other persona feature is an independent vertical slice, tracked as a sub-issue of the spec #1.
Each slice touches schema, BE resolver, UI and tests on its own, so slices can be built in parallel once their blockers merge.

## Slices

Ready as soon as #2 merges:

| Ticket | Issue | Slice | Blocked by |
|---|---|---|---|
| 02 | #3 | Chat tracer: streamed, cited AI answer through the AgentCore path | #2 |
| 03 | #4 | Authorized HCP search and HCP profile card | #2 |
| 07 | #8 | Shared filter bar, saved views, response distributions, question discovery | #2 |
| 09 | #10 | Personal activity trends, freshness/evidence drawer, flag-an-issue | #2 |
| 14 | #15 | Admin access: login-to-roster mapping, roles, effective-dated assignments, access audit | #2 |
| 16 | #17 | Admin data quality: ingestion monitoring, identity/duplicate validation, question dependencies | #2 |

Then, as their blockers land:

| Ticket | Issue | Slice | Blocked by |
|---|---|---|---|
| 04 | #5 | HCP interaction timeline, recorded perspectives, parent-question context | #4 |
| 05 | #6 | Pre-call brief: objective, generated brief and agenda, saved with staleness | #3, #5 |
| 06 | #7 | Pre-call brief export | #6 |
| 08 | #9 | Qualitative themes, follow-up topics, semantic insight search | #3, #8 |
| 10 | #11 | Director overview: team activity, mix, engagement, territory comparisons | #8 |
| 11 | #12 | Director insights: heatmap, question analytics, emerging topics, drill-down, exceptions, summaries | #9, #11 |
| 12 | #13 | Executive overview: trends, regional comparisons, aggregate-only access, controlled drill-down | #11 |
| 13 | #14 | Executive themes, cross-region topics, leadership summaries | #7, #12, #13 |
| 15 | #16 | Admin hierarchy: tree validation, transfers and temporary coverage, catalog vs response visibility | #15 |
| 17 | #18 | Admin governance: status reconciliation, metric definitions, retention queues, issue assistant | #3, #17 |
| 18 | #19 | AI evaluation panel: golden suites, automatic scoring, leak probes, history, human ratings | #3, #6 |
| 19 | #20 | Authorization verification grid across API, chat, caches and exports | #6, #7, #13, #16 |
| 20 | #21 | iPad PWA with encrypted offline briefs and sync queue | #6, #10 |
| 21 | #22 | 3D analytics visuals beyond the landing page | #12 |
| 22 | #23 | MSL optional: post-call drafts, confirmed follow-up tasks, topic alerts | #3, #9 |
| 23 | #24 | AWS infrastructure definitions: Amplify Gen2 FE and BE CDK (not deployed) | #3 |

## Adding a data-backed field (the pattern every slice follows)

1. Add the type and query or mutation to `frontend/amplify/data/schema.graphql`.
2. Add the field to `BE_FIELDS` in `frontend/amplify/api/resource.ts`; the shared resolver forwards it to the BE Lambda.
3. Implement it in `backend/lambdas/api/src/a2g_api/resolvers.py` and register it in `handler.py`.
   It receives a cursor already bound to the caller's scope, so RLS filters every query; compute numbers in SQL.
   Refuse with the typed errors in `errors.py`.
4. Add the document to `frontend/src/lib/data/operations.ts` and a method to `DataAdapter`, the GraphQL adapter, and the mock adapter.
5. Prove it through the API as a persona with `tests/api/harness.py`: allowed scope, denied scope, and an effective-dated change where it matters.
6. Log ids, counts and enums only, through `a2g_logging` (BE) or `@/lib/log/logger` (FE).
7. Run `backend/infra/scripts/up.sh` (it redeploys the schema and Lambda), then `backend/infra/scripts/test.sh`.

## Fields added by slices

| Ticket | Fields | Notes |
|---|---|---|
| 09 (#10) | `activityTrends`, `activityEvidence`, `myFlags`, `flagIssue` | Flags are stored in FE DynamoDB and written by the BE Lambda (ADR 0006). |
| 10 (#11) | `directorOverview`, `territoryComparison` | Gated by the `team.overview.read` permission; coverage reads the new `target_assignments` table (ADR 0008). |
| 05 (#6) | `generateBrief`, `preCallBrief`, `myBriefs`, `saveBriefEdits` | Briefs are written by the agent and saved to FE DynamoDB; the BE Lambda reopens them with access re-checked and staleness computed (ADR 0009). |
| 12 (#13) | `executiveOverview`, `executiveDrilldown` | Aggregate-only, explicit executive scope, small groups withheld; drill-down needs `source.records.read` (ADR 0009). |
| 11 (#12) | `topicHeatmap`, `questionAnalytics`, `emergingTopics`, `directorDrilldown`, `directorExceptions`, `territorySummaryEvidence`; `startChatRun` takes an optional screen `context` | Same gate as ticket 10. Theme and emerging-topic rules are SQL functions shared with the agent (ADR 0011); AI territory summaries run through the chat path. |
| 21 (#22) | none (UI only) | A third **3D** view on the Director insights heatmap, drawn from `topicHeatmap`; 2D fallback and reduced motion (ADR 0012). |
| 18 (#19) | `evalSuites`, `evalRuns`, `evalRun`, `evalRunDiff`, `evalRatings`, `startEvalRun`, `rateAnswer` | Administrators run golden suites per persona through the real agent; runs, results and ratings are stored in FE DynamoDB (`a2g-eval`); the worker is `a2g-be-eval` (ADR 0013). Any persona rates its own finished chat answer. |
