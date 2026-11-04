CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS app;

-- Raw landing tables deliberately retain source grain.  Source identifiers are
-- text and no source key is promoted to a primary key before it is validated.
CREATE TABLE call_activity (
  source_row_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  atnde_type text, addr text, call_chnl text, call_dt date, crm_call_id text,
  clm_flag boolean, call_type text, call_dur bigint, exs_inac_call_flag boolean,
  exs_jnt_msl_sls_call_flag boolean, jnt_smad_vist boolean, exs_lb_flag bigint,
  exs_lgcy_call_atnde_id text, exs_lgcy_call_id text, exs_mtg_type text,
  exs_non_npi_cust_id text, exs_snacks boolean, exs_type_of_vist text,
  is_par_call_flag boolean, is_smpld_call_flag boolean, par_call_id text,
  call_sta text, cust_src_id text, crm_med_disc_id text, derived_disease_state text,
  reason_for_visit text, crm_prd_id text, prd_nm text, territory_id text,
  territory_name text, team_nm text, crm_call_user_id text, rep_nm text,
  rep_email_id text, cust_mdm_id text, cust_full_nm text, cust_sub_typ text,
  cust_cdtl text, npi_id text, addr_ln_1 text, city text, st_cd text, pstl_cd text,
  mdm_corp_prnt_id text, mdm_corp_prnt_nm text, hq_corp_prnt_id text,
  hq_corp_prnt_nm text, sys_inserted_datetime timestamptz
);

CREATE TABLE hcp_raw_insights (
  source_row_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  insight_intrctn_dtl_sfdc_id text, response_id text, insight_submitter_info text,
  submitter_name text, submitter_email text, date_of_interaction date,
  clinical_trial text, type_of_visit text, meeting_format text, insight_region text,
  src_created_dt timestamp, region_nm text, insight_country text, country_nm text,
  insight_msl_territory text, territory_id text, territory_name text,
  parent_territory_id text, parent_territory_name text, team_nm text,
  cust_mdm_id text, cust_nm text, hcp_speciality text, hcp_institution text,
  hcp_discipline text, hcp_type text, internal_meeting_attendees text,
  insight_name text, insight_clinicaltrial_site text, site_nm text,
  insight_intrctn_rspns_sfdc_id text, qstn_txt text, rspns_txt text,
  qstn_ext_id text, qstn_tag_strt_dt timestamp, qstn_tag_end_dt timestamp,
  qstn_tag_status text, tag_nm text, pid text, priority_tag text, qstn_pid text,
  qstn_type text, molecule_type text, landscape_type text, survey_type text,
  qstn_indicator text, study_name text, derived_rspns_text text,
  follow_up_qstn_tag text, followup_qid text, followup_qstn text,
  followup_rspns text, uniq_rspns_id text, sys_inserted_datetime timestamptz,
  mdm_corp_prnt_id text, mdm_corp_prnt_nm text, hq_corp_prnt_id text,
  hq_corp_prnt_nm text, excluded_rspns_flag boolean
);

CREATE TABLE question_tag (
  source_row_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  qstn_tag_sfdc_id text, qstn_tag_nm text, src_created_dt timestamp,
  src_created_by text, src_updt_dt timestamp, src_updt_by text,
  src_delete_flag boolean, ownerid text, insight_nm text, qstn_txt text,
  qstn_tag_strt_dt timestamp, qstn_tag_end_dt timestamp, qstn_tag_status text,
  tag_nm text, pid text, priority_tag text, qstn_ext_id text, qstn_pid text,
  qstn_type text, report_tag text, molecule_type text, tumor_type text,
  survey_type text, qstn_indicator text, study_name text, follow_up_qstn_tag text,
  sys_inserted_datetime timestamptz, batch_id text, source_name text,
  dbt_scd_id text, dbt_updated_at timestamp, dbt_valid_from timestamp,
  dbt_valid_to timestamp
);

CREATE TABLE territory_rd_access (
  source_row_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  child_territory_id text, child_territory_name text,
  parent_territory_id text, rls_region_name text
);

CREATE TABLE medical_roster (
  source_row_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  first_name text, last_name text, full_name text, email_id text,
  sfdc_territory_id text, territory_id text, territory_name text, region_name text,
  start_date text, end_date text, roster_member_territory_id text, vva_user_id text,
  profile_nm text, sfdc_submitter_id text, sys_inserted_datetime text,
  batch_id text, source_name text, dbt_scd_id text, dbt_updated_at text,
  dbt_valid_from text, dbt_valid_to text, team_nm text
);

CREATE INDEX call_activity_territory_idx ON call_activity (territory_id, call_dt);
CREATE INDEX call_activity_crm_call_id_idx ON call_activity (crm_call_id);
CREATE INDEX hcp_raw_insights_territory_idx ON hcp_raw_insights (territory_id, date_of_interaction);
CREATE INDEX hcp_raw_insights_uniq_rspns_idx ON hcp_raw_insights (uniq_rspns_id);
CREATE INDEX question_tag_ext_id_idx ON question_tag (qstn_ext_id);
CREATE INDEX territory_rd_access_child_idx ON territory_rd_access (child_territory_id);
