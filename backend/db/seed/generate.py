#!/usr/bin/env python3
"""Deterministic, medium-volume synthetic oncology fixture generator.

Uses only Python's standard library and psql so local development does not need
application dependencies. It intentionally retains data defects for governance tests.
"""
from __future__ import annotations

import csv
import io
import json
import os
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from geography import BY_TERRITORY, GEOGRAPHY, city_for  # noqa: E402

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
    sql("TRUNCATE artifact_evidence, generated_artifacts, embeddings, audit_events, data_quality_issues, ingestion_runs, data_sources, metric_definitions, user_scope_assignments, user_role_assignments, role_permissions, permissions, roles, users, territory_scope_relationships, territory_geography, call_activity, hcp_raw_insights, question_tag, territory_rd_access, medical_roster RESTART IDENTITY CASCADE")
    sql("INSERT INTO roles VALUES ('msl','MSL field role'),('director','Director role'),('executive','Executive aggregate-only role'),('administrator','Data security administrator')")
    sql("INSERT INTO permissions VALUES ('source.records.read','Read source records'),('catalog.read','Read question catalog'),('aggregate.read','Read scoped aggregate values'),('admin.manage','Manage governance data')")
    sql("INSERT INTO role_permissions VALUES ('msl','source.records.read'),('msl','catalog.read'),('msl','aggregate.read'),('director','source.records.read'),('director','catalog.read'),('director','aggregate.read'),('executive','aggregate.read'),('administrator','admin.manage'),('administrator','source.records.read'),('administrator','catalog.read'),('administrator','aggregate.read')")
    roster = []
    for index in range(60):
        territory = TERRITORIES[index % len(TERRITORIES)]
        region = REGIONS[TERRITORIES.index(territory) // 6]
        # Two intentionally damaged time-only dates remain text.
        start = "09:00:00" if index == 58 else "2024-01-01"
        end = "17:30:00" if index == 59 else None
        roster.append((NAMES[index % len(NAMES)], "Clinician" + str(index + 1), f"{NAMES[index % len(NAMES)]} Clinician {index + 1}", f"staff{index + 1}@example.test", territory, territory, territory, region, start, end, territory, f"VVA-{index + 1:03}", None, f"SUB-{index + 1:03}", "2026-11-03T12:00:00Z", "MED-20261103", "synthetic", f"roster-{index + 1}", "2026-11-03T12:00:00", "2024-01-01", None, "Oncology"))
    copy_rows("medical_roster", ["first_name","last_name","full_name","email_id","sfdc_territory_id","territory_id","territory_name","region_name","start_date","end_date","roster_member_territory_id","vva_user_id","profile_nm","sfdc_submitter_id","sys_inserted_datetime","batch_id","source_name","dbt_scd_id","dbt_updated_at","dbt_valid_from","dbt_valid_to","team_nm"], roster)
    for row in seed_users:
        role = row["persona"].lower() if row["persona"] != "Administrator" else "administrator"
        # The final admin is deliberately unresolved, rather than silently joined.
        state = "unresolved" if row["user_id"] == "admin-region-04" else "matched"
        sql(f"INSERT INTO users(user_id,identity_subject,display_name,email,identity_status) VALUES ({q(row['user_id'])},{q('cognito|' + row['user_id'])},{q(row['persona'] + ' ' + row['territory_id'])},{q(row['email'])},{q(state)})")
        sql(f"INSERT INTO user_role_assignments(user_id,role_id,effective_from) VALUES ({q(row['user_id'])},{q(role)},'2024-01-01T00:00:00Z')")
        sql(f"INSERT INTO user_scope_assignments(user_id,territory_id,assignment_type,effective_from) VALUES ({q(row['user_id'])},{q(row['territory_id'])},{q('primary' if role == 'msl' else ('executive' if role == 'executive' else 'administrative'))},'2024-01-01T00:00:00Z')")
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
    sql("INSERT INTO embeddings(source_table,source_record_id,territory_id,content_hash,embedding) VALUES ('question_tag','Q-0001',NULL,'seed-question-1',array_fill(0.01::real, ARRAY[1536])::vector)")

def seed_questions() -> None:
    rows = []
    for i in range(1, 401):
        parent = None if i <= 100 else f"Q-{((i - 1) % 100) + 1:04}"
        if i == 100: parent = "Q-NOT-IN-CATALOG"  # planted orphan parent
        molecule, tumor, study = MOLECULES[i % 4], TUMORS[i % 4], STUDIES[i % 4]
        rows.append((f"TAG-{i:04}", f"Question Tag {i}", "2025-01-01T00:00:00", "seed", "2026-01-01T00:00:00", "seed", False, "seed", "Oncology insight", f"How does {molecule} fit in {tumor} discussion {i}?", "2025-01-01T00:00:00", None, "Active", "Oncology", None, "normal", f"Q-{i:04}", parent, "open_text", "clinical", molecule, tumor, "MSL pulse", tumor, study, "Follow-up" if parent else None, "2026-11-03T12:00:00Z", "QUEST-20261103", "synthetic", f"question-{i}", "2026-11-03T12:00:00", "2025-01-01T00:00:00", None))
    copy_rows("question_tag", ["qstn_tag_sfdc_id","qstn_tag_nm","src_created_dt","src_created_by","src_updt_dt","src_updt_by","src_delete_flag","ownerid","insight_nm","qstn_txt","qstn_tag_strt_dt","qstn_tag_end_dt","qstn_tag_status","tag_nm","pid","priority_tag","qstn_ext_id","qstn_pid","qstn_type","report_tag","molecule_type","tumor_type","survey_type","qstn_indicator","study_name","follow_up_qstn_tag","sys_inserted_datetime","batch_id","source_name","dbt_scd_id","dbt_updated_at","dbt_valid_from","dbt_valid_to"], rows)

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
        rows.append(("in-person",city.street,"field",d.isoformat(),call_id,False,"scientific",45,False,False,False,0,None,None,"advisory",None,False,"HCP",False,False,None,"completed",hcp,"MED-" + str(i % 20),TUMORS[i % 4],"pre-call planning","PRD-" + str(i % 4),molecule,territory,territory + " Oncology","Oncology","REP-" + territory,"Synthetic Rep",None,hcp,"Synthetic HCP " + hcp,"oncologist","MD",None,city.street,city.name,geo.subdivision_code,city.postal_code,None,None,None,None,"2026-11-03T12:00:00Z"))
    copy_rows("call_activity", ["atnde_type","addr","call_chnl","call_dt","crm_call_id","clm_flag","call_type","call_dur","exs_inac_call_flag","exs_jnt_msl_sls_call_flag","jnt_smad_vist","exs_lb_flag","exs_lgcy_call_atnde_id","exs_lgcy_call_id","exs_mtg_type","exs_non_npi_cust_id","exs_snacks","exs_type_of_vist","is_par_call_flag","is_smpld_call_flag","par_call_id","call_sta","cust_src_id","crm_med_disc_id","derived_disease_state","reason_for_visit","crm_prd_id","prd_nm","territory_id","territory_name","team_nm","crm_call_user_id","rep_nm","rep_email_id","cust_mdm_id","cust_full_nm","cust_sub_typ","cust_cdtl","npi_id","addr_ln_1","city","st_cd","pstl_cd","mdm_corp_prnt_id","mdm_corp_prnt_nm","hq_corp_prnt_id","hq_corp_prnt_nm","sys_inserted_datetime"], rows)

def seed_insights() -> None:
    rows = []
    for i in range(60000):
        territory = TERRITORIES[i % len(TERRITORIES)]
        region = REGIONS[i % len(TERRITORIES) // 6]
        hcp = f"HCP-{(i % 3000) + 1:04}"
        question = f"Q-{(i % 400) + 1:04}"
        status = "Retired" if i % 10 == 0 else "Active"  # catalog-vs-response status difference
        unique = "RESP-000001" if i == 59999 else f"RESP-{i + 1:06}"
        d = TODAY - timedelta(days=i % 365)
        geo = BY_TERRITORY[territory]
        rows.append((f"INT-{i + 1:06}",f"RAW-{i + 1:06}","seed",None,None,d.isoformat(),STUDIES[i % 4],"field","in-person",region,"2026-01-01T00:00:00",region,geo.country_code,geo.country_name,territory,territory,territory + " Oncology",region,region + " Region","Oncology",hcp,"Synthetic HCP " + hcp,"medical oncology","Synthetic Cancer Center","oncology","HCP",None,"Oncology insight",None,None,f"INS-{i + 1:06}",f"How does {MOLECULES[i % 4]} fit in {TUMORS[i % 4]} discussion?",f"Recorded perspective {i % 17}: evidence and access are important.",question,"2025-01-01T00:00:00",None,status,"Oncology",None,"normal",None,"open_text",MOLECULES[i % 4],"treatment landscape","MSL pulse",TUMORS[i % 4],STUDIES[i % 4],None,None,None,None,None,unique,"2026-11-03T12:00:00Z",None,None,None,None,False))
    copy_rows("hcp_raw_insights", ["insight_intrctn_dtl_sfdc_id","response_id","insight_submitter_info","submitter_name","submitter_email","date_of_interaction","clinical_trial","type_of_visit","meeting_format","insight_region","src_created_dt","region_nm","insight_country","country_nm","insight_msl_territory","territory_id","territory_name","parent_territory_id","parent_territory_name","team_nm","cust_mdm_id","cust_nm","hcp_speciality","hcp_institution","hcp_discipline","hcp_type","internal_meeting_attendees","insight_name","insight_clinicaltrial_site","site_nm","insight_intrctn_rspns_sfdc_id","qstn_txt","rspns_txt","qstn_ext_id","qstn_tag_strt_dt","qstn_tag_end_dt","qstn_tag_status","tag_nm","pid","priority_tag","qstn_pid","qstn_type","molecule_type","landscape_type","survey_type","qstn_indicator","study_name","derived_rspns_text","follow_up_qstn_tag","followup_qid","followup_qstn","followup_rspns","uniq_rspns_id","sys_inserted_datetime","mdm_corp_prnt_id","mdm_corp_prnt_nm","hq_corp_prnt_id","hq_corp_prnt_nm","excluded_rspns_flag"], rows)

def main() -> None:
    seed_users = users()
    MANIFEST.write_text(json.dumps({"generated_from": "deterministic-v1", "users": seed_users}, indent=2) + "\n")
    seed_entitlements(seed_users)
    seed_questions()
    seed_calls()
    seed_insights()
    print(json.dumps({"call_rows": 25000, "insight_rows": 60000, "questions": 400, "seed_users": len(seed_users), "manifest": str(MANIFEST)}))

if __name__ == "__main__":
    main()
