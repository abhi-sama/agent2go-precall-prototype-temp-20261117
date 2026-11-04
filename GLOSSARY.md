# MSL Agent

Field-insight workspace for a pharmaceutical medical-affairs organisation: Medical Science Liaisons prepare for and record scientific exchanges with healthcare professionals, and their leaders oversee the insight that results.
Every view is limited to what the viewer is entitled to see.

## People and roles

**HCP**:
A healthcare professional an MSL engages with, identified by a canonical HCP ID through the source identifier crosswalk (not by a display name).
_Avoid_: customer, doctor, physician, KOL

**MSL**:
A Medical Science Liaison: a field scientist who holds scientific exchanges with HCPs in an assigned territory.
_Avoid_: rep, sales rep

**Director**:
A leader who oversees the MSLs and territories beneath an approved part of the territory hierarchy.
_Avoid_: manager, RD

**Executive**:
A leader with explicitly granted regional or enterprise scope who normally sees aggregates, not individual records.
_Avoid_: VP, leadership user

**Administrator**:
A data or security administrator who governs entitlements, the territory hierarchy, data quality and AI behaviour.
_Avoid_: admin user, superuser

**Persona**:
Which of the four roles (MSL, Director, Executive, Administrator) a user acts as; a user has exactly one.
_Avoid_: role (when meaning the persona), user type

**User**:
A person signed in to the application, known by an application user id that is linked to their login by an approved mapping.
_Avoid_: account, login

**Login-to-user mapping**:
The approved link from a sign-in identity to a user; only a matched mapping grants any access.
_Avoid_: identity join, email match

## Territory and access

**Territory**:
The smallest geographic or organisational unit an MSL covers, identified by `territory_id`.
_Avoid_: area, patch

**Region**:
A grouping of territories, itself a node in the territory hierarchy.
_Avoid_: district, zone

**Territory hierarchy**:
The parent-child relationships between territories and regions; one territory may have several parents.
_Avoid_: org chart, tree (when overlaps exist)

**Scope assignment**:
An effective-dated grant of one territory or region to a user, typed as primary, temporary coverage, executive or administrative.
_Avoid_: entitlement row, territory assignment (roster sense)

**Scope change request**:
A transfer or temporary coverage asked for by one administrator and approved or rejected by a different one, with the reason kept; approving writes the effective-dated scope assignments.
_Avoid_: ticket, workflow

**Temporary coverage**:
A scope assignment of type temporary that always has an end date and stops on it by the clock.
_Avoid_: delegation, acting role

**Transfer**:
Moving a user's primary scope assignment from one territory to another at an effective date; the old assignment ends when the new one starts.
_Avoid_: reassignment

**Hierarchy finding**:
A problem the hierarchy validation reports: a cycle, an orphan territory, a missing link, an overlap (several parents) or an uncovered territory.
_Avoid_: hierarchy error

**Entitlement**:
Everything a user is authorized for at a moment: their persona's permissions plus their effective scope.
_Avoid_: access rights, ACL

**Territory map**:
The landing-page view that colours the viewer's own scope by distinct calls on real geography: a 3D globe with a marker per country (Executives), then a flat map of a country's states or territories, then one territory.
Every territory sits in one real US state or one real country.
_Avoid_: territory visual, heat map

**Scope**:
The set of territories a user's in-effect scope assignments cover, including descendants in the hierarchy.
_Avoid_: visibility, coverage (coverage means engaged HCPs over a target population)

**Effective dating**:
Validity bounded by `effective_from` and an optional `effective_to`; only rows in effect now grant anything.
_Avoid_: active flag

**Aggregate-only access**:
Permission to see counts and distributions with small-group suppression, without individual records.
_Avoid_: summary access

**Small-group suppression**:
Withholding any count between 1 and 4 from an aggregate-only view, and the next-smallest value in the same total, so no individual and no withheld value can be worked out. Withheld is never shown as zero.
_Avoid_: masking, redaction

