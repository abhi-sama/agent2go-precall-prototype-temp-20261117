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
# Target populations (coverage denominator) follow the same scope as the calls they are measured against.
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c "INSERT INTO target_assignments(entity_id, scope_id, status, approved_by, effective_from) VALUES ('HCP-RLS-1','T01-01','approved','admin-region-01','2024-01-01'),('HCP-RLS-2','T02-01','approved','admin-region-01','2024-01-01')"
expect "$(query_as msl-t01-01 MSL "count(*) FROM target_assignments")" "1" "MSL sees only its own territory's targets"
expect "$(query_as director-region-01 Director "count(*) FROM target_assignments")" "1" "Director sees only descendant territories' targets"
expect "$(query_as executive-region-01 Executive "count(*) FROM target_assignments")" "0" "aggregate-only role cannot read target rows"
expect "$(query_as director-region-01 Director "app.has_permission('team.overview.read')")" "t" "Director holds the team overview permission"
expect "$(query_as msl-t01-01 MSL "app.has_permission('team.overview.read')")" "f" "MSL does not hold the team overview permission"
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c "DELETE FROM target_assignments WHERE entity_id LIKE 'HCP-RLS-%'"
APP_DSN=$(printf '%s' "$DATABASE_URL" | sed -E 's#//[^@]+@#//app_user:app_user@#')
direct_login=$(psql "$APP_DSN" -X -qAt -v ON_ERROR_STOP=1 <<'SQL' | tail -n 1
BEGIN;
SELECT app.set_request_identity('msl-t01-01', 'MSL', 'test-correlation');
SELECT count(*) FROM call_activity WHERE territory_id <> 'T01-01';
COMMIT;
SQL
)
expect "$direct_login" "0" "non-owner app_user connection enforces RLS"

# Territory geography: scoped like every other table, and the aggregate functions give the
# aggregate-only Executive counts of their own scope without any row access.
expect "$(query_as msl-t01-01 MSL "count(*) FROM territory_geography")" "1" "MSL sees only own territory geography"
expect "$(query_as executive-region-01 Executive "count(*) FROM territory_geography")" "6" "executive sees geography of own scope"
expect "$(query_as executive-region-01 Executive "count(*) FROM app.geo_territories('2026-01-01','2026-11-03') WHERE territory_id NOT LIKE 'T01-%'")" "0" "aggregate function never returns out-of-scope territories"
expect "$(query_as executive-region-01 Executive "count(*) FROM app.geo_countries('2026-01-01','2026-11-03')")" "2" "executive region 1 spans two countries"
expect "$(query_as executive-region-01 Executive "min(distinct_calls) > 0 FROM app.geo_territories('2026-01-01','2026-11-03')")" "t" "executive gets aggregate counts without source rows"
expect "$(query_as msl-t01-01 MSL "count(*) FROM app.geo_territories('2026-01-01','2026-11-03')")" "1" "MSL aggregate path is limited to own territory"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) FROM call_activity c LEFT JOIN territory_geography g USING (territory_id) WHERE g.territory_id IS NULL")" "0" "every call territory has a real location"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) FROM call_activity c JOIN territory_geography g USING (territory_id) WHERE c.st_cd <> g.subdivision_code")" "0" "call state agrees with territory location"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) FROM hcp_raw_insights i JOIN territory_geography g USING (territory_id) WHERE i.insight_country <> g.country_code")" "0" "insight country agrees with territory location"
# Executive overview: scope is explicit executive assignments only, counts only, never rows.
expect "$(query_as executive-region-01 Executive "count(*) FROM app.executive_scope_territories()")" "7" "executive scope is the assigned region and its territories"
expect "$(query_as executive-region-01 Executive "count(*) FROM app.exec_units() WHERE territory_id NOT LIKE 'T01-%'")" "0" "executive units never leave the assigned region"
expect "$(query_as executive-region-01 Executive "calls > 0 FROM app.exec_cells('2026-08-01','2026-10-31') WHERE level = 'TOTAL'")" "t" "executive gets aggregate totals without source rows"
expect "$(query_as director-region-01 Director "count(*) FROM app.executive_scope_territories()")" "0" "a director has no executive scope"
expect "$(query_as msl-t01-01 MSL "calls FROM app.exec_cells('2026-08-01','2026-10-31') WHERE level = 'TOTAL'")" "0" "an MSL gets nothing from the executive aggregate path"
expect "$(query_as executive-region-01 Executive "count(*) FROM call_activity")" "0" "executive still reads no call rows"
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

# Insight variety: every answer type is present, with conditional follow-ups and real qualitative text.
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(DISTINCT qstn_type) FROM question_tag")" "9" "question catalog spans nine answer types"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) >= 2000 FROM (SELECT DISTINCT rspns_txt FROM hcp_raw_insights WHERE qstn_type='open_text') t")" "t" "at least 2000 distinct qualitative answers"
expect "$(psql "$DATABASE_URL" -X -qAtc "SELECT count(*) FROM hcp_raw_insights c WHERE c.qstn_pid IS NOT NULL AND c.qstn_pid <> 'Q-NOT-IN-CATALOG' AND NOT EXISTS (SELECT 1 FROM hcp_raw_insights p WHERE p.insight_intrctn_dtl_sfdc_id=c.insight_intrctn_dtl_sfdc_id AND p.qstn_ext_id=c.qstn_pid)")" "0" "every follow-up has its parent in the same interaction"

# Generator is deterministic: content checksum and manifest checksum survive a full re-seed.
before_checksum=$(psql "$DATABASE_URL" -X -qAtc "SELECT md5(string_agg(concat_ws('|',crm_call_id,territory_id,prd_nm),',' ORDER BY source_row_id)) FROM call_activity")
insight_sql="SELECT md5(string_agg(concat_ws('|',uniq_rspns_id,cust_mdm_id,qstn_ext_id,rspns_txt,followup_rspns,date_of_interaction),',' ORDER BY source_row_id)) FROM hcp_raw_insights"
before_insights=$(psql "$DATABASE_URL" -X -qAtc "$insight_sql")
before_manifest=$(shasum -a 256 "$ROOT/seed-users.json" | awk '{print $1}')
python3 "$ROOT/seed/generate.py" >/dev/null
after_checksum=$(psql "$DATABASE_URL" -X -qAtc "SELECT md5(string_agg(concat_ws('|',crm_call_id,territory_id,prd_nm),',' ORDER BY source_row_id)) FROM call_activity")
after_manifest=$(shasum -a 256 "$ROOT/seed-users.json" | awk '{print $1}')
expect "$after_checksum" "$before_checksum" "deterministic call seed"
expect "$(psql "$DATABASE_URL" -X -qAtc "$insight_sql")" "$before_insights" "deterministic insight seed"
expect "$after_manifest" "$before_manifest" "deterministic user manifest"
