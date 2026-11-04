-- Administrator governance: versioned definitions and lifecycle work queues.
-- Source metadata is deliberately not normalised into a "winning" status here: the API reads
-- both source values directly so an administrator can reconcile them with provenance intact.

CREATE TABLE governed_definitions (
  definition_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  kind text NOT NULL CHECK (kind IN ('metric', 'question')),
  name text NOT NULL CHECK (btrim(name) <> ''),
  definition text NOT NULL CHECK (btrim(definition) <> ''),
  owner_user_id text NOT NULL REFERENCES users(user_id),
  status text NOT NULL CHECK (status IN ('draft', 'approved', 'retired')),
  approved_by text REFERENCES users(user_id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (definition_id, version),
  CHECK ((status = 'approved') = (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX governed_definitions_latest_idx ON governed_definitions(definition_id, version DESC);

CREATE TABLE governance_requests (
  request_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_type text NOT NULL CHECK (request_type IN ('retention', 'correction', 'deletion')),
  resource_type text NOT NULL CHECK (btrim(resource_type) <> ''),
  resource_id text NOT NULL CHECK (btrim(resource_id) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'completed', 'rejected')),
  requested_by text NOT NULL REFERENCES users(user_id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by text REFERENCES users(user_id),
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 500)
);
CREATE INDEX governance_requests_queue_idx ON governance_requests(status, requested_at DESC);

CREATE TABLE governance_request_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id bigint NOT NULL REFERENCES governance_requests(request_id) ON DELETE CASCADE,
  actor_user_id text NOT NULL REFERENCES users(user_id),
  action text NOT NULL CHECK (action IN ('created', 'reviewed', 'completed', 'rejected')),
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX governance_request_audit_request_idx ON governance_request_audit(request_id, occurred_at);

ALTER TABLE governed_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE governed_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY governed_definitions_admin_read ON governed_definitions FOR SELECT TO app_user USING (app.has_permission('admin.manage'));
CREATE POLICY governed_definitions_admin_insert ON governed_definitions FOR INSERT TO app_user WITH CHECK (app.has_permission('admin.manage') AND owner_user_id = app.request_user_id());
CREATE POLICY governed_definitions_admin_approve ON governed_definitions FOR UPDATE TO app_user USING (app.has_permission('admin.manage')) WITH CHECK (app.has_permission('admin.manage'));

ALTER TABLE governance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY governance_requests_admin_read ON governance_requests FOR SELECT TO app_user USING (app.has_permission('admin.manage'));
CREATE POLICY governance_requests_admin_insert ON governance_requests FOR INSERT TO app_user WITH CHECK (app.has_permission('admin.manage') AND requested_by = app.request_user_id());
CREATE POLICY governance_requests_admin_update ON governance_requests FOR UPDATE TO app_user USING (app.has_permission('admin.manage')) WITH CHECK (app.has_permission('admin.manage'));

ALTER TABLE governance_request_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_request_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY governance_request_audit_admin_read ON governance_request_audit FOR SELECT TO app_user USING (app.has_permission('admin.manage'));
CREATE POLICY governance_request_audit_admin_insert ON governance_request_audit FOR INSERT TO app_user WITH CHECK (app.has_permission('admin.manage') AND actor_user_id = app.request_user_id());

GRANT SELECT, INSERT, UPDATE ON governed_definitions, governance_requests, governance_request_audit TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
