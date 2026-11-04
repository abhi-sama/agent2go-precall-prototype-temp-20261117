# The Director overview reads RLS-scoped data, withholds coverage without a target population, and fixes one period per comparison

The Director's team and territory overview (`directorOverview`) and side-by-side comparison (`territoryComparison`) are two BE Lambda fields on the approved path (ADR 0001).
Every number is SQL under the caller's RLS scope (ADR 0003); the territory list itself comes from `territory_geography`, whose policy applies the same scope, so only approved descendant territories exist for the caller.

## Decisions

- **Permission.** `team.overview.read` opens both fields. Directors hold it; administrators pass through `admin.manage`; MSLs and Executives are refused (Executives get the aggregate-only overview in #13). The seed and migration 008 grant it.
- **Coverage needs an authoritative target population.** Migration 008 adds `target_assignments` (HCP, territory, `draft`/`approved`, effective-dated). Coverage is engaged target HCPs divided by approved targets in effect at the end of the window. With none, the status is `NO_TARGET_POPULATION` and every coverage number is null: it is never estimated from engaged HCPs. The table starts empty, so the seeded stack shows coverage hidden everywhere.
- **Calls are distinct, product rows are separate.** `distinctCalls` counts `crm_call_id` once; `callProductRows` is the source row count. Mix values count a call once per value, so a dimension's `valueTotal` ("mentions") is returned apart from `totalDistinctCalls`.
- **Reporting completeness** is months with at least one recorded call over the months data-through has reached, per call-feed team member, pooled per territory. Call-feed user ids do not yet link to roster ids in the seed, so completeness covers call-feed reporters and the overview states how many rostered staff are unlinked and how many calls have no team member. Nobody is marked non-reporting because a join failed.
- **Comparisons cannot differ in period.** `territoryComparison` takes one window and one definition set (`definitionVersion`) and applies them to every territory; there is no per-territory period argument. It returns deterministic disclosures (different team sizes, roster sizes, completeness, target data, load dates, partial months) and `populationsUnequal`. An out-of-scope territory and a nonexistent one get the same `Forbidden`.
- **Bounds.** Windows are at most 366 days, comparisons take two to six territories, the member table at most 200 members and each mix dimension its top eight values.

## Consequences

Target populations arrive later through governed administration (not part of this ticket); until then the coverage UI is exercised by arranging approved rows in tests and by the mock adapter's `targets` scenario.