**Executive scope**:
The territories an Executive is explicitly authorized for: in-effect scope assignments of type executive and their descendants. Never inferred from roster labels or from other assignment types.
_Avoid_: regional access

**Record-level permission**:
The explicit grant (`source.records.read`) that lets an Executive open the records behind an aggregate. Separate from aggregate access and from scope.
_Avoid_: drill-down right

**Catalog visibility**:
Permission to see catalog questions, granted separately from permission to see HCP responses; seeing a question never grants seeing its responses.

## Activity and insight

**Call**:
One recorded scientific exchange, identified by `crm_call_id`; the source repeats a call once per product discussed.
_Avoid_: visit, meeting, call row

**Call-product row**:
One source row of Call Activity: a call paired with one product. Never counted as a call.

**Interaction**:
The event an insight was recorded against (`insight_intrctn_dtl_sfdc_id`), dated by `date_of_interaction`.
_Avoid_: call (an interaction is the insight source's record, not the CRM call)

**Question**:
A catalog entry an MSL can ask about, identified by `qstn_ext_id`, tagged by molecule, tumor type, study and survey.
_Avoid_: tag, survey item

**Parent question**:
The question a follow-up question depends on, referenced by `qstn_pid`; a follow-up's answer is read in its parent's context and only within the same interaction.
_Avoid_: root question

**Follow-up question**:
A question asked only in the context of its parent question's answer.

**Response**:
An HCP's recorded answer to one question in one interaction, identified by `uniq_rspns_id` once that key is validated.
_Avoid_: answer row, insight (when meaning a single answer)

**Insight**:
The body of recorded HCP responses, as a source of understanding; not a single record.
_Avoid_: feedback

**Recorded perspective**:
What a response says an HCP holds, preserved as originally recorded.
_Avoid_: opinion, HCP view (an inferred view is forbidden)

**Theme**:
A derived grouping of responses by meaning, always shown as derived and backed by supporting responses.
_Avoid_: topic (when meaning a derived theme)

**Molecule**, **Tumor type**, **Study**, **Survey**, **Landscape**:
The scientific facets a question or response is tagged with (`molecule_type`, `tumor_type`, `study_name`, `survey_type`, `landscape_type`).

## Outputs and provenance

**Pre-call brief**:
A source-linked summary an MSL generates before a call: prior engagement, recorded perspectives and possible follow-ups, with cited discussion prompts.
_Avoid_: call plan, profile

**Stale brief**:
A saved pre-call brief whose source data changed since it was written: the HCP's records differ from the brief's fingerprint, or a newer data load arrived. It still opens, with a "Newer data available - regenerate" badge.
_Avoid_: expired brief, outdated brief

**Call objective**:
What the MSL wants from the next call, written by the MSL; the brief and its suggested agenda are generated from it.
_Avoid_: call plan

**Source fact**:
A value read directly from a source record and shown with its citation.

**AI summary**:
Generated text condensing source facts, always marked as generated and cited.
_Avoid_: insight (when meaning generated text)

**Suggestion**:
A generated proposal the user may act on, such as an agenda item; never a confirmed commitment.
_Avoid_: recommendation (clinical recommendations are forbidden)

**Evidence**:
The source records an output cites, open to drill-down.
_Avoid_: references

**Interaction date**:
When an exchange happened (`call_dt`, `date_of_interaction`). Shown beside, and never confused with, the load date.
_Avoid_: call time, activity date

**Load date**:
When a record reached this system (`sys_inserted_datetime`). It is usually after the interaction date.
_Avoid_: updated date, refresh date

**Flag**:
A user's report that a summary, an identifier or a territory assignment is wrong, with a review status of open, in review, resolved or dismissed.
_Avoid_: feedback, ticket, complaint

**Citation**:
A pointer from an answer to one source record (a call or a recorded response) that the viewer can open; it opens only if the viewer's scope covers the record.
_Avoid_: reference, footnote

**Coverage**:
Engaged target HCPs divided by the approved target population of a scope; withheld when no approved target population exists.
_Avoid_: reach, penetration, scope (scope means the territories a user may see)

**Reporting completeness**:
Months with at least one recorded call divided by the months in the period that data has reached, for a team member or a territory. It describes whether reporting happened, not how well anyone performed.
_Avoid_: compliance, attainment, score

**Data through**:
The latest load time all in-scope sources are loaded through; a load date, not an interaction date.
_Avoid_: last updated, as-of date

**Emerging topic**:
A derived theme whose share of free-text responses rose between two equal periods by more than an explicit, stated threshold (and enough responses exist in both).
It reports a change in what was recorded, never a cause.
_Avoid_: trend (when meaning the rule's verdict), alert (alerts are the MSL optional feature)

**Topic-by-region matrix**:
Themes (rows) by an Executive's explicitly granted regions (columns): count, share of the region's free-text responses, and a trend arrow judged by the approved threshold rule. Small groups are withheld; a region with too few responses gets no trend.
_Avoid_: heatmap (the Director's topic-by-territory view)

**Aggregate citation**:
The way an aggregate-only user's theme card or summary cites its source: the set of responses it rests on, named by theme, window and size, never a record. Record citations exist only with record-level permission.
_Avoid_: source record (a single response)

**Leadership summary**:
An Executive's AI-written, source-linked summary of a date range over their explicit scope, with key figures, metric definitions and sample limitations. Saved with its scope; access is re-checked on open and export.
_Avoid_: report

**Exception**:
A finding that a join, load, key or identity is missing or inconsistent inside the viewer's scope, detected by a fixed rule.
It describes data, never a person's conduct.
_Avoid_: error, violation

**Screen context**:
The territory, question, dates and view a chat was opened from; a default for the agent's tools and never extra access.
_Avoid_: scope (scope means the territories a user may see)

## Governance

**Ingestion run**:
One load of one source dataset, with its status, timing and row count.
_Avoid_: job, sync

**Data-quality issue**:
A detected defect in source data, such as a duplicate key, an orphan parent question, a status difference or an unresolved identity, tracked to resolution.
_Avoid_: bug, error

**Metric definition**:
The governed, versioned definition of a reported number, with owner and approval.
_Avoid_: KPI formula

## Evaluation

**Golden question**:
A fixed question with a known right behaviour, asked of the agent as a persona; quantitative ones have a count, share, direction or leader computed in SQL, leak probes ask for data the persona must not get.
_Avoid_: test prompt

**Question type**:
Which of seven kinds a golden question is (exact count, percentage, trend, comparison, qualitative theme, follow-up chain, leak probe); run scores are reported per type so one weak type is not hidden by the rest.
_Avoid_: question category, question class

**Follow-up chain**:
A golden conversation of 9 to 12 turns where each turn leans on the earlier ones ("and September?", "go back to my first question"); every turn is scored on its own and the chain is correct only if all of them are.
_Avoid_: thread, dialogue

**Ground truth**:
What a correct answer says, recounted from raw rows in hand-written SQL under the eval subject's own access, never taken from the agent's queries.
_Avoid_: expected output, fixture

**Eval subject**:
The one seeded user a persona's golden suite is asked as, so every answer is judged against a known scope.
_Avoid_: test user

**Evaluation run**:
One pass of a persona's suite with every answer scored, kept with its history; any leak fails it.
_Avoid_: test run

**Leak probe**:
A golden question that asks for out-of-scope data; retrieving any of it fails the run.
_Avoid_: attack

**Detector self-test**:
A run of the leak probes against a deliberately leaky stand-in, proving the detector fails a leaking run.
_Avoid_: canary test

**Human rating**:
A person's thumb and optional note on one live answer, shown beside that answer's automated scores.
_Avoid_: feedback flag (a flag reports an incorrect record; a rating judges an answer)

