# MSL Agent — Persona Feature Requirements

Transcribed from the captain's photographed requirements document (10 pages, 11 photos; two photos show the same page).
Wording is kept as written. Obscured characters were restored from context and are marked `[restored]`.
The build spec and tickets that implement this document live in GitHub issue #1 and its sub-issues.

## 1. MSL — Field workspace

### Call preparation — highest priority

- Search and select authorized HCPs.
- Generate a source-linked pre-call brief.
- Review HCP specialty, institution, and territory.
- View previous calls, topics, products, and interaction dates.
- Review the HCP's recorded insight responses.
- Interpret follow-up answers with their parent-question context.
- Find relevant catalog questions by molecule, tumor type, study, or survey.
- Add an upcoming call objective.
- Generate suggested agenda and discussion prompts for review.
- View data freshness, missing information, and supporting records.
- Export a pre-call brief.

### HCP insights and territory awareness

- View an HCP interaction and insight timeline.
- Search insights using natural-language questions.
- Filter by date, territory, molecule, disease area, study, survey, and question.
- Explore response distributions and qualitative themes.
- Track recorded perspectives over time.
- Identify possible follow-up topics.
- View personal/territory activity trends.
- Save filters and reports.
- Flag incorrect summaries, identifiers, or territory assignments.

### Optional later features

- Draft structured post-call notes for MSL review.
- Track user-confirmed follow-up actions.
- Receive relevant topic alerts.

## 2. Director — Team and territory oversight

- View activity across authorized reporting territories.
- Monitor call trends by MSL, territory, channel, topic, and product.
- Review distinct HCP engagement and recorded coverage.
- Compare territories over consistent periods and metric definitions.
- Review insight themes by molecule, tumor type, study, and survey.
- Monitor question-level response distributions.
- Identify emerging topics with supporting records.
- Review possible follow-up themes.
- Drill down from territory summaries to permitted HCP records.
- Identify missing reporting, stale data, and data-quality exceptions.
- Save and export authorized reports.
- Ask natural-language questions about the authorized team or territory.

## 3. Executive — Regional and enterprise oversight

- View summaries across explicitly authorized regions or hierarchies.
- Monitor broad activity and insight trends.
- Compare authorized regions and territories.
- Review portfolio, molecule, disease-area, and study-level themes.
- Identify cross-region emerging topics.
- Review aggregate HCP engagement and reporting patterns.
- Access aggregate-only views where individual records are unnecessary.
- Drill down to supporting records only when separately authorized.
- Generate source-linked leadership summaries.
- Save and export authorized executive reports.
- Ask natural-language questions within the permitted scope.

## 4. Data / Security Administrator — Governance and operations

- Maintain authoritative user-role and territory entitlements.
- Manage territory hierarchy and effective-dated assignments.
- Govern transfers, overlapping assignments, and temporary coverage.
- Configure catalog visibility separately from HCP-response access.
- Monitor data loads, freshness, and ingestion failures.
- Validate identifiers, joins, duplicates, and record grain.
- Detect unmatched questions and invalid parent relationships.
- Investigate catalog-versus-response metadata differences.
- Maintain metric definitions and data contracts.
- Govern question status, priority, effective dates, and approved use.
- Manage retention, corrections, and deletion processes.
- Audit record access and entitlement changes.
- Test authorization across search, AI retrieval, charts, caches, and exports.

## Shared features for every authorized persona

- Role-specific landing page.
- Record-level access enforcement.
- Consistent filters and visible access scope.
- Source citations and evidence drill-down.
- Clear counts, denominators, and date ranges.
- Data freshness and quality indicators.
- Accessible, responsive dashboards.
- Explicit empty/error states.
- Clear separation between source facts, AI summaries, and suggestions.

> **Guardrails:** No autonomous CRM submissions, invented HCP views, or clinical recommendations.
> Several features require additional systems or approved policies; the four CSVs alone do not supply appointments, user entitlements, or confirmed follow-up actions.

---

## Detailed feature matrix and implementation guidance

Below is a **persona-by-persona feature matrix**, with the suggested visualization, source tables, columns, and proposed data types on the **same row**.

