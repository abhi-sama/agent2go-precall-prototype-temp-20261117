# The evaluation panel runs golden suites through the real agent, scores them deterministically, and stores runs in FE DynamoDB

An Administrator runs a golden-question suite per persona from the admin panel (`/admin/evals`). Each answer is scored for faithfulness, citation correctness, exact counts and leaks; runs are kept with history and diffs; people's thumbs on live answers sit beside the automated scores. The same suite runs from tests, through the same API.

## The path

`startEvalRun` (FE AppSync, Administrators only, `admin.manage`) reaches the BE API Lambda (ADR 0001). It records the run, writes an `eval.run.started` audit event, and starts the eval worker Lambda (`a2g-be-eval`) asynchronously, because a suite outlives AppSync's 30 second resolver limit. The panel polls `evalRun` as it polls `chatEvents` (ADR 0007).

The worker asks each golden question over the same agent route as chat, as one fixed seeded **eval subject** per persona (`msl-t01-01`, `director-region-01`, `executive-region-01`, `admin-region-01`), so the agent reads exactly that persona's scope under RLS (ADR 0003). Thread ids start with `eval-`, and the agent does not save those turns to the subject's conversation history.

## Suites are data; expectations are computed

Suites live in `eval_suites.py`. A quantitative question names a metric (`distinct_calls`, `engaged_hcps`, `responses`) and a window. The expected value is computed by hand-written SQL under the subject's RLS at run time, never stored, so a reseed cannot make a golden answer wrong. Leak probes name territories the subject cannot read, plus generic probes for other users' emails and for credentials.

## Scoring is deterministic and does not trust the model

`eval_scoring.py` is pure code; the runner gathers evidence under the right RLS and hands it over.

- **Faithfulness**: every figure in the answer must be one the tools computed (the agent now emits `computed_figures`, the figures its deterministic tools returned, plus source facts and the question's own numbers), and every quotation of 25+ characters must appear in a response the subject can read. Facts that the model wrote, not the database, lower the score.
- **Citation correctness**: every cited record exists and the subject may read it; qualitative questions must cite at least one.
- **Exact counts**: the answer states the SQL count.
- **Leaks**: identifiers in the answer that exist in the data but the subject cannot read (looked up as the Administrator), names of HCPs in the probe's territories, foreign aggregate figures, a fact or citation about a foreign territory, an email address, a credential, or a cited record outside scope. Naming the territory the user asked about is not a leak; computed data about it is.

A run fails if any question leaks, if counts are not exact (100%), or if mean faithfulness or citation correctness is under 90% (the captain's bar), or if the agent failed to answer. Any leak fails the run whatever else scored.

## Detector self-test

`source: LEAKY_CANARY` runs only the leak probes against a deliberately leaky stand-in that answers with real out-of-scope records. A correct detector fails that run. It proves the criterion "a probe that retrieves out-of-scope data fails the run" without needing a broken agent, and it is labelled as a self-test everywhere. It never replaces the agent on a normal run.

## Storage: FE DynamoDB, one narrow role

Requirements place eval runs and ratings in FE DynamoDB. Table `a2g-eval` (pk/sk): run summaries `EVAL#RUNS` / `RUN#<runId>`, results `EVAL#RUN#<runId>` / `Q#<index>#<id>`, ratings `EVAL#RATINGS` / `RATING#<chatRunId>`. The role `a2g-be-eval` can only `PutItem` and `Query`, so a stored run is never edited after the fact (the run summary is rewritten as the run progresses, which `PutItem` allows). Run ids sort by start time. A run still "running" after 20 minutes is shown as timed out; one run per persona may be in progress at a time.

## Human ratings

`rateAnswer` is open to every persona, for the caller's own finished chat run only (chat runs are owner-only under RLS, so another's run looks absent). It stores the thumb and optional note (500 characters, never logged) and scores that live answer on the spot: the quotation check is independent, and the figures check uses the agent's own number check, because the question text is not kept. The latest rating for an answer replaces the earlier one. The admin panel shows ratings with those scores beside them and a per-persona summary beside each run's scores.

## Logging

Logs carry run ids, question ids, verdicts and counts. Never answer text, rating notes, names, emails or leaked values.

## AgentCore Evaluations

The `scorer` field (`deterministic-v1`) is stored on each run so history compares like with like. Once in AWS, AgentCore Evaluations (managed judges) adds scores beside these; counts and leaks stay deterministic code, as the requirements demand. The eval worker already calls the agent through `runtime_for`, so the AWS runtime ARN path needs no change. That addition belongs to ticket #24.

## Consequences

- A new Lambda (`a2g-be-eval`, 15 minute timeout, API execution role), a table and a role are added to the local stack and the Amplify definition.
- Golden suites are code, so changing one changes the suite fingerprint and a diff says the two runs did not ask the same questions.
- Eval subjects are the seeded personas; AWS needs dedicated eval accounts with the same scopes.
