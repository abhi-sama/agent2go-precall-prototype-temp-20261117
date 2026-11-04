# The chatbot's answers are proved against SQL, by question type, including 9 to 12 turn conversations

Ticket #62 turns the evaluation panel's golden suites (ADR 0013) into a thorough answer-quality test. The captain's bar is exact counts 100% against SQL, qualitative faithfulness and citations at least 90%, and zero leaks. This record covers what was added to reach it and the product defects the suite found.

## Seven question types, 40+ per persona

Every suite covers `EXACT_COUNT`, `PERCENTAGE`, `TREND`, `COMPARISON`, `QUALITATIVE_THEME`, `FOLLOW_UP_CHAIN` and `LEAK_PROBE`. MSL, Director and Administrator each have 43 to 46 single-turn questions plus four conversations of 9, 9, 10 and 12 turns (85 to 86 results). The Executive suite has 35 single-turn questions plus two 9-turn conversations; the Executive is aggregate-only, so every question that is not a leak probe expects an honest "not available" and no figures, quotes, charts or records (a `no_access` question). Run scores are reported per type (`categories`), so a weak type is not averaged away.

Suites stay plain data in `eval_suites.py`. Windows are fixed dates inside the loaded data, and the golden prompts are written the way a person would ask, not "use the tool".

## Ground truth is recounted, never stored

`eval_truth.py` holds the hand-written SQL, run under the eval subject's own RLS at run time. It shares no code with the agent's queries.

- **Counts**: distinct calls, engaged HCPs, responses, responses to one question, HCPs who answered it, topic matches; filters for territory, product, specialty, topic.
- **Shares**: the answers equal to a value over all responses to the question, with numerator and denominator.
- **Trends**: the count over a window against an earlier window, `UP`, `DOWN` or `FLAT` (a change under 3% and under two units is flat).
- **Leaders**: which month, product, territory, topic or question has the highest or lowest figure; a tie is a set of leaders and saying so is right.
- **Topic variants**: "competitors" searched as "competitor" is the same theme; a count is correct if it equals the count for the topic as written, its singular or plural, or one word of a phrase.
- **Chart recount**: every number a ready chart plots (line, bar, timeline, heatmap) is recounted from raw rows under the subject's RLS, including the chart's total; a distribution's shares must equal its counts over its total.

## Scoring

All deterministic code (scorer `deterministic-v2`; v1 runs are not mixed in a diff silently, the scorer name is stored on each run).

| Check | Rule |
| --- | --- |
| Exactness | The answer states the SQL figure; a share also states its percentage and its denominator (`PERCENT_MISMATCH`, `DENOMINATOR_MISSING`); counts written as words count. |
| Direction | Trend: the answer's first direction-bearing clause agrees with SQL, with negations ("not up") handled; a flat result may be called slight. Leader: the ranking sentence names a key that has the extreme value (`WRONG_DIRECTION`, `WRONG_LEADER`). |
| Uncertainty | An approximate question's answer says how sure it is (a hedge or the sample size) (`NO_UNCERTAINTY`). |
| Visuals | A question needing key figures or a chart got one (`VISUAL_MISSING`); the plotted numbers equal a recount and a key figure shows the expected figure (`VISUAL_MISMATCH`). |
| Themes | A qualitative answer names its theme, quotes real records (a quotation is four or more words and must appear in a record the subject can read, response or question text), cites at least one record (none needed when nothing matched), and states the matching count. |
| No-access | The aggregate-only persona is shown no facts, citations or charts (`LEAK_NO_ACCESS_DATA`) and the answer says it is unavailable (`NO_ACCESS_NOTE`). |
| Filters | An answer that says it could not apply a requested filter fails even if the figure happens to match (`FILTER_IGNORED`). |

A run fails on any leak, exact figures under 100%, faithfulness or citations under 90%, direction under 90%, a chart number that disagrees with SQL, key figures or charts missing from more than 10% of the questions that needed them, theme coverage under 90%, no conversation that reaches 8 turns, an agent error, or a recount that failed (`TRUTH_UNAVAILABLE`).

## Conversations

A conversation is one unit of work in the eval worker. Each turn is sent the way the browser sends it, with the conversation so far as history, so a turn like "and September?" or "go back to my very first question" works only if context is kept. Every turn is scored as its own result (`chainId`, `turn`); a figure restated from an earlier turn is allowed because it was verified there. A chain is correct only if every turn passes (`chainsCorrect`); `chainDepth` is the most turns any chain got through without an agent error. The 12-turn conversations send 22 history messages, so the chat history cap was raised from 8 to 24 messages in the BE Lambda and the agent (the schema already allowed 40).

## What the suite found, and what was fixed here

1. **Percentages were refused.** The agent answered "I can't calculate a percentage" and gave counts. The question tool now returns each answer's `share_percent` (computed once from SQL counts) and the denominator, draws a distribution chart of the question's answers, and the prompt allows only tool-returned percentages, always with their denominator. The number guard treats those percentages as verified; one the model makes up is still reported.
2. **Specialty filter.** "Calls with oncologists" was answered with "I can't filter by specialty". `get_activity_summary` takes an optional specialty that filters calls and engaged HCPs (responses carry no specialty filter, and the tool says so).
3. **Trends and comparisons were stated without direction or caution.** The prompt now asks for the direction (or the highest group, or a tie) in the first sentence and one short caution about the sample.
4. **Conversation depth.** History was capped at 4 exchanges end to end.

## Found, not fixed here (filed as follow-ups #83 and #84)

- Executive chat returns no aggregates. Spec stories 15 and 22 want suppressed aggregates with sample sizes in chat; today the agent refuses record-level and aggregate questions alike for an aggregate-only user. The suite proves nothing leaks and the answer is honest; it will need new expectations when aggregates arrive.
- "Show rows" exists per cited record (its fields), not for the whole set of rows behind an answer. (Built in ADR 0015, #84.)

## Consequences

- A full run is about 85 live agent calls per persona; four personas started together finish in a few minutes (6 questions or conversations in parallel per run).
- Golden questions changed, so every suite fingerprint changed; diffs against ADR 0013-era runs report `suiteChanged`.
- Results store `expectedText`, `visualNotes` and `unverifiedSample`, so a failing question shows what was expected, what was wrong and which figures nobody computed.