**Status:** these are proposed features—not all are build-ready.
Roster identity links, territory coverage, HCP identity matching, and access policies still need resolution.

### Source-table and type legend

| Alias | Source |
| --- | --- |
| CA | `Call Activity.csv` |
| HI | `HCPRawInsights 12.csv` |
| QT | `Question tag 1.csv` |
| TA | `Territory - RD access.csv` |
| R | `Complete pasted roster` |
| NEW | Application tables or additional data sources that must be created/connected |

**Proposed normalized PostgreSQL types:**
`T` = `TEXT`; `D` = `DATE`; `TS` = timestamp with confirmed timezone semantics; `B` = `BOOLEAN`; `I` = integer quantity; `J` = `JSONB`.

For DynamoDB: `T`/`D`/`TS` → String, `B` → Boolean, `I` → Number, structured `J` content → Map/List.
Missing values remain null. IDs stay text.

### 1. MSL — Field workspace

| Feature | Dashboard / visualization / metric guidance | Tables and columns with types |
| --- | --- | --- |
| My territory landing page | KPI cards: distinct calls, distinct engaged HCPs, response count; show date range and freshness | CA: `crm_call_id:T`, `cust_mdm_id:T`, `call_dt:D`, `territory_id:T`; HI: `uniq_rspns_id:T`, `date_of_interaction:D`, `territory_id:T`; R: `email_id:T`, `territory_id:T` |
| Authorized HCP search | Searchable list with institution and territory; enforce access before returning results | CA: `cust_mdm_id:T`, `cust_full_nm:T`, `npi_id:T`, `territory_id:T`; HI: `cust_mdm_id:T`, `cust_nm:T`, `hcp_institution:T`; NEW: canonical entity/identifier crosswalk |
| HCP profile | Profile card: identity, specialty, institution, credentials, territory; distinguish missing fields | HI: `hcp_speciality:T`, `hcp_discipline:T`, `hcp_type:T`, `hcp_institution:T`; CA: `cust_cdtl:T`, `cust_sub_typ:T`, `territory_name:T` |
| Pre-call brief — priority | Brief panel: previous engagement, recorded perspectives, possible follow-ups, cited discussion prompts | CA: `call_dt:D`, `reason_for_visit:T`, `derived_disease_state:T`, `prd_nm:T`; HI: `qstn_txt:T`, `rspns_txt:T`, `date_of_interaction:D`; QT: `qstn_ext_id:T`, `qstn_pid:T`, `qstn_txt:T`; NEW: brief/evidence tables |
| Previous interactions | Chronological timeline; consolidate repeated call-product rows into an interaction display | CA: `crm_call_id:T`, `call_dt:D`, `call_chnl:T`, `call_type:T`, `call_sta:T`, `rep_nm:T`, `prd_nm:T` |
| Recorded HCP perspectives | Expandable response cards showing original question, answer, date, and source | HI: `qstn_ext_id:T`, `qstn_txt:T`, `rspns_txt:T`, `derived_rspns_text:T`, `date_of_interaction:D`, `uniq_rspns_id:T` |
| Parent-question context | Nested parent/child question display; do not attach answers across unrelated interactions | QT: `qstn_ext_id:T`, `qstn_pid:T`, `qstn_txt:T`; HI: `insight_intrctn_dtl_sfdc_id:T`, `cust_mdm_id:T`, `qstn_ext_id:T`, `rspns_txt:T` |
| Relevant question discovery | Filterable question cards by topic, molecule, tumor, study, survey; show applicability/status | QT: `molecule_type:T`, `tumor_type:T`, `study_name:T`, `survey_type:T`, `report_tag:T`, `qstn_type:T`, `qstn_tag_status:T`, `qstn_tag_strt_dt:TS`, `qstn_tag_end_dt:TS` |
| Call objective and agenda | Editable objective plus suggested agenda; clearly label generated prompts | NEW `interaction_plans`: `id:T`, `entity_id:T`, `owner_user_id:T`, `planned_at:TS`, `objective:T`, `agenda:J` |
| Potential follow-up topics | Evidence-backed list; never display inferred prompts as confirmed commitments | HI: `follow_up_qstn_tag:T`, `followup_qid:T`, `followup_qstn:T`, `followup_rspns:T`; QT: `qstn_pid:T`, `follow_up_qstn_tag:T` |
| Natural-language search | Chat/search panel with date/scope chips and source citations; calculate numeric answers deterministically | CA/HI/QT fields above; NEW `conversations`, `conversation_messages`: `id:T`, `user_id:T`, `content:T`, `created_at:TS` |
| Insight filtering | Shared filter bar with date, territory, molecule, landscape, study, survey, question | HI: `date_of_interaction:D`, `territory_id:T`, `molecule_type:T`, `landscape_type:T`, `study_name:T`, `survey_type:T`, `qstn_ext_id:T` |
| Response distributions | Horizontal bars showing count and percentage; state denominator; do not group unrelated questions | HI: `qstn_ext_id:T`, `rspns_txt:T`, `uniq_rspns_id:T`, `cust_mdm_id:T`; QT: `qstn_type:T` |
| Qualitative themes | Ranked theme cards with response count and supporting excerpts; themes are derived, not existing columns | HI: `rspns_txt:T`, `derived_rspns_text:T`, `qstn_ext_id:T`; NEW `generated_artifacts`: `content:T`, `metadata:J`; `artifact_evidence`: source links |
| Perspective changes over time | Dated comparison or timeline; compare compatible questions, preserve original answers | HI: `cust_mdm_id:T`, `qstn_ext_id:T`, `date_of_interaction:D`, `rspns_txt:T`; QT: question metadata/version rules |
| Personal activity trends | Monthly line/bar charts: distinct calls, distinct HCPs, channel mix; no implied performance score | CA: `crm_call_id:T`, `call_dt:D`, `crm_call_user_id:T`, `cust_mdm_id:T`, `call_chnl:T`; R: `vva_user_id:T` |
| Source freshness and evidence | "Data through" badge plus clickable evidence drawer; distinguish interaction date from load date | CA/HI/QT: `sys_inserted_datetime:TS`; HI: `uniq_rspns_id:T`; NEW `ingestion_runs`, `source_record_links` |
| Brief export | Printable/PDF [restored] brief with scope, dates, citations, and generation time; recheck access [restored] at export | NEW `generated_artifacts`: `id:T`, `owner_user_id:T`, `content:T`, `created_at:TS`; `artifact_evidence` |
| Saved views/reports | Saved filter presets and report list | NEW `saved_views`: `id:T`, `user_id:T`, `name:T`, `filters:J`, `created_at:TS` |
| Corrections and feedback | "Flag issue" on records/summaries; show review status | NEW `user_feedback`: `id:T`, `user_id:T`, `target_id:T`, `category:T`, `comment:T`, `status:T`, `created_at:TS` |
| Post-call draft — optional | Editable structured draft; user confirms before submission | NEW `interaction_drafts`: `id:T`, `author_user_id:T`, `notes:T`, `structured_content:J`, `status:T` |
| Confirmed follow-up tasks — optional | Task list/Kanban with owner, due date, status; separate from suggestions | NEW `tasks`: `id:T`, `entity_id:T`, `owner_user_id:T`, `description:T`, `due_at:TS`, `status:T` |
| Topic alerts — optional | Notification cards with threshold, period, counts, and evidence | HI topic/response fields; NEW `alert_rules`: `filters:J`, `threshold:I`; `alert_events`: `created_at:TS`, `evidence:J` |

