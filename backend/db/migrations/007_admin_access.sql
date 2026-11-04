-- Administrator access-management write boundary.
--
-- Read policies live in 003_rls.sql.  These narrowly add the writes exercised by
-- the admin API: an explicit roster approval, role-to-permission grants, effective
-- dated scope assignments, and their audit records.  They are never available to a
-- non-administrator session.

CREATE UNIQUE INDEX IF NOT EXISTS users_roster_mapping_unique
  ON users(roster_source_row_id) WHERE roster_source_row_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_events_search_idx
  ON audit_events(occurred_at DESC, actor_user_id, action, resource_type, outcome);

GRANT INSERT, UPDATE, DELETE ON role_permissions, user_scope_assignments, audit_events TO app_user;
GRANT UPDATE (roster_source_row_id, identity_status) ON users TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

CREATE POLICY users_admin_mapping_write ON users FOR UPDATE TO app_user
  USING (app.has_permission('admin.manage'))
  WITH CHECK (app.has_permission('admin.manage'));
CREATE POLICY role_permissions_admin_insert ON role_permissions FOR INSERT TO app_user
  WITH CHECK (app.has_permission('admin.manage'));
CREATE POLICY role_permissions_admin_delete ON role_permissions FOR DELETE TO app_user
  USING (app.has_permission('admin.manage'));
CREATE POLICY scope_assignments_admin_insert ON user_scope_assignments FOR INSERT TO app_user
  WITH CHECK (app.has_permission('admin.manage'));
CREATE POLICY scope_assignments_admin_update ON user_scope_assignments FOR UPDATE TO app_user
  USING (app.has_permission('admin.manage'))
  WITH CHECK (app.has_permission('admin.manage'));
CREATE POLICY audit_events_admin_insert ON audit_events FOR INSERT TO app_user
  WITH CHECK (app.has_permission('admin.manage'));
