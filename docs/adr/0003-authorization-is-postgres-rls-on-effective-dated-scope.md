# Authorization is Postgres row-level security over effective-dated scope

Every BE source and application table has RLS enabled and forced.
The API Lambda connects as the non-owner `app_user`.
Inside each request transaction it calls `app.set_request_identity(user_id, persona, correlation_id)`, whose settings are `SET LOCAL` and vanish at commit.
Policies read `app.current_scope_territories()`: the caller's effective-dated `user_scope_assignments` plus their descendants in `territory_scope_relationships`, evaluated at `now()`.
Permissions are explicit grants (`source.records.read`, `catalog.read`, `aggregate.read`, `admin.manage`).
Catalog visibility is separate from response access, and Executives hold only `aggregate.read`.

Authorization, counts, thresholds and date logic are deterministic SQL, never AI.
Putting authorization in the database means search, charts, vector search (pgvector lives in the same Postgres), agent retrieval and exports all inherit the same filter.
They cannot each reimplement it.

## Consequences

- Policies wrap row-independent checks in scalar subqueries so they run once per statement (`005_rls_performance.sql`).
  Calling the SECURITY DEFINER helper per row made one landing query take about 15 s on the medium seed.
- Executives get their numbers from the aggregate path with small-group suppression (ADR 0009, ticket #13).
  The record-level landing KPIs stay refused to them with `Forbidden` rather than returning zeros, which would misreport "no access" as "no activity".

## Landing metric definitions

- **Distinct calls**: `COUNT(DISTINCT crm_call_id)` over Call Activity with `call_dt` in range. `crm_call_id` repeats per call-product row.
- **Distinct engaged HCPs**: `COUNT(DISTINCT cust_mdm_id)` over the same rows.
- **Response count**: `COUNT(DISTINCT uniq_rspns_id)` over HCP insight rows with `date_of_interaction` in range, excluding `excluded_rspns_flag` rows. The key is counted distinct because its uniqueness is not yet validated (the seed plants a duplicate).
- **Data through**: the earlier of the two sources' latest load timestamps (`sys_inserted_datetime`) in scope. It is a load date, deliberately distinct from interaction dates.
