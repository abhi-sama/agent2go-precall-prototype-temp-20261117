-- Evaluate scope once per statement instead of once per row.
--
-- 003 calls app.can_read_territory(territory_id) in each policy. As a SECURITY DEFINER
-- function it cannot be inlined, so Postgres re-ran the permission checks and the
-- recursive scope walk for every row (about 15 s for one landing-page query). Wrapping
-- the row-independent parts in scalar subqueries makes them InitPlans that run once,
-- and the territory test becomes a hashed IN over the caller's scope. Same predicate.

DROP POLICY call_activity_scope ON call_activity;
CREATE POLICY call_activity_scope ON call_activity FOR SELECT TO app_user USING (
  (SELECT app.has_permission('admin.manage'))
  OR ((SELECT app.has_permission('source.records.read'))
      AND territory_id IN (SELECT territory_id FROM app.current_scope_territories()))
);

DROP POLICY hcp_raw_insights_scope ON hcp_raw_insights;
CREATE POLICY hcp_raw_insights_scope ON hcp_raw_insights FOR SELECT TO app_user USING (
  (SELECT app.has_permission('admin.manage'))
  OR ((SELECT app.has_permission('source.records.read'))
      AND territory_id IN (SELECT territory_id FROM app.current_scope_territories()))
);

DROP POLICY medical_roster_scope ON medical_roster;
CREATE POLICY medical_roster_scope ON medical_roster FOR SELECT TO app_user USING (
  (SELECT app.has_permission('admin.manage'))
  OR ((SELECT app.has_permission('source.records.read'))
      AND territory_id IN (SELECT territory_id FROM app.current_scope_territories()))
);

DROP POLICY embeddings_scope ON embeddings;
CREATE POLICY embeddings_scope ON embeddings FOR SELECT TO app_user USING (
  (SELECT app.has_permission('admin.manage'))
  OR ((SELECT app.has_permission('source.records.read'))
      AND territory_id IN (SELECT territory_id FROM app.current_scope_territories()))
);
