-- Director team/territory overview (ticket 10, #11).
--
-- 1. team.overview.read: the permission that opens the team overview. Directors hold it;
--    administrators pass through admin.manage. MSLs and Executives do not (Executives get the
--    aggregate-only overview in ticket 12). The seed (backend/db/seed/generate.py) grants the
--    same rows, because it truncates and reloads the permission tables.
-- 2. target_assignments: the authoritative target population (entity = HCP, scope = territory).
--    Coverage percentages are only ever computed from approved, in-effect rows. The table starts
--    empty: with no target data every coverage figure is hidden, never guessed from engaged HCPs.

INSERT INTO permissions VALUES ('team.overview.read', 'Read the team and territory overview')
  ON CONFLICT DO NOTHING;
-- Roles are created by the seed; on a database that already has them, grant the permission now.
INSERT INTO role_permissions (role_id, permission_code)
  SELECT role_id, 'team.overview.read' FROM roles WHERE role_id IN ('director', 'administrator')
  ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS target_assignments (
  assignment_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id text NOT NULL,           -- canonical HCP id (cust_mdm_id)
  scope_id text NOT NULL,            -- territory the HCP is a target of
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  source text,                       -- who owns the list (a governed target list, not an inference)
  approved_by text,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (status <> 'approved' OR approved_by IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS target_assignments_scope_idx ON target_assignments (scope_id, effective_from);

ALTER TABLE target_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE target_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS target_assignments_scope ON target_assignments;
CREATE POLICY target_assignments_scope ON target_assignments FOR SELECT TO app_user USING (
  (SELECT app.has_permission('admin.manage'))
  OR ((SELECT app.has_permission('source.records.read'))
      AND scope_id IN (SELECT territory_id FROM app.current_scope_territories()))
);
GRANT SELECT ON target_assignments TO app_user;