### 2. Director — Team and territory oversight

| Feature | Dashboard / visualization / metric guidance | Tables and columns with types |
| --- | --- | --- |
| Team/territory overview | KPI cards and territory table; only approved descendant scopes | CA: `territory_id:T`, `crm_call_id:T`, `call_dt:D`; HI: `territory_id:T`, `uniq_rspns_id:T`; TA: `child_territory_id:T`, `parent_territory_id:T`; NEW leadership entitlements |
| Activity by team member | Grouped bars or member-by-month heatmap; show distinct calls and reporting completeness | CA: `crm_call_user_id:T`, `rep_nm:T`, `crm_call_id:T`, `call_dt:D`; R: `vva_user_id:T`, `full_name:T`, `team_nm:T` |
| Channel/topic/product mix | Ranked bars and time trends; label multi-product counts separately from distinct calls | CA: `call_chnl:T`, `reason_for_visit:T`, `derived_disease_state:T`, `crm_prd_id:T`, `prd_nm:T`, `crm_call_id:T` |
| Engagement and coverage | Distinct engaged-HCP counts; percentage coverage only with an authoritative target population | CA/HI: `cust_mdm_id:T`, `territory_id:T`; NEW `target_assignments`: `entity_id:T`, `scope_id:T`, `effective_from:TS`, `effective_to:TS` |
| Territory comparisons | Side-by-side bars with identical periods and definitions; disclose unequal population/reporting | CA/HI: date, territory, customer and record IDs; TA: hierarchy fields |
| Insight themes | Topic-by-territory heatmap and evidence-backed theme cards | HI: `molecule_type:T`, `landscape_type:T`, `study_name:T`, `survey_type:T`, `rspns_txt:T`; QT: `report_tag:T`, `tumor_type:T` |
| Question-level analytics | Question selector, response bars, distinct-HCP/response counts, parent context | HI: `qstn_ext_id:T`, `rspns_txt:T`, `cust_mdm_id:T`, `uniq_rspns_id:T`; QT: `qstn_pid:T`, `qstn_type:T` |
| Emerging-topic monitoring | Period-over-period trend with sample size and explicit threshold; not causal conclusions | HI: `date_of_interaction:D`, topic fields, `rspns_txt:T`; NEW derived classifications and alert tables |
| Follow-up oversight | Potential-topic list; confirmed-task aging chart only after task data exists | HI follow-up fields; NEW `tasks`: `owner_user_id:T`, `due_at:TS`, `status:T` |
| Evidence drill-down | Region → territory → authorized HCP → interaction/response detail | TA hierarchy; CA/HI entity, territory, interaction and response IDs; NEW access assignments |
| Reporting/data-quality exceptions | Exception table with missing joins, stale loads, unresolved identities | NEW `data_quality_issues`: `category:T`, `source_id:T`, `status:T`; `ingestion_runs`: `completed_at:TS`, `status:T` |
| Reports and natural-language analysis | Scoped report builder/chat with citations and approved exports | CA/HI/QT/TA/R; NEW saved views, generated artifacts, evidence, conversations |

