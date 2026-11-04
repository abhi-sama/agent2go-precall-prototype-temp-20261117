-- Real-world geography for territories, and the aggregate path that serves the territory map.
--
-- territory_geography places each leaf territory in one real US state or one real country
-- (the source feeds carry the same facts in call_activity.st_cd/city/pstl_cd and
-- hcp_raw_insights.insight_country). Shapes are bundled in the frontend; no coordinates
-- beyond the primary city are stored.
CREATE TABLE territory_geography (
  territory_id text PRIMARY KEY,
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),  -- ISO 3166-1 alpha-2
  country_name text NOT NULL,
  subdivision_code text NOT NULL,                                  -- st_cd in the call feed
  subdivision_name text NOT NULL,
  city text NOT NULL,                                              -- primary city
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180)
);
CREATE INDEX territory_geography_country_idx ON territory_geography (country_code);

ALTER TABLE territory_geography ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_geography FORCE ROW LEVEL SECURITY;
CREATE POLICY territory_geography_scope ON territory_geography FOR SELECT TO app_user USING (
  (SELECT app.can_read_aggregate())
  AND territory_id IN (SELECT territory_id FROM app.current_scope_territories())
);

-- Aggregate-only personas (Executive) hold no source.records.read, so RLS returns them no
-- call rows. These SECURITY DEFINER functions are the only aggregate path: they check
-- aggregate.read, restrict to the caller's effective scope (the same function the policies
-- use) and return counts, never rows. Disclosure suppression is applied by the caller.

-- Leaf territories in the caller's scope, with their geography and distinct calls in range.
CREATE OR REPLACE FUNCTION app.geo_territories(frm date, upto date)
RETURNS TABLE(territory_id text, territory_name text, region_id text, region_name text,
              country_code text, country_name text, subdivision_code text, subdivision_name text,
              latitude double precision, longitude double precision, is_own boolean, distinct_calls bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH scope AS (SELECT s.territory_id FROM app.current_scope_territories() s),
  calls AS (
    SELECT c.territory_id, count(DISTINCT c.crm_call_id) AS n
    FROM call_activity c
    WHERE c.call_dt BETWEEN frm AND upto AND c.territory_id IN (SELECT territory_id FROM scope)
    GROUP BY c.territory_id
  ),
  region AS (
    SELECT DISTINCT ON (r.child_territory_id) r.child_territory_id AS territory_id,
           r.parent_territory_id AS region_id, coalesce(r.region_name, r.parent_territory_id) AS region_name
    FROM territory_scope_relationships r
    WHERE r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now())
    ORDER BY r.child_territory_id, (r.parent_territory_id LIKE 'REGION-%') DESC, r.parent_territory_id
  ),
  own AS (
    SELECT DISTINCT usa.territory_id FROM user_scope_assignments usa
    WHERE usa.user_id = app.request_user_id()
      AND usa.effective_from <= now() AND (usa.effective_to IS NULL OR usa.effective_to > now())
  )
  SELECT g.territory_id, g.city, coalesce(rg.region_id, ''), coalesce(rg.region_name, ''),
         g.country_code, g.country_name, g.subdivision_code, g.subdivision_name,
         g.latitude, g.longitude, (o.territory_id IS NOT NULL), coalesce(c.n, 0)
  FROM territory_geography g
  JOIN scope s ON s.territory_id = g.territory_id
  LEFT JOIN region rg ON rg.territory_id = g.territory_id
  LEFT JOIN own o ON o.territory_id = g.territory_id
  LEFT JOIN calls c ON c.territory_id = g.territory_id
  WHERE app.can_read_aggregate()
  ORDER BY rg.region_id, g.territory_id
$$;

-- Distinct calls per country, counted across the country's in-scope territories (so a call
-- id is never double counted), not summed from per-territory figures.
CREATE OR REPLACE FUNCTION app.geo_countries(frm date, upto date)
RETURNS TABLE(country_code text, country_name text, territory_count bigint, distinct_calls bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH scope AS (SELECT s.territory_id FROM app.current_scope_territories() s)
  SELECT g.country_code, min(g.country_name), count(DISTINCT g.territory_id),
         (SELECT count(DISTINCT c.crm_call_id) FROM call_activity c
           JOIN territory_geography g2 ON g2.territory_id = c.territory_id
          WHERE g2.country_code = g.country_code AND c.call_dt BETWEEN frm AND upto
            AND c.territory_id IN (SELECT territory_id FROM scope))
  FROM territory_geography g
  WHERE g.territory_id IN (SELECT territory_id FROM scope) AND app.can_read_aggregate()
  GROUP BY g.country_code
  ORDER BY g.country_code
$$;

-- Load date for the same scope, so aggregate-only callers still get a data-through badge.
CREATE OR REPLACE FUNCTION app.aggregate_data_through()
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH scope AS (SELECT s.territory_id FROM app.current_scope_territories() s)
  SELECT CASE WHEN app.can_read_aggregate() THEN LEAST(
    (SELECT max(sys_inserted_datetime) FROM call_activity WHERE territory_id IN (SELECT territory_id FROM scope)),
    (SELECT max(sys_inserted_datetime) FROM hcp_raw_insights WHERE territory_id IN (SELECT territory_id FROM scope))
  ) END
$$;

REVOKE ALL ON FUNCTION app.geo_territories(date, date), app.geo_countries(date, date), app.aggregate_data_through() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.geo_territories(date, date), app.geo_countries(date, date), app.aggregate_data_through() TO app_user;
GRANT SELECT ON territory_geography TO app_user;
