-- Executive trends (#121): monthly distinct calls, engaged HCPs and responses by the Executive's explicit regions.
--
-- Same door as the overview (migration 009) and themes (migration 011): an Executive holds aggregate.read and no
-- source.records.read, so RLS returns no call or response rows. These SECURITY DEFINER functions
--   1. start from app.exec_units(), the leaf territories of the EXPLICIT executive scope, which is empty for anyone
--      who is not an Executive holding aggregate.read;
--   2. return counts, never rows or identifiers;
--   3. leave small-group disclosure to the API (a2g_api.executive_trends, which reuses the shared suppress_flags).
--
-- The arrow is judged here, in the database, by the approved emerging-topic thresholds (app.emerging_thresholds,
-- migration 009_director_insights), so the numbers a rule depends on live in exactly one place.

-- Distinct calls, responses and engaged HCPs per region and calendar month, plus the per-region and per-month
-- totals over the same window and the grand total. One query, so every level uses identical definitions.
-- Distinct counts are taken at each level (not summed): an HCP can be reached from two regions.
CREATE OR REPLACE FUNCTION app.exec_region_months(frm date, upto date)
RETURNS TABLE(level text, region_id text, month date, calls bigint, responses bigint, hcps bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH units AS (SELECT * FROM app.exec_units()),
  events AS (
    SELECT 'C'::text AS kind, u.region_id, date_trunc('month', c.call_dt)::date AS month,
           c.crm_call_id AS id, c.cust_mdm_id AS hcp
    FROM call_activity c JOIN units u ON u.territory_id = c.territory_id
    WHERE c.call_dt BETWEEN frm AND upto AND c.crm_call_id IS NOT NULL
    UNION ALL
    SELECT 'R', u.region_id, date_trunc('month', h.date_of_interaction)::date, h.uniq_rspns_id, NULL
    FROM hcp_raw_insights h JOIN units u ON u.territory_id = h.territory_id
    WHERE h.date_of_interaction BETWEEN frm AND upto AND h.uniq_rspns_id IS NOT NULL
      AND h.excluded_rspns_flag IS NOT TRUE
  )
  SELECT CASE WHEN GROUPING(e.region_id) = 0 AND GROUPING(e.month) = 0 THEN 'REGION_MONTH'
              WHEN GROUPING(e.region_id) = 0 THEN 'REGION'
              WHEN GROUPING(e.month) = 0 THEN 'MONTH' ELSE 'TOTAL' END,
         e.region_id, e.month,
         count(DISTINCT e.id) FILTER (WHERE e.kind = 'C'),
         count(DISTINCT e.id) FILTER (WHERE e.kind = 'R'),
         count(DISTINCT e.hcp) FILTER (WHERE e.kind = 'C')
  FROM events e
  GROUP BY GROUPING SETS ((e.region_id, e.month), (e.region_id), (e.month), ())
$$;

-- The same three counts per region for the latest window and the equal window before it (prior_from through the
-- day before cur_from), which the trend arrows compare. Responses double as the sample-size gate.
CREATE OR REPLACE FUNCTION app.exec_region_windows(cur_from date, cur_to date, prior_from date)
RETURNS TABLE(region_id text, cur_calls bigint, pri_calls bigint, cur_hcps bigint, pri_hcps bigint,
              cur_responses bigint, pri_responses bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH units AS (SELECT * FROM app.exec_units()),
  events AS (
    SELECT 'C'::text AS kind, u.region_id, (c.call_dt >= cur_from) AS in_cur, c.crm_call_id AS id, c.cust_mdm_id AS hcp
    FROM call_activity c JOIN units u ON u.territory_id = c.territory_id
    WHERE c.call_dt BETWEEN prior_from AND cur_to AND c.crm_call_id IS NOT NULL
    UNION ALL
    SELECT 'R', u.region_id, (h.date_of_interaction >= cur_from), h.uniq_rspns_id, NULL
    FROM hcp_raw_insights h JOIN units u ON u.territory_id = h.territory_id
    WHERE h.date_of_interaction BETWEEN prior_from AND cur_to AND h.uniq_rspns_id IS NOT NULL
      AND h.excluded_rspns_flag IS NOT TRUE
  )
  SELECT e.region_id,
         count(DISTINCT e.id) FILTER (WHERE e.kind = 'C' AND e.in_cur),
         count(DISTINCT e.id) FILTER (WHERE e.kind = 'C' AND NOT e.in_cur),
         count(DISTINCT e.hcp) FILTER (WHERE e.kind = 'C' AND e.in_cur),
         count(DISTINCT e.hcp) FILTER (WHERE e.kind = 'C' AND NOT e.in_cur),
         count(DISTINCT e.id) FILTER (WHERE e.kind = 'R' AND e.in_cur),
         count(DISTINCT e.id) FILTER (WHERE e.kind = 'R' AND NOT e.in_cur)
  FROM events e
  GROUP BY e.region_id
$$;

-- The activity-trend verdict for many (latest, prior, latest sample, prior sample) tuples at once, using the
-- approved thresholds of app.emerging_thresholds():
--   * a region whose latest or prior window holds fewer than min_window_responses responses has too little to
--     judge: INSUFFICIENT_SAMPLE (no trend);
--   * RISING when the figure grew by at least min_topic_responses AND by at least min_relative_increase of the
--     earlier figure (or the earlier figure was zero); FALLING mirrors it; everything else is STEADY.
-- Volume is judged against its own earlier value, not a share, because activity has no total to be a share of.
CREATE OR REPLACE FUNCTION app.exec_activity_trend_status(cur_n bigint[], pri_n bigint[], cur_sample bigint[], pri_sample bigint[])
RETURNS TABLE(idx integer, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT i::integer,
         CASE
           WHEN cur_sample[i] < t.min_window_responses OR pri_sample[i] < t.min_window_responses THEN 'INSUFFICIENT_SAMPLE'
           WHEN cur_n[i] - pri_n[i] >= t.min_topic_responses
                AND cur_n[i]::numeric >= pri_n[i]::numeric * (1 + t.min_relative_increase) THEN 'RISING'
           WHEN pri_n[i] - cur_n[i] >= t.min_topic_responses
                AND cur_n[i]::numeric <= pri_n[i]::numeric * (1 - t.min_relative_increase) THEN 'FALLING'
           ELSE 'STEADY' END
  FROM generate_subscripts(cur_n, 1) AS i, app.emerging_thresholds() t
  WHERE app.can_read_aggregate()
$$;

REVOKE ALL ON FUNCTION app.exec_region_months(date, date), app.exec_region_windows(date, date, date),
  app.exec_activity_trend_status(bigint[], bigint[], bigint[], bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.exec_region_months(date, date), app.exec_region_windows(date, date, date),
  app.exec_activity_trend_status(bigint[], bigint[], bigint[], bigint[]) TO app_user;