### 3. Executive — Regional and enterprise oversight

| Feature | Dashboard / visualization / metric guidance | Tables and columns with types |
| --- | --- | --- |
| Authorized regional overview | Aggregate KPI cards; never infer executive authority from roster labels | TA: `child_territory_id:T`, `parent_territory_id:T`, `rls_region_name:T`; R: `region_name:T`; NEW executive scope assignments |
| Enterprise activity trends | Monthly distinct-call and response trends with freshness/completeness indicators | CA: `crm_call_id:T`, `call_dt:D`; HI: `uniq_rspns_id:T`, `date_of_interaction:D` |
| Regional comparisons | Ranked/grouped bars; consistent population, periods, and definitions | CA/HI: `territory_id:T`, dates and IDs; TA hierarchy; NEW governed metric definitions |
| Portfolio/topic/initiative themes | Ranked bars and theme cards by offering/topic/study; cite underlying responses | CA: `prd_nm:T`; HI/QT: `molecule_type:T`, `study_name:T`, `survey_type:T`; HI: `landscape_type:T`, `rspns_txt:T`; QT: `tumor_type:T` |
| Cross-region emerging topics | Topic-by-region matrix with trend arrows, counts, and approved alert thresholds | HI: territory, date, topic and response fields; TA region mapping; NEW derived classifications |
| Aggregate engagement patterns | Distinct-HCP trends and distributions; coverage denominator requires target data | CA/HI: `cust_mdm_id:T`, `territory_id:T`, dates; NEW canonical entity crosswalk/target assignments |
| Aggregate-only access | Suppress identifiable records and apply approved small-group disclosure rules | NEW permissions, scope assignments, aggregate-view policy; source records stay access-controlled |
| Evidence drill-down | Controlled drill-down only for executives with explicit record-level permission | CA/HI source IDs and scope fields; NEW role/permission and record-scope tables |
| Leadership summaries and exports | Source-linked executive briefing with date range and metric definitions | NEW `generated_artifacts`, `artifact_evidence`, `saved_views`; authorized CA/HI/QT aggregates |
| Natural-language organizational analysis | Scoped analytical chat; explain sample limitations and return cited evidence | Authorized source tables; NEW conversations and evidence links |

