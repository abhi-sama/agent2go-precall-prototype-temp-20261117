-- Canonical HCP identity is deliberately separate from source names. Source systems can
-- disagree on a display name or use different identifiers for the same person; only this
-- crosswalk establishes that they describe one HCP.
CREATE TABLE hcp_entities (
  hcp_id text PRIMARY KEY
);

CREATE TABLE hcp_identifier_crosswalk (
  source_system text NOT NULL CHECK (source_system IN ('call_activity.cust_mdm_id', 'hcp_raw_insights.cust_mdm_id')),
  source_identifier text NOT NULL,
  hcp_id text NOT NULL REFERENCES hcp_entities(hcp_id),
  PRIMARY KEY (source_system, source_identifier)
);

CREATE INDEX hcp_identifier_crosswalk_hcp_idx ON hcp_identifier_crosswalk(hcp_id);

ALTER TABLE hcp_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE hcp_entities FORCE ROW LEVEL SECURITY;
CREATE POLICY hcp_entities_visible ON hcp_entities FOR SELECT TO app_user USING (
  EXISTS (
    SELECT 1
    FROM hcp_identifier_crosswalk x
    WHERE x.hcp_id = hcp_entities.hcp_id
  )
);

ALTER TABLE hcp_identifier_crosswalk ENABLE ROW LEVEL SECURITY;
ALTER TABLE hcp_identifier_crosswalk FORCE ROW LEVEL SECURITY;
CREATE POLICY hcp_crosswalk_visible ON hcp_identifier_crosswalk FOR SELECT TO app_user USING (
  (source_system = 'call_activity.cust_mdm_id' AND EXISTS (
    SELECT 1 FROM call_activity c WHERE c.cust_mdm_id = hcp_identifier_crosswalk.source_identifier
  ))
  OR
  (source_system = 'hcp_raw_insights.cust_mdm_id' AND EXISTS (
    SELECT 1 FROM hcp_raw_insights i WHERE i.cust_mdm_id = hcp_identifier_crosswalk.source_identifier
  ))
);
