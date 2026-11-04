-- Administrator hierarchy governance: transfers and temporary coverage with an approval trail.
--
-- A request is raised by one administrator and decided by a different one (four eyes).
-- Approving it writes the effective-dated scope assignments in the same transaction, and links
-- each written row back to the request, so the access timeline can show who asked, who approved
-- and why.  Access itself is unchanged: app.current_scope_territories() still reads only
-- user_scope_assignments at now(), so a grant starts at effective_from and stops at effective_to
-- with no job to run.

CREATE TABLE scope_change_requests (
  request_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('transfer', 'temporary_coverage')),
  user_id text NOT NULL REFERENCES users(user_id),
  from_territory_id text,
  to_territory_id text NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  reason text NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by text NOT NULL REFERENCES users(user_id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by text REFERENCES users(user_id),
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- A transfer names where the user moves from and never ends on its own; temporary coverage
  -- always carries the end date on which it expires.
  CHECK ((kind = 'transfer' AND from_territory_id IS NOT NULL AND effective_to IS NULL)
      OR (kind = 'temporary_coverage' AND effective_to IS NOT NULL)),
  CHECK ((status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
      OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  -- Nobody approves or rejects their own request.
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE INDEX scope_change_requests_user_idx ON scope_change_requests(user_id, requested_at DESC);

ALTER TABLE user_scope_assignments ADD COLUMN request_id bigint REFERENCES scope_change_requests(request_id);
CREATE INDEX scope_assignment_request_idx ON user_scope_assignments(request_id) WHERE request_id IS NOT NULL;

ALTER TABLE scope_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE scope_change_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY scope_change_requests_admin_read ON scope_change_requests FOR SELECT TO app_user
  USING (app.has_permission('admin.manage'));
CREATE POLICY scope_change_requests_admin_insert ON scope_change_requests FOR INSERT TO app_user
  WITH CHECK (app.has_permission('admin.manage') AND requested_by = app.request_user_id());
CREATE POLICY scope_change_requests_admin_decide ON scope_change_requests FOR UPDATE TO app_user
  USING (app.has_permission('admin.manage') AND status = 'pending')
  WITH CHECK (app.has_permission('admin.manage') AND decided_by = app.request_user_id());

GRANT SELECT, INSERT ON scope_change_requests TO app_user;
GRANT UPDATE (status, decided_by, decided_at, decision_note) ON scope_change_requests TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
