# The chat shares page state and context with the agent

Ask the agent (ADR 0018) knows what the person is looking at, shows what the agent is doing while it works, and lets the agent *propose* a change to the page's filters. Three things travel, over the approved path only (browser → FE AppSync → BE Lambda → agent, ADR 0001, ADR 0007), and none of them is authority.

## Page context: what the agent reads

`startChatRun` has one more optional argument, `page` (`ChatPageInput`):

- **`label`**: the page's name ("My territory").
- **`filters`**: the filters the person left on (date range, territory, product, disease area, study, survey, question, theme), after the chips: removing a chip in the composer stops that filter being sent, as it does for the screen context. There is no record-level HCP filter.
- **`figures`**: the headline figures printed on the page (up to 12: id, label, value, definition). `KpiTile` registers what it prints while it is on screen and unregisters when it goes (`components/chat/page-figures.tsx`), so no page has to know about the chat. They reach CopilotKit as a `useAgentContext` entry.

The persona is **not** part of it. The agent already has the persona of the verified caller (ADR 0002) and the prompt names that one; a persona sent by the browser would be a claim, so there is nowhere to put one.

The BE Lambda validates `page` as it does `context` (`_clean_page`): closed keys, id and filter patterns, valid ordered dates, short plain text without control characters, at most 12 figures; anything else is `invalid_page`. The agent writes it into the prompt as a short note with the figures JSON-encoded, labelled *what the person sees on screen, copied by the browser, unverified*, and tells the model to use it only to understand which number or chart a question means ("why did this drop?"). **The figures are context, never evidence**: every figure in an answer still comes from an RLS-scoped tool result (ADR 0003, ADR 0007), and the number check (`numbers.py`) still rejects a number that only appears on the page. Aggregate-only personas get nothing record-level from it: it carries nothing but what their own page printed.

## Shared state: the page and the agent write their own halves

CopilotKit's `useAgent` state (`agent.state`) is the shared object, with an owner per key:

| Key | Written by | Holds |
|---|---|---|
| `page` | the page (`AskTheAgentFrame`, from the screen context and the chips) | `{ label, filters }`, kept current, read by the agent with each question |
| `progress` | the agent | `{ status, steps: [{ id, label, status }] }` |
| `proposal` | the agent | a suggested change to the page's filters |

The agent's events arrive as `STATE_SNAPSHOT`s. `RunStream` (ADR 0018) is still an allow-list: it takes only `progress` and `proposal` out of a snapshot, checks them (`lib/chat/page-state.ts`) and re-emits them as `STATE_DELTA` operations on those two paths. It ignores the agent's `page` key and every other key, drops state deltas, caps the number of state events per run, and a run starts by clearing the last run's `progress` and `proposal`. The agent cannot write the page's state or mark its own proposal as applied.

### Progress

The agent reports steps from a closed, data-free label list (`progress.py`): "Checking what you can see", one step per tool ("Counting your activity", "Drawing a chart", ...), "Writing the answer", "Checking every number against your data". While a run is open the thread shows them as a list, with only the step in progress announced politely (one status line, not the whole list at every change); when it ends nothing is left running, the final steps are kept on the answer's tail (`steps`) and fold into a closed disclosure, "How this was worked out", that survives a reload with the conversation. The tool rows of ADR 0018 stay.

### Proposals

A request such as *"Filter the page to territory NE-01 for the last 90 days"* is recognised **by rule, not by the model** (`page_proposals.py`): an opening change verb, a page word, and at least one target (a territory id, an ISO window, a preset phrase, a question id, or a reset). A question that merely mentions the page ("How many calls on my dashboard last 30 days?") is a data question. The checks run before any tool or model:

1. a territory outside the caller's scope gets the existing out-of-scope refusal and **no proposal** (the check does not query the territory, so it reveals nothing about it);
2. an aggregate-only role (Executive) may propose a date range but never a territory or a question;
3. windows are ordered and at most about five years.

The answer is fixed text, and the thread shows a card, "Suggested page filters", with **Apply to the page** and **Not now**. Nothing changes until the person applies it. Applying writes the same shared filter state the filter bar writes, so the scope chip and every chart follow, and every read still runs under the caller's RLS. A territory the person could not read would show nothing: the proposal is a convenience, never access.

## Consequences

- No new service, no new route, nothing sent to CopilotKit.
- The mock adapter speaks the same events (`mock-page-state.ts`), so the iPad and MacBook Playwright runs exercise it.
- Extension points that remain: the agent could propose more than filters, and frontend tools and human-in-the-loop (separate tickets) can reuse the same card pattern.

## Testing

- `frontend/src/lib/chat/page-state.test.ts`, `agent/run-stream.test.ts`, `agent/appsync-agent.test.ts`, `screen-context.test.ts`, `components/chat/page-figures.test.ts`, `data/mock-page-state.test.ts`: the checks, the allow-list, the request, the chips, the figure store, the mock runtime.
- `backend/agent/tests/test_page_state.py`, `backend/lambdas/api/tests/test_chat_unit.py`: validation, the prompt note, the number guard, progress in both modes, proposals and their refusals.
- `frontend/e2e/copilot-state.spec.ts` on every iPad and MacBook project: the page context sent, removable chips, progress, a proposal applied and dismissed, an out-of-scope territory, and the full page.
