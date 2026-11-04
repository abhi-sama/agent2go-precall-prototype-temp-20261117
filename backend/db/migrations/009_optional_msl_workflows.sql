-- Optional MSL workflows: notes stay as entered, tasks need an explicit confirmation,
-- and alerts evaluate source data deterministically under the caller's RLS session.
CREATE TABLE post_call_drafts (
  draft_id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES users(user_id),
  notes text NOT NULL,
  structured_lines jsonb NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE follow_up_tasks (
  task_id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES users(user_id),
  description text NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'DONE')),
  source_draft_id text REFERENCES post_call_drafts(draft_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE topic_alert_rules (
  rule_id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES users(user_id),
  topic text NOT NULL,
  threshold integer NOT NULL CHECK (threshold > 0),
  period_days integer NOT NULL CHECK (period_days BETWEEN 1 AND 366),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX post_call_drafts_owner_created_idx ON post_call_drafts(owner_user_id, created_at DESC);
CREATE INDEX follow_up_tasks_owner_created_idx ON follow_up_tasks(owner_user_id, created_at DESC);
CREATE INDEX topic_alert_rules_owner_created_idx ON topic_alert_rules(owner_user_id, created_at DESC);

ALTER TABLE post_call_drafts ENABLE ROW LEVEL SECURITY; ALTER TABLE post_call_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY post_call_drafts_owner ON post_call_drafts FOR SELECT TO app_user USING (owner_user_id = app.request_user_id());
CREATE POLICY post_call_drafts_insert_owner ON post_call_drafts FOR INSERT TO app_user WITH CHECK (owner_user_id = app.request_user_id());
CREATE POLICY post_call_drafts_update_owner ON post_call_drafts FOR UPDATE TO app_user USING (owner_user_id = app.request_user_id()) WITH CHECK (owner_user_id = app.request_user_id());
ALTER TABLE follow_up_tasks ENABLE ROW LEVEL SECURITY; ALTER TABLE follow_up_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY follow_up_tasks_owner ON follow_up_tasks FOR SELECT TO app_user USING (owner_user_id = app.request_user_id());
CREATE POLICY follow_up_tasks_insert_owner ON follow_up_tasks FOR INSERT TO app_user WITH CHECK (owner_user_id = app.request_user_id());
ALTER TABLE topic_alert_rules ENABLE ROW LEVEL SECURITY; ALTER TABLE topic_alert_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY topic_alert_rules_owner ON topic_alert_rules FOR SELECT TO app_user USING (owner_user_id = app.request_user_id());
CREATE POLICY topic_alert_rules_insert_owner ON topic_alert_rules FOR INSERT TO app_user WITH CHECK (owner_user_id = app.request_user_id());

GRANT SELECT, INSERT, UPDATE ON post_call_drafts, follow_up_tasks, topic_alert_rules TO app_user;
