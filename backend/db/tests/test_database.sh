#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
: "${DATABASE_URL:=postgresql://postgres:postgres@localhost:55432/agent2go}"

expect() {
  local actual=$1 expected=$2 label=$3
  if [ "$actual" != "$expected" ]; then
    echo "FAIL $label: expected [$expected], got [$actual]" >&2
    exit 1
  fi
  echo "PASS $label"
}

query_as() { # user, persona, SQL expression returning one scalar
  psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 <<SQL | tail -n 1
BEGIN;
SET LOCAL ROLE app_user;
SELECT app.set_request_identity('$1', '$2', 'test-correlation');
SELECT $3;
COMMIT;
SQL
}

# MSL sees its assigned leaf territory only; catalog visibility is independent.
expect "$(query_as msl-t01-01 MSL "count(*) FROM call_activity WHERE territory_id <> 'T01-01'")" "0" "MSL cannot read another territory"
expect "$(query_as msl-t01-01 MSL "count(*) FROM question_tag")" "400" "MSL can read catalog"
expect "$(query_as executive-region-01 Executive "count(*) FROM call_activity")" "0" "executive aggregate-only role cannot read source rows"
expect "$(query_as executive-region-01 Executive "app.can_read_aggregate()")" "t" "executive has aggregate permission"
direct_login=$(psql "postgresql://app_user:app_user@localhost:55432/agent2go" -X -qAt -v ON_ERROR_STOP=1 <<'SQL' | tail -n 1
BEGIN;
SELECT app.set_request_identity('msl-t01-01', 'MSL', 'test-correlation');
SELECT count(*) FROM call_activity WHERE territory_id <> 'T01-01';
COMMIT;
SQL
)
expect "$direct_login" "0" "non-owner app_user connection enforces RLS"
director_outside=$(query_as director-region-01 Director "count(*) FROM call_activity WHERE territory_id LIKE 'T02-%'")
director_inside=$(query_as director-region-01 Director "count(*) FROM call_activity WHERE territory_id LIKE 'T01-%'")
if [ "$director_outside" != 0 ] || [ "$director_inside" -le 0 ]; then
  echo "FAIL hierarchy-aware director scope" >&2; exit 1
fi
echo "PASS hierarchy-aware director scope"

# A temporary assignment changing effective scope changes the rows returned.
before=$(query_as msl-t01-01 MSL "count(*) FROM call_activity WHERE territory_id = 'T01-01'")
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
UPDATE user_scope_assignments SET effective_to = now() - interval '1 minute'
 WHERE user_id = 'msl-t01-01' AND territory_id = 'T01-01' AND effective_to IS NULL;
INSERT INTO user_scope_assignments(user_id, territory_id, assignment_type, effective_from)
 VALUES ('msl-t01-01', 'T01-02', 'temporary', now() - interval '1 minute');
COMMIT;
SQL
after_old=$(query_as msl-t01-01 MSL "count(*) FROM call_activity WHERE territory_id = 'T01-01'")
after_new=$(query_as msl-t01-01 MSL "count(*) FROM call_activity WHERE territory_id = 'T01-02'")
if [ "$before" -le 0 ] || [ "$after_old" != 0 ] || [ "$after_new" -le 0 ]; then
  echo "FAIL effective-dated reassignment" >&2; exit 1
fi
echo "PASS effective-dated reassignment"

# app_user is non-owner and RLS still applies even if it asks PostgreSQL to turn it off.
if psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null 2>&1
BEGIN;
SET LOCAL ROLE app_user;
SELECT app.set_request_identity('msl-t01-01', 'MSL', 'test-correlation');
SET LOCAL row_security = off;
SELECT count(*) FROM call_activity;
COMMIT;
SQL
then
  echo "FAIL app_user bypassed RLS" >&2; exit 1
fi
echo "PASS app_user cannot bypass RLS"

# Source schema fidelity, volume and all deliberate defects.
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) - 1 FROM information_schema.columns WHERE table_name='call_activity'")" "48" "Call Activity has 48 documented columns"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) - 1 FROM information_schema.columns WHERE table_name='hcp_raw_insights'")" "59" "HCPRawInsights has 59 documented columns"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) - 1 FROM information_schema.columns WHERE table_name='question_tag'")" "33" "Question tag has 33 documented columns"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) - 1 FROM information_schema.columns WHERE table_name='territory_rd_access'")" "4" "Territory access has 4 documented columns"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) - 1 FROM information_schema.columns WHERE table_name='medical_roster'")" "22" "Medical roster has 22 documented columns"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND NOT relrowsecurity")" "0" "RLS is enabled on every table"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) FROM call_activity")" "25000" "medium-volume calls"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) FROM hcp_raw_insights")" "60000" "medium-volume insight responses"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(DISTINCT cust_mdm_id) FROM hcp_raw_insights")" "3000" "medium-volume HCP population"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) FROM hcp_raw_insights GROUP BY uniq_rspns_id HAVING count(*) > 1")" "2" "duplicate response key is planted"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) FROM question_tag WHERE qstn_pid = 'Q-NOT-IN-CATALOG'")" "1" "orphan parent question is planted"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) FROM ingestion_runs WHERE status IN ('failed')")" "1" "failed ingestion is planted"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) FROM ingestion_runs WHERE run_id='run-stale'")" "1" "stale ingestion is planted"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) FROM users WHERE identity_status='unresolved'")" "1" "unresolved identity is planted"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) FROM medical_roster WHERE start_date ~ '^[0-9]{2}:[0-9]{2}:'")" "1" "time-only roster date is planted"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) FROM hcp_raw_insights i JOIN question_tag q ON q.qstn_ext_id=i.qstn_ext_id WHERE i.qstn_tag_status <> q.qstn_tag_status")" "6000" "catalog-response status differences are planted"

# Generator is deterministic: content checksum and manifest checksum survive a full re-seed.
before_checksum=$(psql "$DATABASE_URL" -X -qAtc "SELECT md5(string_agg(concat_ws('|',crm_call_id,territory_id,prd_nm),',' ORDER BY source_row_id)) FROM call_activity")
before_manifest=$(shasum -a 256 "$ROOT/seed-users.json" | awk '{print $1}')
python3 "$ROOT/seed/generate.py" >/dev/null
after_checksum=$(psql "$DATABASE_URL" -X -qAtc "SELECT md5(string_agg(concat_ws('|',crm_call_id,territory_id,prd_nm),',' ORDER BY source_row_id)) FROM call_activity")
after_manifest=$(shasum -a 256 "$ROOT/seed-users.json" | awk '{print $1}')
expect "$after_checksum" "$before_checksum" "deterministic call seed"
expect "$after_manifest" "$before_manifest" "deterministic user manifest"
