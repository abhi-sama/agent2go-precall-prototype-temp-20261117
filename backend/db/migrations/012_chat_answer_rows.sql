-- "Show rows" under a chat answer (ticket #84, spec #63 stories 12 to 14, docs/adr/0015).
--
-- 1. chat.rows.export: the permission that lets a user download the rows behind a chat answer. Reading the rows
--    needs record-level access (source.records.read or admin.manage) and is limited by RLS like every other read;
--    exporting them is a separate, narrower grant so an administrator can withdraw it without taking the rows away.
--    The seed (backend/db/seed/generate.py) grants the same rows because it truncates and reloads the permission tables.
-- 2. The access audit may record a chat row export written by the exporting user: id-level only, never row content.
--    Narrow on purpose, like the brief and leadership-summary exports. The pre-existing per-record export from the
--    evidence drawer (`chat_rows.exported` with the dataset as the resource type) is covered too: until now it had no
--    policy, so the audit insert of a non-administrator was refused.

INSERT INTO permissions VALUES ('chat.rows.export', 'Export the rows behind a chat answer')
  ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
  SELECT role_id, 'chat.rows.export' FROM roles WHERE role_id IN ('msl', 'director', 'administrator')
  ON CONFLICT DO NOTHING;

CREATE POLICY audit_events_chat_rows_export_insert ON audit_events FOR INSERT TO app_user
  WITH CHECK (
    actor_user_id = app.request_user_id()
    AND action = 'chat_rows.exported'
    AND resource_type IN ('chat_row_set', 'call_activity', 'hcp_raw_insights')
    AND outcome = 'allowed'
  );
