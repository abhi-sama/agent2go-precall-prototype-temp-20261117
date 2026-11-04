DO $$ BEGIN
  -- Local-only application login. Production supplies this credential from its
  -- secret store; this role is deliberately non-owner and non-superuser.
  CREATE ROLE app_user LOGIN PASSWORD 'app_user' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION app.set_request_identity(user_id text, persona text, correlation_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF user_id IS NULL OR btrim(user_id) = '' OR persona IS NULL OR btrim(persona) = '' THEN
    RAISE EXCEPTION 'user identity and persona are required';
  END IF;
  PERFORM set_config('app.user_id', user_id, true);
  PERFORM set_config('app.persona', persona, true);
  PERFORM set_config('app.correlation_id', coalesce(correlation_id, ''), true);
END $$;

CREATE OR REPLACE FUNCTION app.request_user_id()
RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;

CREATE OR REPLACE FUNCTION app.has_permission(required_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_role_assignments ura
    JOIN role_permissions rp ON rp.role_id = ura.role_id
    WHERE ura.user_id = app.request_user_id()
      AND rp.permission_code = required_permission
      AND ura.effective_from <= now() AND (ura.effective_to IS NULL OR ura.effective_to > now())
  )
$$;

CREATE OR REPLACE FUNCTION app.current_scope_territories()
RETURNS TABLE(territory_id text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH RECURSIVE scope_tree(territory_id, path) AS (
    SELECT usa.territory_id, ARRAY[usa.territory_id]
    FROM user_scope_assignments usa
    WHERE usa.user_id = app.request_user_id()
      AND usa.effective_from <= now() AND (usa.effective_to IS NULL OR usa.effective_to > now())
    UNION ALL
    SELECT rel.child_territory_id, st.path || rel.child_territory_id
    FROM scope_tree st
    JOIN territory_scope_relationships rel ON rel.parent_territory_id = st.territory_id
    WHERE rel.effective_from <= now() AND (rel.effective_to IS NULL OR rel.effective_to > now())
      AND NOT rel.child_territory_id = ANY(st.path)
  ) SELECT DISTINCT territory_id FROM scope_tree
$$;

CREATE OR REPLACE FUNCTION app.can_read_territory(candidate_territory text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT app.has_permission('admin.manage') OR (
    app.has_permission('source.records.read') AND candidate_territory IN (SELECT territory_id FROM app.current_scope_territories())
  )
$$;

CREATE OR REPLACE FUNCTION app.can_read_catalog()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT app.has_permission('admin.manage') OR app.has_permission('catalog.read')
$$;

-- Aggregate-only is intentionally independent from raw-record access. Aggregate
-- query endpoints must check this permission and apply disclosure suppression.
CREATE OR REPLACE FUNCTION app.can_read_aggregate()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT app.has_permission('aggregate.read') OR app.has_permission('admin.manage')
$$;

ALTER TABLE call_activity ENABLE ROW LEVEL SECURITY; ALTER TABLE call_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY call_activity_scope ON call_activity FOR SELECT TO app_user USING (app.can_read_territory(territory_id));
ALTER TABLE hcp_raw_insights ENABLE ROW LEVEL SECURITY; ALTER TABLE hcp_raw_insights FORCE ROW LEVEL SECURITY;
CREATE POLICY hcp_raw_insights_scope ON hcp_raw_insights FOR SELECT TO app_user USING (app.can_read_territory(territory_id));
ALTER TABLE question_tag ENABLE ROW LEVEL SECURITY; ALTER TABLE question_tag FORCE ROW LEVEL SECURITY;
CREATE POLICY question_tag_catalog ON question_tag FOR SELECT TO app_user USING (app.can_read_catalog());
ALTER TABLE territory_rd_access ENABLE ROW LEVEL SECURITY; ALTER TABLE territory_rd_access FORCE ROW LEVEL SECURITY;
CREATE POLICY territory_rd_access_scope ON territory_rd_access FOR SELECT TO app_user USING (app.has_permission('admin.manage') OR (app.has_permission('source.records.read') AND (child_territory_id IN (SELECT territory_id FROM app.current_scope_territories()) OR parent_territory_id IN (SELECT territory_id FROM app.current_scope_territories()))));
ALTER TABLE medical_roster ENABLE ROW LEVEL SECURITY; ALTER TABLE medical_roster FORCE ROW LEVEL SECURITY;
CREATE POLICY medical_roster_scope ON medical_roster FOR SELECT TO app_user USING (app.can_read_territory(territory_id));

ALTER TABLE users ENABLE ROW LEVEL SECURITY; ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_self_or_admin ON users FOR SELECT TO app_user USING (user_id = app.request_user_id() OR app.has_permission('admin.manage'));
ALTER TABLE roles ENABLE ROW LEVEL SECURITY; ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_admin ON roles FOR SELECT TO app_user USING (app.has_permission('admin.manage'));
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY; ALTER TABLE permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY permissions_admin ON permissions FOR SELECT TO app_user USING (app.has_permission('admin.manage'));
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY; ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_admin ON role_permissions FOR SELECT TO app_user USING (app.has_permission('admin.manage'));
ALTER TABLE user_role_assignments ENABLE ROW LEVEL SECURITY; ALTER TABLE user_role_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY user_role_self_or_admin ON user_role_assignments FOR SELECT TO app_user USING (user_id = app.request_user_id() OR app.has_permission('admin.manage'));
ALTER TABLE user_scope_assignments ENABLE ROW LEVEL SECURITY; ALTER TABLE user_scope_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY user_scope_self_or_admin ON user_scope_assignments FOR SELECT TO app_user USING (user_id = app.request_user_id() OR app.has_permission('admin.manage'));
ALTER TABLE territory_scope_relationships ENABLE ROW LEVEL SECURITY; ALTER TABLE territory_scope_relationships FORCE ROW LEVEL SECURITY;
CREATE POLICY territory_scope_admin_or_visible ON territory_scope_relationships FOR SELECT TO app_user USING (app.has_permission('admin.manage') OR (app.has_permission('source.records.read') AND (child_territory_id IN (SELECT territory_id FROM app.current_scope_territories()) OR parent_territory_id IN (SELECT territory_id FROM app.current_scope_territories()))));
ALTER TABLE generated_artifacts ENABLE ROW LEVEL SECURITY; ALTER TABLE generated_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY artifacts_owner_or_scope ON generated_artifacts FOR SELECT TO app_user USING (owner_user_id = app.request_user_id() OR (app.has_permission('source.records.read') AND scope_territory_ids && ARRAY(SELECT territory_id FROM app.current_scope_territories())) OR app.has_permission('admin.manage'));
ALTER TABLE artifact_evidence ENABLE ROW LEVEL SECURITY; ALTER TABLE artifact_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY artifact_evidence_visible ON artifact_evidence FOR SELECT TO app_user USING (EXISTS (SELECT 1 FROM generated_artifacts a WHERE a.artifact_id = artifact_evidence.artifact_id));
ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY; ALTER TABLE data_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY data_sources_admin ON data_sources FOR SELECT TO app_user USING (app.has_permission('admin.manage'));
ALTER TABLE ingestion_runs ENABLE ROW LEVEL SECURITY; ALTER TABLE ingestion_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY ingestion_runs_admin ON ingestion_runs FOR SELECT TO app_user USING (app.has_permission('admin.manage'));
ALTER TABLE data_quality_issues ENABLE ROW LEVEL SECURITY; ALTER TABLE data_quality_issues FORCE ROW LEVEL SECURITY;
CREATE POLICY data_quality_admin ON data_quality_issues FOR SELECT TO app_user USING (app.has_permission('admin.manage'));
ALTER TABLE metric_definitions ENABLE ROW LEVEL SECURITY; ALTER TABLE metric_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY metric_definitions_visible ON metric_definitions FOR SELECT TO app_user USING (app.can_read_aggregate() OR app.has_permission('source.records.read'));
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY; ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_admin ON audit_events FOR SELECT TO app_user USING (app.has_permission('admin.manage'));
ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY; ALTER TABLE embeddings FORCE ROW LEVEL SECURITY;
CREATE POLICY embeddings_scope ON embeddings FOR SELECT TO app_user USING (app.can_read_territory(territory_id));

GRANT USAGE ON SCHEMA public, app TO app_user;
GRANT EXECUTE ON FUNCTION app.set_request_identity(text, text, text), app.current_scope_territories(), app.can_read_aggregate() TO app_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_user;
