-- Director insights (ticket 11, #12).
--
-- Everything a threshold or a theme depends on lives in the database as deterministic SQL, so the BE API
-- Lambda (dashboard) and the agent (chat, generated summaries) cannot disagree and nothing AI-shaped can
-- move a number. These functions use invoker rights: Row-level security still decides which rows a caller
-- reads, exactly as for any other query (docs/adr/0003).
--
-- 1. app.theme_of(text): the transparent keyword baseline that groups a free-text response into one derived
--    theme. First match wins and the three planted emerging topics come first. It is a derived grouping,
--    shown as derived everywhere, never a source fact.
-- 2. app.emerging_thresholds() / app.emerging_status(...): the explicit emerging-topic rule. Comparing two
--    equal-length windows, a topic is judged on its SHARE of free-text responses so a busier period cannot
--    manufacture a trend, and only when both windows have enough responses to say anything.
-- 3. app.source_load_status(): the latest load per source for people who may see the team overview.
--    ingestion_runs is administrator-only under RLS, so this narrow SECURITY DEFINER function returns only
--    source name, state and timestamps (never row counts or error text) to callers holding
--    team.overview.read or admin.manage.

CREATE OR REPLACE FUNCTION app.theme_of(response text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN r ~ '(ctdna|liquid biopsy|\ymrd\y|circulating tumor|cell-free)' THEN 'ctDNA monitoring (emerging)'
    WHEN r ~ '(\yild\y|pneumonitis|interstitial|pulmonolog|ct schedule|pulmonary)' THEN 'Pulmonary surveillance (emerging)'
    WHEN r ~ '(neoadjuvant|adjuvant|early-stage|early stage|perioperative|curative)' THEN 'Earlier-stage use (emerging)'
    WHEN r ~ '(prior auth|payer|reimburs|denial|denied|copay|coverage|appeal|insurance|formulary|authoriz|approval|340b|buy-and-bill|infusion chair)' THEN 'Access and reimbursement'
    WHEN r ~ '(biomarker|testing|\yngs\y|\yihc\y|pd-l1|turnaround|assay|reflex|her2-low|trop2|tissue|biops)' THEN 'Biomarker testing'
    WHEN r ~ '(guideline|nccn|esmo|\yasco\y|pathway|compendi)' THEN 'Guidelines and pathways'
    WHEN r ~ '(crossover|comparator|endpoint|subgroup|trial design|powered|enrol|eligibility|randomi|head-to-head)' THEN 'Trial design and evidence gaps'
    WHEN r ~ '(tolerab|toxicit|adverse|nausea|neutropenia|diarrhea|rash|dose reduc|discontinu|side effect|safety|\ytox|cytopeni|irae|antiemetic)' THEN 'Safety and tolerability'
    WHEN r ~ '(sequenc|after progression|second.line|first.line|third.line|switch)' THEN 'Treatment sequencing'
    WHEN r ~ '(compet|alternative|compared|versus|\yvs\y|colleagues)' THEN 'Competitor comparisons'
    WHEN r ~ '(candidate|performance status|ecog|frail|elderly|comorbid|brain met|patient selection|which patients)' THEN 'Patient selection'
    WHEN r ~ '(unmet|resistance|few options|limited options|quality of life|\yqol\y)' THEN 'Unmet need'
    WHEN r ~ '(response|durab|\ypfs\y|survival|efficacy|benefit|remission|\yos\y|mature|f/u|outcome|results impress)' THEN 'Efficacy and durability'
    ELSE 'Other perspectives' END
  FROM (SELECT lower(response) AS r) s
$$;

-- The rule, stated once. Both windows must hold at least min_window_responses free-text responses; a topic is
-- EMERGING when it has at least min_topic_responses now, its share of responses rose by at least
-- min_share_points percentage points, and that share is at least (1 + min_relative_increase) times the prior
-- share (or the topic had none before). DECLINING mirrors it. Everything else is STABLE.
CREATE OR REPLACE FUNCTION app.emerging_thresholds()
RETURNS TABLE(min_window_responses integer, min_topic_responses integer, min_relative_increase numeric, min_share_points numeric)
LANGUAGE sql IMMUTABLE AS $$ SELECT 30, 10, 0.5::numeric, 2.0::numeric $$;

CREATE OR REPLACE FUNCTION app.emerging_status(current_n bigint, prior_n bigint, current_total bigint, prior_total bigint)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN current_total < t.min_window_responses OR prior_total < t.min_window_responses THEN 'INSUFFICIENT_SAMPLE'
    WHEN current_n >= t.min_topic_responses
         AND 100.0 * current_n / current_total - 100.0 * prior_n / prior_total >= t.min_share_points
         AND (prior_n = 0 OR current_n::numeric / current_total >= (prior_n::numeric / prior_total) * (1 + t.min_relative_increase))
      THEN 'EMERGING'
    WHEN prior_n >= t.min_topic_responses
         AND 100.0 * prior_n / prior_total - 100.0 * current_n / current_total >= t.min_share_points
         AND current_n::numeric / current_total <= (prior_n::numeric / prior_total) * (1 - t.min_relative_increase)
      THEN 'DECLINING'
    ELSE 'STABLE' END
  FROM app.emerging_thresholds() t
$$;

CREATE OR REPLACE FUNCTION app.source_load_status()
RETURNS TABLE(source_id text, source_name text, last_status text, last_attempt_at timestamptz,
              last_completed_at timestamptz, load_state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT s.source_id, s.source_name, l.status, l.started_at, c.completed_at,
         CASE WHEN l.status = 'failed' THEN 'failed'
              WHEN c.completed_at IS NULL THEN 'never_loaded'
              WHEN c.completed_at < now() - interval '30 days' THEN 'stale'
              ELSE 'current' END
  FROM data_sources s
  LEFT JOIN LATERAL (SELECT r.status, r.started_at FROM ingestion_runs r WHERE r.source_id = s.source_id
                     ORDER BY r.started_at DESC LIMIT 1) l ON true
  LEFT JOIN LATERAL (SELECT r.completed_at FROM ingestion_runs r WHERE r.source_id = s.source_id AND r.status = 'completed'
                     ORDER BY r.completed_at DESC LIMIT 1) c ON true
  WHERE app.has_permission('team.overview.read') OR app.has_permission('admin.manage')
  ORDER BY s.source_id
$$;

REVOKE ALL ON FUNCTION app.source_load_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.theme_of(text), app.emerging_thresholds(), app.emerging_status(bigint, bigint, bigint, bigint),
  app.source_load_status() TO app_user;
