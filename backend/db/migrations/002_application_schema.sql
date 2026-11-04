CREATE TABLE users (
  user_id text PRIMARY KEY, identity_subject text UNIQUE NOT NULL,
  display_name text, email text, identity_status text NOT NULL DEFAULT 'unresolved',
  roster_source_row_id bigint REFERENCES medical_roster(source_row_id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE roles (role_id text PRIMARY KEY, role_name text UNIQUE NOT NULL, description text);
CREATE TABLE permissions (permission_code text PRIMARY KEY, description text NOT NULL);
CREATE TABLE role_permissions (role_id text REFERENCES roles(role_id), permission_code text REFERENCES permissions(permission_code), PRIMARY KEY(role_id, permission_code));
CREATE TABLE user_role_assignments (
  assignment_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id text REFERENCES users(user_id), role_id text REFERENCES roles(role_id),
  effective_from timestamptz NOT NULL, effective_to timestamptz, assigned_by text, CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE TABLE user_scope_assignments (
  assignment_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id text REFERENCES users(user_id), territory_id text NOT NULL,
  assignment_type text NOT NULL CHECK (assignment_type IN ('primary','temporary','executive','administrative')),
  effective_from timestamptz NOT NULL, effective_to timestamptz, approved_by text, CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE TABLE territory_scope_relationships (
  relationship_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, child_territory_id text NOT NULL, parent_territory_id text NOT NULL,
  region_name text, effective_from timestamptz NOT NULL, effective_to timestamptz, source_row_id bigint REFERENCES territory_rd_access(source_row_id),
  CHECK (child_territory_id <> parent_territory_id), CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE TABLE generated_artifacts (
  artifact_id text PRIMARY KEY, owner_user_id text REFERENCES users(user_id), artifact_type text NOT NULL,
  scope_territory_ids text[] NOT NULL, data_through date, generated_at timestamptz NOT NULL DEFAULT now(), content jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE artifact_evidence (
  evidence_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, artifact_id text REFERENCES generated_artifacts(artifact_id) ON DELETE CASCADE,
  source_table text NOT NULL, source_record_id text NOT NULL, cited_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE data_sources (source_id text PRIMARY KEY, source_name text NOT NULL, source_table text NOT NULL, owner_name text, active boolean NOT NULL DEFAULT true);
CREATE TABLE ingestion_runs (
  run_id text PRIMARY KEY, source_id text REFERENCES data_sources(source_id), status text NOT NULL,
  started_at timestamptz NOT NULL, completed_at timestamptz, records_loaded bigint NOT NULL DEFAULT 0, error_summary text
);
CREATE TABLE data_quality_issues (
  issue_id text PRIMARY KEY, category text NOT NULL, source_id text REFERENCES data_sources(source_id), source_record_id text,
  status text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb, detected_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE TABLE metric_definitions (
  metric_id text NOT NULL, version integer NOT NULL, metric_name text NOT NULL, definition text NOT NULL,
  owner_user_id text REFERENCES users(user_id), status text NOT NULL, approved_at timestamptz, PRIMARY KEY(metric_id, version)
);
CREATE TABLE audit_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_user_id text, action text NOT NULL, resource_type text NOT NULL,
  resource_id text, outcome text NOT NULL, correlation_id text, occurred_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE embeddings (
  embedding_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, source_table text NOT NULL, source_record_id text NOT NULL,
  territory_id text, content_hash text NOT NULL, embedding vector(1536) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source_table, source_record_id, content_hash)
);
CREATE INDEX scope_relationship_child_idx ON territory_scope_relationships(child_territory_id, effective_from);
CREATE INDEX scope_assignment_user_idx ON user_scope_assignments(user_id, effective_from);
CREATE INDEX embeddings_vector_idx ON embeddings USING hnsw (embedding vector_cosine_ops);