### 4. Data / Security Administrator

| Feature | Dashboard / visualization / metric guidance | Tables and columns with types |
| --- | --- | --- |
| Login-to-roster mapping | Identity reconciliation table; flag missing or conflicting matches | R: `email_id:T`, `vva_user_id:T`, `sfdc_submitter_id:T`; NEW `users`: `id:T`, `identity_subject:T` |
| Role and permission management | Role/permission matrix with explicit grants | NEW `roles`, `permissions`, `role_permissions`, `user_role_assignments`: IDs T, validity timestamps TS |
| Territory assignments | Assignment table with effective dates and unresolved territories | R: `territory_id:T`, `roster_member_territory_id:T`; NEW normalized assignments: `effective_from:TS`, `effective_to:TS` |
| Hierarchy management | Territory graph/tree; validate missing links, cycles, overlaps, and inheritance | TA: `child_territory_id:T`, `parent_territory_id:T`, `rls_region_name:T`; NEW versioned `scope_relationships` |
| Transfers and temporary coverage | Effective-dated access timeline with approval trail | NEW `user_scope_assignments`: `user_id:T`, `scope_id:T`, `effective_from:TS`, `effective_to:TS`, `assignment_type:T` |
| Catalog visibility governance | Separate catalog-access [restored] matrix from response-access matrix | QT catalog IDs/status; NEW permissions and scope policies |
| Ingestion/freshness monitoring | Pipeline status table and load timeline; failed loads visibly marked | NEW `data_sources`, `ingestion_runs`: `source_id:T`, `started_at:TS`, `completed_at:TS`, `status:T`, `row_count:I` |
| Identity/join/duplicate validation | Quality dashboard with matched/unmatched counts and record-level issues | CA: `crm_call_user_id:T`, `cust_mdm_id:T`; HI: `insight_submitter_info:T`, `cust_mdm_id:T`; R source IDs; NEW crosswalk/issues |
| Question dependency validation | Parent-question graph and exceptions for missing parents/duplicate keys/cycles | QT: `qstn_ext_id:T`, `qstn_pid:T`, `qstn_txt:T` |
| Status/version reconciliation | Side-by-side metadata comparison; preserve both values and provenance | HI/QT: `qstn_tag_status:T`; QT: `src_updt_dt:TS`, `dbt_valid_from:TS`, `dbt_valid_to:TS` |
| Question and metric governance | Versioned definition catalog with owner, status and approval—not inferred from source ownership | QT taxonomy/priority/status fields; NEW `metric_definitions`, approvals and governance tables |
| Retention/corrections/deletion | Policy and request queues with audit history | QT: `src_delete_flag:B`; NEW retention policies, correction/deletion requests, audit events |
| Access audit | Searchable audit table: actor, action, resource, time, outcome | NEW `audit_events`: `user_id:T`, `action:T`, `resource_id:T`, `occurred_at:TS`, `outcome:T` |
| Authorization verification | Test-result matrix for roles/scopes across API, chat, exports, caches and drill-down | NEW test fixtures/results; application access-control tables |

## Rules for every dashboard

