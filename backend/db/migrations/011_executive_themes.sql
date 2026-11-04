-- Executive themes, cross-region topics and leadership summaries (ticket 13, #14): the aggregate-only path.
--
-- An Executive holds aggregate.read and no source.records.read, so row-level security returns them no response
-- rows. As for the overview (migration 009), SECURITY DEFINER functions are the only door. Each one
--   1. starts from app.exec_units(), the leaf territories of the EXPLICIT executive scope (never roster labels),
--      which is empty for anyone who is not an Executive holding aggregate.read;
--   2. returns counts, never rows or identifiers;
--   3. leaves small-group disclosure to the one shared library (backend/libs/a2g_exec_analysis), which both the
--      API Lambda and the agent call, so a chart, a summary and a chat answer cannot disagree about what is hidden.
--
-- Themes and the emerging-topic rule are the Director's (migration 009_director_insights): app.theme_of and
-- app.emerging_thresholds/app.emerging_status. One rule, evaluated in the database, for every persona.

-- Free-text response counts for the current window and the equal window before it, at four levels at once:
--   CELL   (facet value, region, theme)      the topic-by-region matrix
--   THEME  (facet value, theme)              a theme card (distinct HCPs counted across regions)
--   REGION (facet value, region)             the region's denominator
--   GROUP  (facet value)                     the facet value's denominator
-- Counts are distinct response keys (uniq_rspns_id); HCPs are distinct cust_mdm_id values.
-- facet: PORTFOLIO | MOLECULE | DISEASE_AREA (tumor type from the catalog) | STUDY.
CREATE OR REPLACE FUNCTION app.exec_theme_counts(cur_from date, cur_to date, prior_from date, facet text)
RETURNS TABLE(level text, facet_value text, region_id text, topic text,
              cur_n bigint, pri_n bigint, cur_hcps bigint, pri_hcps bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH units AS (SELECT * FROM app.exec_units()),
  base AS (
    SELECT CASE facet
             WHEN 'PORTFOLIO' THEN 'Portfolio'
             WHEN 'MOLECULE' THEN coalesce(nullif(btrim(h.molecule_type), ''), 'Unspecified')
             WHEN 'DISEASE_AREA' THEN coalesce(nullif(btrim(tq.tumor_type), ''), 'Unspecified')
             WHEN 'STUDY' THEN coalesce(nullif(btrim(h.study_name), ''), 'Unspecified')
           END AS facet_value,
           u.region_id, app.theme_of(h.rspns_txt) AS topic, h.uniq_rspns_id, h.cust_mdm_id,
           (h.date_of_interaction >= cur_from) AS in_cur
    FROM hcp_raw_insights h
    JOIN units u ON u.territory_id = h.territory_id
    LEFT JOIN (SELECT qstn_ext_id, min(tumor_type) AS tumor_type FROM question_tag GROUP BY qstn_ext_id) tq
           ON facet = 'DISEASE_AREA' AND tq.qstn_ext_id = h.qstn_ext_id
    WHERE facet IN ('PORTFOLIO', 'MOLECULE', 'DISEASE_AREA', 'STUDY')
      AND h.qstn_type = 'open_text' AND nullif(btrim(h.rspns_txt), '') IS NOT NULL
      AND h.excluded_rspns_flag IS NOT TRUE AND h.uniq_rspns_id IS NOT NULL
      AND h.date_of_interaction BETWEEN prior_from AND cur_to
  )
  SELECT CASE WHEN GROUPING(region_id) = 0 AND GROUPING(topic) = 0 THEN 'CELL'
              WHEN GROUPING(topic) = 0 THEN 'THEME'
              WHEN GROUPING(region_id) = 0 THEN 'REGION'
              ELSE 'GROUP' END,
         facet_value, region_id, topic,
         count(DISTINCT uniq_rspns_id) FILTER (WHERE in_cur),
         count(DISTINCT uniq_rspns_id) FILTER (WHERE NOT in_cur),
         count(DISTINCT cust_mdm_id) FILTER (WHERE in_cur),
         count(DISTINCT cust_mdm_id) FILTER (WHERE NOT in_cur)
  FROM base
  GROUP BY GROUPING SETS ((facet_value, region_id, topic), (facet_value, topic), (facet_value, region_id), (facet_value))
$$;

-- The emerging-topic status for many (current, prior, current total, prior total) tuples at once, using the one rule.
CREATE OR REPLACE FUNCTION app.exec_trend_status(cur_n bigint[], pri_n bigint[], cur_t bigint[], pri_t bigint[])
RETURNS TABLE(idx integer, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT i::integer, app.emerging_status(cur_n[i], pri_n[i], cur_t[i], pri_t[i])
  FROM generate_subscripts(cur_n, 1) AS i
  WHERE app.can_read_aggregate()
$$;

-- Which approved governed definition (if any) stands behind the threshold rule. An Executive cannot read the
-- governed_definitions table; this returns only the identity and approval date of the latest approved version.
CREATE OR REPLACE FUNCTION app.exec_threshold_definition()
RETURNS TABLE(definition_id text, version integer, approved_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT d.definition_id, d.version, d.approved_at
  FROM governed_definitions d
  WHERE d.definition_id = 'emerging-topic-rule' AND d.kind = 'metric' AND d.status = 'approved'
    AND app.can_read_aggregate()
  ORDER BY d.version DESC LIMIT 1
$$;

-- Supporting responses for an Executive who ALSO holds explicit record-level permission. Aggregate-only
-- Executives get nothing from this function; the caller still needs source.records.read, and the territory
-- must be inside the explicit executive scope.
CREATE OR REPLACE FUNCTION app.exec_theme_records(cur_from date, cur_to date, facet text, facet_value text, theme text, max_rows integer)
RETURNS TABLE(record_id text, territory_id text, interaction_date date, excerpt text, question_text text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT h.uniq_rspns_id, h.territory_id, h.date_of_interaction, h.rspns_txt, h.qstn_txt
  FROM hcp_raw_insights h
  JOIN app.exec_units() u ON u.territory_id = h.territory_id
  LEFT JOIN (SELECT qstn_ext_id, min(tumor_type) AS tumor_type FROM question_tag GROUP BY qstn_ext_id) tq
         ON facet = 'DISEASE_AREA' AND tq.qstn_ext_id = h.qstn_ext_id
  WHERE app.has_permission('source.records.read')
    AND h.qstn_type = 'open_text' AND nullif(btrim(h.rspns_txt), '') IS NOT NULL
    AND h.excluded_rspns_flag IS NOT TRUE AND h.uniq_rspns_id IS NOT NULL
    AND h.date_of_interaction BETWEEN cur_from AND cur_to
    AND app.theme_of(h.rspns_txt) = theme
    AND CASE facet
          WHEN 'PORTFOLIO' THEN true
          WHEN 'MOLECULE' THEN coalesce(nullif(btrim(h.molecule_type), ''), 'Unspecified') = facet_value
          WHEN 'DISEASE_AREA' THEN coalesce(nullif(btrim(tq.tumor_type), ''), 'Unspecified') = facet_value
          WHEN 'STUDY' THEN coalesce(nullif(btrim(h.study_name), ''), 'Unspecified') = facet_value
          ELSE false END
  ORDER BY h.date_of_interaction DESC, h.uniq_rspns_id
  LIMIT least(greatest(max_rows, 0), 10)
$$;

REVOKE ALL ON FUNCTION app.exec_theme_counts(date, date, date, text), app.exec_trend_status(bigint[], bigint[], bigint[], bigint[]),
  app.exec_threshold_definition(), app.exec_theme_records(date, date, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.exec_theme_counts(date, date, date, text), app.exec_trend_status(bigint[], bigint[], bigint[], bigint[]),
  app.exec_threshold_definition(), app.exec_theme_records(date, date, text, text, text, integer) TO app_user;

-- A leadership summary export is a user action recorded in the access audit, like a brief export. Narrow on purpose.
CREATE POLICY audit_events_leadership_export_insert ON audit_events FOR INSERT TO app_user
  WITH CHECK (
    actor_user_id = app.request_user_id()
    AND action = 'leadership_summary.exported'
    AND resource_type = 'leadership_summary'
    AND outcome = 'allowed'
  );
