-- Chat runs (ticket #3, docs/adr/0007): BE working state for a streamed chat answer.
-- The BE chat worker appends each AG-UI event the agent emits; the frontend reads them in order through
-- the `chatEvents` query. This is the local stand-in for an AppSync subscription (floci has none), so
-- it is transient state, not the conversation record: the agent writes that to FE DynamoDB (ADR 0005).
-- Both tables are owner-only under RLS: nobody, whatever their scope, reads another user's run.

CREATE TABLE chat_runs (
  run_id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES users(user_id),
  thread_id text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'finished', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX chat_runs_owner_idx ON chat_runs(owner_user_id, created_at);

CREATE TABLE chat_run_events (
  run_id text NOT NULL REFERENCES chat_runs(run_id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq > 0),
  owner_user_id text NOT NULL,
  event jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, seq)
);

ALTER TABLE chat_runs ENABLE ROW LEVEL SECURITY; ALTER TABLE chat_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_runs_owner_select ON chat_runs FOR SELECT TO app_user USING (owner_user_id = app.request_user_id());
CREATE POLICY chat_runs_owner_insert ON chat_runs FOR INSERT TO app_user WITH CHECK (owner_user_id = app.request_user_id());
CREATE POLICY chat_runs_owner_update ON chat_runs FOR UPDATE TO app_user
  USING (owner_user_id = app.request_user_id()) WITH CHECK (owner_user_id = app.request_user_id());

ALTER TABLE chat_run_events ENABLE ROW LEVEL SECURITY; ALTER TABLE chat_run_events FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_run_events_owner_select ON chat_run_events FOR SELECT TO app_user USING (owner_user_id = app.request_user_id());
CREATE POLICY chat_run_events_owner_insert ON chat_run_events FOR INSERT TO app_user WITH CHECK (owner_user_id = app.request_user_id());

GRANT INSERT, UPDATE ON chat_runs TO app_user;
GRANT INSERT ON chat_run_events TO app_user;
