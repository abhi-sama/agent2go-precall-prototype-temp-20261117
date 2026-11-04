-- An export is a user action, not an administrator action.  Keep this exception narrow so the
-- application role cannot write arbitrary audit rows while an MSL can still leave the required trail.
CREATE POLICY audit_events_brief_export_insert ON audit_events FOR INSERT TO app_user
  WITH CHECK (
    actor_user_id = app.request_user_id()
    AND action = 'brief.exported'
    AND resource_type = 'pre_call_brief'
    AND outcome = 'allowed'
  );