1. **Count distinct calls—not raw CA rows.** Confirm the appropriate distinct key and handling of parent/attendee calls.
2. **Define insight metrics explicitly.** `uniq_rspns_id` is a candidate response key; validate uniqueness and exclusions before using it.
3. **Never confuse questions, responses, interactions, and HCPs.**
4. **Show counts, denominators, timeframes, and data freshness.**
5. **Prefer bars for category comparisons, lines for time trends, timelines for history, and tables for exceptions.**
6. **Apply record authorization before charts, AI retrieval, summaries, or exports.**
7. **Do not treat roster time-only values as usable dates.** Obtain complete source timestamps before determining active assignments.
8. **Preserve current versus historical question metadata.** The verified 4,400 status differences require approved reconciliation rules.
9. **Require approved mappings before combining records.** Similar names, emails, or labels alone are not sufficient.
10. **Clearly label optional features and missing inputs.** Upcoming appointments, confirmed tasks, approved materials, and application roles are not supplied by the existing five datasets.

## AI implementation guidance

**Yes, but only partly.** The matrix explicitly includes chatbot search and analysis, while several other features use AI behind the scenes.
That distinction should be clearer.

### Where AI would be used

| Persona | Feature | AI's role | Interface |
| --- | --- | --- | --- |
| MSL | Pre-call preparation | Summarize authorized interaction history and recorded perspectives; suggest cited discussion prompts | **"Generate brief" button + chatbot follow-ups** |
| MSL | Insight search | Find relevant responses and answer questions with citations | **AI chatbot** |
| MSL | Parent-question interpretation | Explain a response using its parent-question context; relationships are resolved by code | Response detail / chatbot |
| MSL | Qualitative themes | Classify and summarize free-text feedback with supporting evidence | Dashboard theme cards |
| MSL | Agenda planning | Draft an agenda from the objective and relevant history | Editable planning panel |
| MSL | Post-call drafting — optional | Structure user-entered notes without inventing observations | Editable draft |
| Director | Team/territory questions | Explain trends and summarize authorized feedback | **AI chatbot** |
| Director | Territory summaries | Generate evidence-backed summaries of themes and changes | Dashboard summary panel |
| Director | Emerging topics | Classify text into topics; deterministic code evaluates alert thresholds | Alerts / topic dashboard |
| Executive | Organizational questions | Answer questions within approved regional or enterprise scope | **AI chatbot** |
| Executive | Leadership briefing | Summarize verified metrics and recorded themes | Briefing panel / export |
| Administrator | Quality investigation — optional | Explain detected inconsistencies and suggest investigation steps | Issue assistant; **no autonomous fixes or access grants** |

### What should not depend on AI

- Authentication, roles, RLS, and permission decisions.
- Identity joins and territory hierarchy resolution.
- Counts, percentages, chart calculations, and alert thresholds.
- Source-date parsing and active-assignment determination.
- Task confirmation, record submission, and access changes.

**Recommended flow:**
**User request → enforce access → retrieve records/calculate metrics → AI summarizes → show citations and visualizations.**

The chatbot is one entry point.
AI-generated briefs, theme cards, and summaries can also appear directly in dashboards without opening chat.

## Source data dictionary

You currently have **five supplied datasets with 166 columns total**.
Below are their **exact column names in source order**, with recommended PostgreSQL types.

**Important:** CSV/pasted text does not declare database types.
These are inferred/recommended types—not a verified upstream database schema.

### Type mapping

PostgreSQL `TEXT` maps to DynamoDB String (S); `BIGINT` to Number (N); `BOOLEAN` to Boolean (BOOL) after flag normalization; `DATE` and `TIMESTAMP` to ISO-formatted String (S), with source timezone unresolved for `TIMESTAMP`; and `TIMESTAMPTZ` to an ISO-formatted String (S) with offset.

Keep identifiers as text, including numeric-looking IDs and postal codes.
Blank values remain null.

### 1. `Call Activity.csv` — 48 columns

