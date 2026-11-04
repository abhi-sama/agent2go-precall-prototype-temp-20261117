#!/usr/bin/env python3
"""Deterministic, medium-volume synthetic oncology fixture generator.

Uses only Python's standard library and psql so local development does not need
application dependencies. It intentionally retains data defects for governance tests.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from geography import BY_TERRITORY, GEOGRAPHY, city_for  # noqa: E402
from insights import HI_COLUMNS, QT_COLUMNS, generate as generate_insight_data  # noqa: E402

DSN = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:55432/agent2go")
ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "seed-users.json"
TODAY = date(2026, 11, 3)
REGIONS = [f"REGION-{n:02}" for n in range(1, 5)]
TERRITORIES = [f"T{region[-2:]}-{n:02}" for region in REGIONS for n in range(1, 7)]
MOLECULES = ["trastuzumab deruxtecan", "osimertinib", "pembrolizumab", "sacituzumab govitecan"]
TUMORS = ["breast cancer", "non-small cell lung cancer", "gastric cancer", "urothelial cancer"]
STUDIES = ["DESTINY-Breast06", "FLAURA2", "KEYNOTE-671", "TROPiCS-02"]
NAMES = ["Avery", "Jordan", "Riley", "Morgan", "Taylor", "Casey", "Cameron", "Quinn"]

def q(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    return "'" + str(value).replace("'", "''") + "'"

def sql(statement: str) -> None:
    subprocess.run(["psql", DSN, "-v", "ON_ERROR_STOP=1", "-q", "-c", statement], check=True)

def copy_rows(table: str, columns: list[str], rows) -> None:
    proc = subprocess.Popen(["psql", DSN, "-v", "ON_ERROR_STOP=1", "-q"], stdin=subprocess.PIPE, text=True)
    assert proc.stdin is not None
    proc.stdin.write("\\copy " + table + " (" + ",".join(columns) + ") FROM STDIN WITH (FORMAT csv, NULL '')\n")
    writer = csv.writer(proc.stdin, lineterminator="\n")
    for row in rows:
        writer.writerow(["" if x is None else x for x in row])
    proc.stdin.write("\\.\n")
    proc.stdin.close()
    if proc.wait() != 0:
        raise SystemExit(f"COPY failed for {table}")

def users() -> list[dict[str, str]]:
    result = []
    for index, territory in enumerate(TERRITORIES, 1):
        result.append({"user_id": f"msl-{territory.lower()}", "email": f"msl.{territory.lower()}@example.test", "cognito_group": "MSL", "persona": "MSL", "territory_id": territory})
    for region in REGIONS:
        for role, group in [("director", "Director"), ("executive", "Executive")]:
            result.append({"user_id": f"{role}-{region.lower()}", "email": f"{role}.{region.lower()}@example.test", "cognito_group": group, "persona": group, "territory_id": region})
    for region in REGIONS:
        result.append({"user_id": f"admin-{region.lower()}", "email": f"admin.{region.lower()}@example.test", "cognito_group": "Administrator", "persona": "Administrator", "territory_id": region})
    return result

def seed_entitlements(seed_users: list[dict[str, str]]) -> None:
    sql("TRUNCATE target_assignments, hcp_identifier_crosswalk, hcp_entities, artifact_evidence, generated_artifacts, embeddings, governance_request_audit, governance_requests, governed_definitions, audit_events, data_quality_issues, ingestion_runs, data_sources, metric_definitions, user_scope_assignments, user_role_assignments, role_permissions, permissions, roles, users, territory_scope_relationships, territory_geography, call_activity, hcp_raw_insights, question_tag, territory_rd_access, medical_roster RESTART IDENTITY CASCADE")
    sql("INSERT INTO roles VALUES ('msl','MSL field role'),('director','Director role'),('executive','Executive aggregate-only role'),('administrator','Data security administrator')")
    sql("INSERT INTO permissions VALUES ('source.records.read','Read source records'),('catalog.read','Read question catalog'),('aggregate.read','Read scoped aggregate values'),('admin.manage','Manage governance data'),('team.overview.read','Read the team and territory overview')")
    sql("INSERT INTO role_permissions VALUES ('msl','source.records.read'),('msl','catalog.read'),('msl','aggregate.read'),('director','source.records.read'),('director','catalog.read'),('director','aggregate.read'),('executive','aggregate.read'),('administrator','admin.manage'),('administrator','source.records.read'),('administrator','catalog.read'),('administrator','aggregate.read'),('director','team.overview.read'),('administrator','team.overview.read')")
    roster = []
    for index in range(60):
        territory = TERRITORIES[index % len(TERRITORIES)]
        region = REGIONS[TERRITORIES.index(territory) // 6]
        # Two intentionally damaged time-only dates remain text.
        start = "09:00:00" if index == 58 else "2024-01-01"
        end = "17:30:00" if index == 59 else None
        roster.append((NAMES[index % len(NAMES)], "Clinician" + str(index + 1), f"{NAMES[index % len(NAMES)]} Clinician {index + 1}", f"staff{index + 1}@example.test", territory, territory, territory, region, start, end, territory, f"VVA-{index + 1:03}", None, f"SUB-{index + 1:03}", "2026-11-03T12:00:00Z", "MED-20261103", "synthetic", f"roster-{index + 1}", "2026-11-03T12:00:00", "2024-01-01", None, "Oncology"))
    copy_rows("medical_roster", ["first_name","last_name","full_name","email_id","sfdc_territory_id","territory_id","territory_name","region_name","start_date","end_date","roster_member_territory_id","vva_user_id","profile_nm","sfdc_submitter_id","sys_inserted_datetime","batch_id","source_name","dbt_scd_id","dbt_updated_at","dbt_valid_from","dbt_valid_to","team_nm"], roster)
    # Governance fixture: an unresolved login has two exact-email roster candidates.
    # They stay candidates until an administrator explicitly approves one; the seed
    # deliberately does not choose a row based on a similar identity.
    duplicate_login = "admin.region-04@example.test"
    for suffix in ("A", "B"):
        sql(f"INSERT INTO medical_roster(first_name,last_name,full_name,email_id,territory_id,territory_name,region_name,sys_inserted_datetime,source_name,dbt_scd_id,dbt_updated_at,dbt_valid_from,team_nm) VALUES ('Review','Candidate {suffix}','Review Candidate {suffix}',{q(duplicate_login)},'T04-01','T04-01','REGION-04','2026-11-03T12:00:00Z','synthetic',{q('roster-review-' + suffix)},'2026-11-03T12:00:00','2024-01-01','Oncology')")
    for row in seed_users:
        role = row["persona"].lower() if row["persona"] != "Administrator" else "administrator"
        # The final admin is deliberately unresolved, rather than silently joined.
        state = "unresolved" if row["user_id"] == "admin-region-04" else "matched"
        # This is a pre-approved mapping, not an inferred email join.  It gives the
        # reconciliation screen an affirmative case beside missing/conflicting cases.
        roster_source = "1" if row["user_id"] == "admin-region-01" else "NULL"
        sql(f"INSERT INTO users(user_id,identity_subject,display_name,email,identity_status,roster_source_row_id) VALUES ({q(row['user_id'])},{q('cognito|' + row['user_id'])},{q(row['persona'] + ' ' + row['territory_id'])},{q(row['email'])},{q(state)},{roster_source})")
        sql(f"INSERT INTO user_role_assignments(user_id,role_id,effective_from) VALUES ({q(row['user_id'])},{q(role)},'2024-01-01T00:00:00Z')")
        sql(f"INSERT INTO user_scope_assignments(user_id,territory_id,assignment_type,effective_from) VALUES ({q(row['user_id'])},{q(row['territory_id'])},{q('primary' if role == 'msl' else ('executive' if role == 'executive' else 'administrative'))},'2024-01-01T00:00:00Z')")
    sql("INSERT INTO user_scope_assignments(user_id,territory_id,assignment_type,effective_from) VALUES ('admin-region-03','UNRESOLVED-01','administrative','2024-01-01T00:00:00Z')")
    territory_rows = []
    relation_rows = []
    for i, territory in enumerate(TERRITORIES):
        region = REGIONS[i // 6]
        territory_rows.append((territory, territory + " Oncology", region, region))
        relation_rows.append((territory, region, region, "2024-01-01T00:00:00Z", None))
    # Defect coverage: an intentionally overlapping/multiple-parent relationship.
    territory_rows.append((TERRITORIES[0], TERRITORIES[0] + " Oncology", "NATIONAL-01", "National"))
    relation_rows.append((TERRITORIES[0], "NATIONAL-01", "National", "2024-01-01T00:00:00Z", None))
    copy_rows("territory_rd_access", ["child_territory_id","child_territory_name","parent_territory_id","rls_region_name"], territory_rows)
    copy_rows("territory_scope_relationships", ["child_territory_id","parent_territory_id","region_name","effective_from","effective_to"], relation_rows)
    copy_rows("territory_geography", ["territory_id","country_code","country_name","subdivision_code","subdivision_name","city","latitude","longitude"], [(g.territory_id, g.country_code, g.country_name, g.subdivision_code, g.subdivision_name, g.primary_city, g.latitude, g.longitude) for g in GEOGRAPHY])
    sql("INSERT INTO data_sources VALUES ('call-activity','Call Activity','call_activity','synthetic',true),('hcp-insights','HCP Raw Insights','hcp_raw_insights','synthetic',true),('question-tag','Question tag','question_tag','synthetic',true),('roster','Medical roster','medical_roster','synthetic',true)")
    sql("INSERT INTO ingestion_runs VALUES ('run-current','call-activity','completed','2026-11-03T08:00:00Z','2026-11-03T08:30:00Z',25000,NULL),('run-stale','hcp-insights','completed','2025-01-01T08:00:00Z','2025-01-01T08:30:00Z',60000,NULL),('run-failed','question-tag','failed','2026-11-03T09:00:00Z','2026-11-03T09:01:00Z',0,'Synthetic source delivery failure')")
    sql("INSERT INTO data_quality_issues VALUES ('dq-duplicate-response','duplicate_key','hcp-insights','RESP-000001','open','{\"defect\":\"duplicate uniq_rspns_id\"}','2026-11-03T12:00:00Z',NULL),('dq-orphan-parent','invalid_parent','question-tag','Q-0100','open','{\"defect\":\"orphan qstn_pid\"}','2026-11-03T12:00:00Z',NULL),('dq-unresolved-identity','unresolved_identity','roster',NULL,'open','{\"defect\":\"unmatched login\"}','2026-11-03T12:00:00Z',NULL)")
    sql("INSERT INTO metric_definitions VALUES ('distinct-calls',1,'Distinct calls','COUNT(DISTINCT crm_call_id), excluding null identifiers','admin-region-01','approved','2026-11-01T00:00:00Z')")
    sql("INSERT INTO governed_definitions(definition_id,version,kind,name,definition,owner_user_id,status,approved_by,approved_at) VALUES ('distinct-calls',1,'metric','Distinct calls','Count distinct crm_call_id; repeated call-product rows do not increase the count.','admin-region-01','approved','admin-region-02','2026-11-01T00:00:00Z'),('emerging-topic-rule',1,'metric','Emerging-topic alert threshold','A theme is flagged as rising when both periods hold at least 30 free-text responses, the theme has at least 10 responses in the latest period, its share rose by at least 2 percentage points and is at least 1.5 times the earlier share. Falling is the mirror image. It describes a change in recorded responses, never a cause.','admin-region-01','approved','admin-region-02','2026-11-01T00:00:00Z'),('q-0001',1,'question','Question Q-0001','Canonical question wording and applicability for Q-0001.','admin-region-01','draft',NULL,NULL)")
    sql("INSERT INTO governance_requests(request_type,resource_type,resource_id,reason,status,requested_by,decided_by,decided_at,decision_note) VALUES ('correction','question_tag','Q-0100','Parent question needs source investigation.','in_review','admin-region-01','admin-region-02','2026-11-03T12:30:00Z','Reviewing source lineage.'),('deletion','hcp_raw_insights','RESP-000001','Duplicate response key requires deletion review.','open','admin-region-01',NULL,NULL,NULL)")
    sql("INSERT INTO governance_request_audit(request_id,actor_user_id,action,note) VALUES (1,'admin-region-01','created','Request opened from quality finding.'),(1,'admin-region-02','reviewed','Source lineage review started.'),(2,'admin-region-01','created','Duplicate response deletion review opened.')")
    sql("INSERT INTO embeddings(source_table,source_record_id,territory_id,content_hash,embedding) VALUES ('question_tag','Q-0001',NULL,'seed-question-1',array_fill(0.01::real, ARRAY[1536])::vector)")

def seed_questions() -> None:
    questions, _ = generate_insight_data()
    copy_rows("question_tag", QT_COLUMNS, ([row[c] for c in QT_COLUMNS] for row in questions))

def seed_calls() -> None:
    rows = []
    for i in range(25000):
        # Every physical call has two product rows: same call id, territory, HCP and date,
        # different product. Counting raw rows would double the call count.
        call = i // 2
        territory = TERRITORIES[call % len(TERRITORIES)]
        hcp = f"HCP-{(call % 3000) + 1:04}"
        call_id = f"CALL-{call + 1:05}"
        molecule = MOLECULES[i % 4]
        d = TODAY - timedelta(days=call % 365)
        # Address columns come from the territory's real geography: the city, state and
        # postal code always belong together, and agree with territory_geography.
        geo = BY_TERRITORY[territory]
        city = city_for(territory, call // len(TERRITORIES))
        name = "Call system HCP 0001" if hcp == "HCP-0001" else "Synthetic HCP " + hcp
        rows.append(("in-person",city.street,"field",d.isoformat(),call_id,False,"scientific",45,False,False,False,0,None,None,"advisory",None,False,"HCP",False,False,None,"completed",hcp,"MED-" + str(i % 20),TUMORS[i % 4],"pre-call planning","PRD-" + str(i % 4),molecule,territory,territory + " Oncology","Oncology","REP-" + territory,"Synthetic Rep",None,hcp,name,"oncologist",None if hcp == "HCP-0001" else "MD",None,city.street,city.name,geo.subdivision_code,city.postal_code,None,None,None,None,"2026-11-03T12:00:00Z"))
    copy_rows("call_activity", ["atnde_type","addr","call_chnl","call_dt","crm_call_id","clm_flag","call_type","call_dur","exs_inac_call_flag","exs_jnt_msl_sls_call_flag","jnt_smad_vist","exs_lb_flag","exs_lgcy_call_atnde_id","exs_lgcy_call_id","exs_mtg_type","exs_non_npi_cust_id","exs_snacks","exs_type_of_vist","is_par_call_flag","is_smpld_call_flag","par_call_id","call_sta","cust_src_id","crm_med_disc_id","derived_disease_state","reason_for_visit","crm_prd_id","prd_nm","territory_id","territory_name","team_nm","crm_call_user_id","rep_nm","rep_email_id","cust_mdm_id","cust_full_nm","cust_sub_typ","cust_cdtl","npi_id","addr_ln_1","city","st_cd","pstl_cd","mdm_corp_prnt_id","mdm_corp_prnt_nm","hq_corp_prnt_id","hq_corp_prnt_nm","sys_inserted_datetime"], rows)

def seed_insights() -> None:
    _, responses = generate_insight_data()
    copy_rows("hcp_raw_insights", HI_COLUMNS, ([row[c] for c in HI_COLUMNS] for row in responses))

def embedding(text: str) -> str:
    values = [0.0] * 1536
    for token in text.lower().split():
        digest = hashlib.blake2b(token.encode(), digest_size=8).digest()
        values[int.from_bytes(digest[:4], "big") % len(values)] += 1 if digest[4] & 1 else -1
    magnitude = sum(value * value for value in values) ** 0.5
    return "[" + ",".join(str(value / magnitude if magnitude else 0) for value in values) + "]"

def seed_insight_embeddings() -> None:
    # A representative sample of real free-text answers, 25 per territory, so semantic search has
    # something to find in every scope while a local reset stays quick.
    _, responses = generate_insight_data()
    per_territory: dict[str, list[dict]] = {}
    for row in responses:
        if row["qstn_type"] == "open_text":
            per_territory.setdefault(row["territory_id"], []).append(row)
    rows = []
    for territory in TERRITORIES:
        pool = per_territory[territory]
        for row in pool[:: max(1, len(pool) // 25)][:25]:
            response_id = row["uniq_rspns_id"]
            rows.append(("hcp_raw_insights", response_id, territory, f"seed-insight-{response_id}", embedding(row["qstn_txt"] + " " + row["rspns_txt"]), "local", "local-open-source"))
    copy_rows("embeddings", ["source_table", "source_record_id", "territory_id", "content_hash", "embedding", "embedding_provider", "embedding_model"], rows)

def seed_hcp_crosswalk() -> None:
    copy_rows("hcp_entities", ["hcp_id"], [(f"HCP-{i:04}",) for i in range(1, 3001)])
    rows = []
    for i in range(1, 3001):
        hcp = f"HCP-{i:04}"; rows.extend([("call_activity.cust_mdm_id", hcp, hcp), ("hcp_raw_insights.cust_mdm_id", "LEGACY-HCP-0001" if i == 1 else hcp, hcp)])
    copy_rows("hcp_identifier_crosswalk", ["source_system", "source_identifier", "hcp_id"], rows)

def main() -> None:
    seed_users = users()
    MANIFEST.write_text(json.dumps({"generated_from": "deterministic-v1", "users": seed_users}, indent=2) + "\n")
    seed_entitlements(seed_users)
    seed_questions()
    seed_calls()
    seed_insights()
    seed_insight_embeddings()
    seed_hcp_crosswalk()
    print(json.dumps({"call_rows": 25000, "insight_rows": 60000, "questions": 400, "seed_users": len(seed_users), "manifest": str(MANIFEST)}))

if __name__ == "__main__":
    main()
