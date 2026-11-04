# Pre-call briefs: evidence from RLS, prose from the agent, saved to FE DynamoDB, staleness computed on open

An MSL picks an authorized HCP, writes a call objective and taps Generate brief.
The request takes the approved route (ADR 0001): browser -> FE AppSync (`generateBrief`) -> BE API Lambda -> AgentCore agent -> Bedrock.

## Who does what

Deterministic code does everything that must not be generated, in the BE Lambda (`briefs.py`):

- **Access.** The HCP must be inside the caller's RLS scope. Absent and out-of-scope HCPs are refused identically (`Forbidden`). Aggregate-only personas are refused.
- **Evidence.** It reads the HCP's calls and recorded responses under RLS, consolidates call-product rows into distinct calls, resolves parent-question context inside one interaction only, and counts. A response is citable only when its `uniq_rspns_id` is present and unique; the rest are left out and reported under missing information.
- **Freshness.** It stamps the data-through date and a per-HCP source fingerprint, and lists missing information (no calls, no responses, no follow-up topics, missing specialty or institution, no interaction in six months, truncation).

The agent (`msl_agent/briefs.py`) only writes prose.
It receives the evidence in the invocation (it reads no database for a brief), may cite nothing else, and the code, not the model, enforces that:

- a statement, follow-up or discussion prompt without a valid citation is dropped, never shown (`droppedStatements` says how many);
- in Claude mode a statement containing a figure that is not in the evidence or the objective is dropped (numbers are computed, not generated; same rule as chat, ADR 0007);
- the model sees evidence text and the objective only, never identity, ids of scope or the HCP id;
- without a model (floci's stub backend) the same checks run over a draft written by code, labelled `stub`.

The agent then saves the finished brief itself with a narrow write tool (ADR 0005): a role in the FE account that can only `PutItem` on `a2g-precall-briefs`.
The Lambda reads the item back before answering, so the brief the user sees is exactly what was persisted, and a failed save fails the request.

## Shape

- Item key: partition `USER#<userId>`, sort `BRIEF#<briefId>` (`br-<UTC yyyymmddhhmmss>-<8 hex>`, so briefs sort by creation time). The user id comes from the verified identity.
- Attributes: owner, persona, HCP id, objective, scope label and territory ids, data-through date, generation time, source fingerprint, model mode, number check, dropped count, source facts, the three statement sections, prompts, agenda, missing information and the evidence list (evidence id, dataset, record id, label, date). Items expire after a year (retention policy proper is ticket #18).
- Every statement carries `evidenceIds`; each evidence entry opens through the existing `chatCitation(dataset, recordId)` query, which re-applies RLS.
- Prompts and agenda items are `GENERATED` or `USER`, with an `edited` flag. Edits (`saveBriefEdits`) go through the BE Lambda's own narrow role (`a2g-be-briefs`: `GetItem`, `Query`, `UpdateItem`; no create, replace, delete or scan). An edit can change text and add or remove items but can never change what an item cites, and a client cannot mint a "generated" item.
- The HCP name is not stored: it is read live through the profile check on every open.

## Reopening

`preCallBrief`, `myBriefs` and `saveBriefEdits` re-check access first.
After a territory reassignment, reopening or editing a brief for an HCP the caller no longer sees is `Forbidden`; the saved list still shows that brief, but as "No longer available" with no HCP, name or objective.
Another user's brief is `NotFound`, indistinguishable from an unknown id.

A brief is **stale** when either holds, and the badge reads "Newer data available - regenerate":

- `HCP_DATA_CHANGED`: the caller's current view of that HCP's records differs from the fingerprint saved with the brief (latest load time, distinct call count, response count);
- `NEWER_DATA_LOADED`: the caller's data-through date is later than the brief's.

Stale is a badge, not a denial: the old brief still opens with its original evidence.
Regenerating writes a new brief (`regeneratesBriefId` links it to the old one) and leaves the old one in the list.
Computing both reasons is deliberate. The first is precise to the HCP; the second is the literal rule in the requirements ("saved records carry data-through date and scope; on open, a stale badge offers regeneration"), so a data reload always surfaces, at the cost of badging briefs after any load.

## Consequences

- The API Lambda now calls the agent as well as the chat worker. AppSync cuts a resolver off at 30 seconds, so the Lambda's agent call gives up at 25 s. A live Sonnet brief takes about 8 s. If briefs ever outgrow that, move generation to the polled-run pattern of ADR 0007; the stored item and the UI need no change.
- floci's Bedrock proxy rejects `temperature` other than 1 for `claude-sonnet-5-5`, so the brief runner leaves it at the default.
- The BE CDK gives the API Lambda `InvokeAgentRuntime` and `sts:AssumeRole` on `a2g-be-briefs`, and the agent `sts:AssumeRole` on `a2g-agent-brief-writer`.
- The logging allowlist gained `brief_id`. Objectives, HCP names, recorded answers and statements are never logged.