**Columns and recommended types (source order):**
`atnde_type` — TEXT; `addr` — TEXT; `call_chnl` — TEXT; `call_dt` — DATE; `crm_call_id` — TEXT;
`clm_flag` — BOOLEAN; `call_type` — TEXT; `call_dur` — BIGINT; `exs_inac_call_flag` — BOOLEAN; `exs_jnt_msl_sls_call_flag` — BOOLEAN;
`jnt_smad_vist` — BOOLEAN; `exs_lb_flag` — BIGINT (provisional coded-field interpretation); `exs_lgcy_call_atnde_id` — TEXT (provisional; entirely blank);
`exs_lgcy_call_id` — TEXT;
`exs_mtg_type` — TEXT; `exs_non_npi_cust_id` [restored] — TEXT; `exs_snacks` — BOOLEAN; `exs_type_of_vist` — TEXT; `is_par_call_flag` — BOOLEAN;
`is_smpld_call_flag` — BOOLEAN; `par_call_id` — TEXT; `call_sta` — TEXT; `cust_src_id` — TEXT; `crm_med_disc_id` — TEXT;
`derived_disease_state` — TEXT; `reason_for_visit` — TEXT; `crm_prd_id` — TEXT; `prd_nm` — TEXT; `territory_id` — TEXT;
`territory_name` — TEXT; `team_nm` — TEXT; `crm_call_user_id` — TEXT; `rep_nm` — TEXT; `rep_email_id` — TEXT;
`cust_mdm_id` — TEXT; `cust_full_nm` — TEXT; `cust_sub_typ` — TEXT; `cust_cdtl` — TEXT; `npi_id` — TEXT;
`addr_ln_1` — TEXT; `city` — TEXT; `st_cd` — TEXT; `pstl_cd` — TEXT; `mdm_corp_prnt_id` — TEXT;
`mdm_corp_prnt_nm` — TEXT; `hq_corp_prnt_id` — TEXT; `hq_corp_prnt_nm` — TEXT; `sys_inserted_datetime` — TIMESTAMPTZ.

**Notes:** Boolean fields require conversion from their source representations.
Confirm the duration unit and the meaning of `exs_lb_flag`.
`crm_call_id` repeats, so do not assume it is a unique row primary key.

### 2. `HCPRawInsights 12.csv` — 59 columns

**Columns and recommended types (source order):**
`insight_intrctn_dtl_sfdc_id` — TEXT; `response_id` — TEXT; `insight_submitter_info` — TEXT; `submitter_name` — TEXT; `submitter_email` — TEXT;
`date_of_interaction` — DATE; `clinical_trial` — TEXT; `type_of_visit` — TEXT; `meeting_format` — TEXT; `insight_region` — TEXT;
`src_created_dt` — TIMESTAMP (timezone unresolved); `region_nm` — TEXT; `insight_country` — TEXT; `country_nm` — TEXT; `insight_msl_territory` — TEXT;
`territory_id` — TEXT; `territory_name` — TEXT; `parent_territory_id` — TEXT; `parent_territory_name` — TEXT; `team_nm` — TEXT;
`cust_mdm_id` — TEXT; `cust_nm` — TEXT; `hcp_speciality` — TEXT; `hcp_institution` — TEXT; `hcp_discipline` — TEXT;
`hcp_type` — TEXT; `internal_meeting_attendees` — TEXT; `insight_name` — TEXT; `insight_clinicaltrial_site` — TEXT; `site_nm` — TEXT;
`insight_intrctn_rspns_sfdc_id` — TEXT; `qstn_txt` — TEXT; `rspns_txt` — TEXT; `qstn_ext_id` — TEXT; `qstn_tag_strt_dt` — TIMESTAMP (timezone unresolved);
`qstn_tag_end_dt` — TIMESTAMP (timezone unresolved); `qstn_tag_status` — TEXT; `tag_nm` — TEXT; `pid` — TEXT (provisional; entirely blank);
`priority_tag` — TEXT; `qstn_pid` — TEXT; `qstn_type` — TEXT; `molecule_type` — TEXT; `landscape_type` — TEXT;
`survey_type` — TEXT; `qstn_indicator` — TEXT; `study_name` — TEXT; `derived_rspns_text` — TEXT; `follow_up_qstn_tag` — TEXT;
`followup_qid` — TEXT; `followup_qstn` — TEXT; `followup_rspns` — TEXT; `uniq_rspns_id` — TEXT; `sys_inserted_datetime` — TIMESTAMPTZ;
`mdm_corp_prnt_id` — TEXT; `mdm_corp_prnt_nm` — TEXT; `hq_corp_prnt_id` — TEXT; `hq_corp_prnt_nm` — TEXT; `excluded_rspns_flag` — BOOLEAN.

