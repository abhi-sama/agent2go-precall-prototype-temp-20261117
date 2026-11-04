-- Executive overview (ticket 12, #13): the aggregate-only path.
--
-- An Executive holds aggregate.read and no source.records.read, so row-level security returns them
-- no call or response rows. These SECURITY DEFINER functions are the only door: each one
--   1. takes the caller's scope from EXPLICIT executive-type scope assignments only
--      (user_scope_assignments.assignment_type = 'executive', effective-dated), never from the
--      roster's region labels and never from a primary or temporary assignment;
--   2. requires aggregate.read and the Executive persona;
--   3. returns counts, never rows or identifiers.
-- Small-group suppression is applied by the API on top of these counts (a2g_api.executive).

CREATE OR REPLACE FUNCTION app.executive_scope_territories()
RETURNS TABLE(territory_id text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH RECURSIVE scope_tree(territory_id, path) AS (
    SELECT usa.territory_id, ARRAY[usa.territory_id]
    FROM user_scope_assignments usa
    WHERE usa.user_id = app.request_user_id()
      AND usa.assignment_type = 'executive'
      AND usa.effective_from <= now() AND (usa.effective_to IS NULL OR usa.effective_to > now())
      AND app.can_read_aggregate()
      AND current_setting('app.persona', true) = 'Executive'
    UNION ALL
    SELECT rel.child_territory_id, st.path || rel.child_territory_id
    FROM scope_tree st
    JOIN territory_scope_relationships rel ON rel.parent_territory_id = st.territory_id
    WHERE rel.effective_from <= now() AND (rel.effective_to IS NULL OR rel.effective_to > now())
      AND NOT rel.child_territory_id = ANY(st.path)
  ) SELECT DISTINCT territory_id FROM scope_tree
$$;

-- The leaf territories the Executive is explicitly authorized for, with their region.
CREATE OR REPLACE FUNCTION app.exec_units()
RETURNS TABLE(territory_id text, territory_name text, region_id text, region_name text, country_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH region AS (
    SELECT DISTINCT ON (r.child_territory_id) r.child_territory_id AS territory_id,
           r.parent_territory_id AS region_id, coalesce(r.region_name, r.parent_territory_id) AS region_name
    FROM territory_scope_relationships r
    WHERE r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now())
    ORDER BY r.child_territory_id, (r.parent_territory_id LIKE 'REGION-%') DESC, r.parent_territory_id
  )
  SELECT g.territory_id, g.city, coalesce(rg.region_id, 'UNGROUPED'), coalesce(rg.region_name, 'Not in a region'), g.country_code
  FROM territory_geography g
  JOIN app.executive_scope_territories() s ON s.territory_id = g.territory_id
  LEFT JOIN region rg ON rg.territory_id = g.territory_id
$$;

-- Distinct calls, responses and engaged HCPs for the whole scope, per month, per region and per
-- territory (and month). One query, so every level uses identical definitions.
-- Distinct counts are taken at each level (not summed), because an HCP can be reached from two
-- territories and a month is a calendar month.
CREATE OR REPLACE FUNCTION app.exec_cells(frm date, upto date)
RETURNS TABLE(level text, territory_id text, region_id text, month date, calls bigint, responses bigint, hcps bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH units AS (SELECT * FROM app.exec_units()),
  events AS (
    SELECT 'C'::text AS kind, c.territory_id, date_trunc('month', c.call_dt)::date AS month,
           c.crm_call_id AS id, c.cust_mdm_id AS hcp
    FROM call_activity c
    WHERE c.call_dt BETWEEN frm AND upto AND c.crm_call_id IS NOT NULL
      AND c.territory_id IN (SELECT u.territory_id FROM units u)
    UNION ALL
    SELECT 'R', h.territory_id, date_trunc('month', h.date_of_interaction)::date, h.uniq_rspns_id, NULL
    FROM hcp_raw_insights h
    WHERE h.date_of_interaction BETWEEN frm AND upto AND h.uniq_rspns_id IS NOT NULL
      AND h.excluded_rspns_flag IS NOT TRUE
      AND h.territory_id IN (SELECT u.territory_id FROM units u)
  )
  SELECT CASE WHEN GROUPING(e.territory_id) = 0 THEN 'TERRITORY'
              WHEN GROUPING(u.region_id) = 0 THEN 'REGION'
              WHEN GROUPING(e.month) = 0 THEN 'MONTH' ELSE 'TOTAL' END,
         e.territory_id, u.region_id, e.month,
         count(DISTINCT e.id) FILTER (WHERE e.kind = 'C'),
         count(DISTINCT e.id) FILTER (WHERE e.kind = 'R'),
         count(DISTINCT e.hcp) FILTER (WHERE e.kind = 'C')
  FROM events e JOIN units u ON u.territory_id = e.territory_id
  GROUP BY GROUPING SETS ((), (e.month), (u.region_id), (e.territory_id), (e.territory_id, e.month))
$$;

-- Territories that recorded at least one call in each month (reporting completeness).
CREATE OR REPLACE FUNCTION app.exec_reporting(frm date, upto date)
RETURNS TABLE(territory_id text, month date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT DISTINCT c.territory_id, date_trunc('month', c.call_dt)::date
  FROM call_activity c
  WHERE c.call_dt BETWEEN frm AND upto AND c.crm_call_id IS NOT NULL
    AND c.territory_id IN (SELECT u.territory_id FROM app.exec_units() u)
$$;

-- The latest load of each source in scope: a load date, never an interaction date.
CREATE OR REPLACE FUNCTION app.exec_loads()
RETURNS TABLE(calls_loaded timestamptz, responses_loaded timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH units AS (SELECT u.territory_id FROM app.exec_units() u)
  SELECT (SELECT max(sys_inserted_datetime) FROM call_activity WHERE territory_id IN (SELECT territory_id FROM units)),
         (SELECT max(sys_inserted_datetime) FROM hcp_raw_insights WHERE territory_id IN (SELECT territory_id FROM units))
$$;

-- Distinct calls per channel (a call is one channel however many products it covers).
CREATE OR REPLACE FUNCTION app.exec_channel_mix(frm date, upto date)
RETURNS TABLE(channel text, calls bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(nullif(btrim(c.call_chnl), ''), 'Unspecified'), count(DISTINCT c.crm_call_id)
  FROM call_activity c
  WHERE c.call_dt BETWEEN frm AND upto AND c.crm_call_id IS NOT NULL
    AND c.territory_id IN (SELECT u.territory_id FROM app.exec_units() u)
  GROUP BY 1
$$;

-- How many engaged HCPs were reached once, twice, three to four times, five or more times.
-- Only the number of HCPs per band leaves the function, never who they are.
CREATE OR REPLACE FUNCTION app.exec_hcp_depth(frm date, upto date)
RETURNS TABLE(band text, sort_order int, hcps bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH per_hcp AS (
    SELECT c.cust_mdm_id, count(DISTINCT c.crm_call_id) AS n
    FROM call_activity c
    WHERE c.call_dt BETWEEN frm AND upto AND c.crm_call_id IS NOT NULL AND c.cust_mdm_id IS NOT NULL
      AND c.territory_id IN (SELECT u.territory_id FROM app.exec_units() u)
    GROUP BY 1
  )
  SELECT CASE WHEN n = 1 THEN '1 call' WHEN n = 2 THEN '2 calls' WHEN n <= 4 THEN '3-4 calls' ELSE '5+ calls' END,
         CASE WHEN n = 1 THEN 1 WHEN n = 2 THEN 2 WHEN n <= 4 THEN 3 ELSE 4 END,
         count(*)
  FROM per_hcp GROUP BY 1, 2
$$;

-- Coverage: engaged target HCPs over the approved, in-effect target population of the scope.
-- The Executive cannot read target rows; this returns three counts.
CREATE OR REPLACE FUNCTION app.exec_coverage(frm date, upto date)
RETURNS TABLE(target_hcps bigint, engaged_targets bigint, territories_with_targets bigint, territories_in_scope bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH units AS (SELECT u.territory_id FROM app.exec_units() u),
  tgt AS (
    SELECT DISTINCT t.entity_id, t.scope_id FROM target_assignments t
    WHERE t.status = 'approved' AND t.scope_id IN (SELECT territory_id FROM units)
      AND t.effective_from <= (upto + 1)::timestamptz
      AND (t.effective_to IS NULL OR t.effective_to > (upto + 1)::timestamptz)
  )
  SELECT count(DISTINCT t.entity_id),
         count(DISTINCT t.entity_id) FILTER (WHERE EXISTS (
           SELECT 1 FROM call_activity c WHERE c.cust_mdm_id = t.entity_id AND c.territory_id = t.scope_id
             AND c.call_dt BETWEEN frm AND upto)),
         count(DISTINCT t.scope_id),
         (SELECT count(*) FROM units)
  FROM tgt t
$$;

REVOKE ALL ON FUNCTION app.executive_scope_territories(), app.exec_units(), app.exec_cells(date, date),
  app.exec_reporting(date, date), app.exec_loads(), app.exec_channel_mix(date, date),
  app.exec_hcp_depth(date, date), app.exec_coverage(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.executive_scope_territories(), app.exec_units(), app.exec_cells(date, date),
  app.exec_reporting(date, date), app.exec_loads(), app.exec_channel_mix(date, date),
  app.exec_hcp_depth(date, date), app.exec_coverage(date, date) TO app_user;