**Notes:** Response fields stay text because they contain free text, yes/no answers, and numeric-looking values.
`qstn_type` does not establish the physical response datatype.
Validate `uniq_rspns_id` before declaring it a primary key.

### 3. `Question tag 1.csv` — 33 columns

**Columns and recommended types (source order):**
`qstn_tag_sfdc_id` — TEXT; `qstn_tag_nm` — TEXT; `src_created_dt` — TIMESTAMP (timezone unresolved);
`src_created_by` — TEXT; `src_updt_dt` — TIMESTAMP (timezone unresolved);
`src_updt_by` — TEXT; `src_delete_flag` — BOOLEAN; `ownerid` — TEXT; `insight_nm` — TEXT; `qstn_txt` — TEXT;
`qstn_tag_strt_dt` — TIMESTAMP (timezone unresolved); `qstn_tag_end_dt` — TIMESTAMP (timezone unresolved); `qstn_tag_status` — TEXT; `tag_nm` — TEXT; `pid` — TEXT (provisional; entirely blank);
`priority_tag` — TEXT; `qstn_ext_id` — TEXT; `qstn_pid` — TEXT; `qstn_type` — TEXT;
`report_tag` — TEXT; `molecule_type` — TEXT; `tumor_type` — TEXT; `survey_type` — TEXT; `qstn_indicator` — TEXT;
`study_name` — TEXT; `follow_up_qstn_tag` — TEXT; `sys_inserted_datetime` — TIMESTAMPTZ; `batch_id` — TEXT; `source_name` — TEXT;
`dbt_scd_id` — TEXT; `dbt_updated_at` — TIMESTAMP (timezone unresolved); `dbt_valid_from` — TIMESTAMP (timezone unresolved); `dbt_valid_to` — TIMESTAMP (provisional; entirely blank).

**Notes:** `qstn_ext_id` is unique in this sample [restored], and all supplied insight rows match it.
Parent references use `qstn_pid` → parent `qstn_ext_id`.
Future versioned loads may require a composite/version-aware key.

### 4. `Territory - RD access.csv` — 4 columns

**Columns and recommended types (source order):**
`child_territory_id` — TEXT; `child_territory_name` — TEXT; `parent_territory_id` — TEXT; `rls_region_name` — TEXT.

**Note:** One child can have multiple parent mappings.
Do not assume `child_territory_id` alone is a primary key.
This table describes scope relationships—not user permissions.

### 5. `Medical roster - complete pasted data` — 22 columns

For damaged/time-only date representations, the **current ingestion type should remain TEXT** until a complete export is obtained.

**Columns and recommended types (source order):**
`first_name` — TEXT; `last_name` — TEXT; `full_name` — TEXT; `email_id` — TEXT; `sfdc_territory_id` — TEXT;
`territory_id` — TEXT; `territory_name` — TEXT; `region_name` — TEXT; `start_date` — TEXT (now; target DATE/TIMESTAMP after source confirmation);
`end_date` — TEXT (now; target DATE/TIMESTAMP after source confirmation); `roster_member_territory_id` — TEXT; `vva_user_id` — TEXT; `profile_nm` — TEXT (entirely blank);
`sfdc_submitter_id` — TEXT; `sys_inserted_datetime` — TEXT (now; target TIMESTAMPTZ after complete timestamp/timezone confirmation); `batch_id` — TEXT (exact source ID must be recovered from scientific-notation display); `source_name` — TEXT;
`dbt_scd_id` — TEXT; `dbt_updated_at` — TEXT (now; target timestamp after source confirmation); `dbt_valid_from` — TEXT (now; target timestamp after source confirmation);
`dbt_valid_to` — TEXT (in raw landing; provisional target timestamp, currently entirely blank); `team_nm` — TEXT.

**Bottom line:** these are your existing five source schemas.
There are **no embedding/vector columns, explicit application roles, manager IDs, appointments, or confirmed-task columns** in them.
Those would require separate application tables or additional sources.
