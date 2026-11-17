# Ask the agent runs on CopilotKit's open-source components, over the AppSync event log

Ask the agent (the chat in the top bar, the docked sidebar and `/chat`) is drawn with CopilotKit's open-source React components and default design: `CopilotPopup` below the docking width (a side panel, or a tall panel in iPad portrait), `CopilotSidebar` beside the page from 1366px, and `CopilotChat` on the full page. The rest of the app stays Astryx. Only `@copilotkit/react-core` (MIT, pinned to 1.88.0) and the AG-UI client it is built on (`@ag-ui/client`, `@ag-ui/core` 1.0.2) are used: no Copilot Runtime, no CopilotKit Intelligence or Copilot Cloud, no `publicApiKey`, `publicLicenseKey` or license token, and nothing is sent to CopilotKit's servers.

## The browser still reaches the agent only through AppSync

CopilotKit normally sends a run to its runtime endpoint, which forwards it to an AG-UI agent. That would be a second route to the agent, so it is not used. Instead the browser holds an AG-UI agent of its own, `AppSyncChatAgent` (`frontend/src/lib/chat/agent/appsync-agent.ts`), and registers it with the provider. Its `run` is the approved path, unchanged (ADR 0001, ADR 0007): the `startChatRun` mutation through FE AppSync to the BE Lambda, which verifies the caller (ADR 0002) and starts the worker, then the `chatEvents` query until the run is done. Every figure is still counted by RLS-scoped SQL in the BE (ADR 0003, ADR 0007); the client only reshapes the event log for CopilotKit.

The agent is registered with the provider's `agents__unsafe_dev_only` prop. CopilotKit offers two ways to register an agent instance directly: that one, and `selfManagedAgents`, which its documentation places in the paid Enterprise Intelligence tier (it logs a licence warning without a `publicLicenseKey`). The code path is the same; the open-source one is used so that nothing paid is involved. The prop's name, and CopilotKit's documentation of it ("don't ship it to production"), warn about an agent *endpoint* that the browser would call directly, with no runtime to authenticate it. Here there is no endpoint: the agent object calls our own AppSync API with the person's Cognito session, and the BE authorises every request. If CopilotKit ever removes the prop, the alternatives are, in order: `selfManagedAgents` with a licence, or a runtime route behind the same Cognito check that calls the agent through the same BE path. A runtime route was not built because CopilotKit works without one.

## The event log becomes a well-formed AG-UI stream

`RunStream` (`frontend/src/lib/chat/agent/run-stream.ts`) is the trust boundary in the browser. It is an allow-list:

- **Passed through:** text messages (renamed `<runId>~text~<n>` so a message can be traced to its run), tool calls (grouped under `<runId>~tools`), and the evidence `CUSTOM` events (`source_facts`, `citations`, `visual`, `row_sets`, `rows_unavailable`, `sample_limitations`, `suggestions`, `number_check`, `conversation_saved`, `model_mode`).
- **Screened:** A2UI `ACTIVITY_SNAPSHOT`s pass only through the answer-catalog gate of ADR 0017, at most four per run, renamed `<runId>~surface~<surfaceId>` so a surface can never replace another answer's.
- **Dropped:** state snapshots and deltas, message snapshots, raw, step and reasoning events, any other activity type, and any other custom name (so the agent cannot start CopilotKit's interrupts, frontend tools or MCP apps).
- **Repaired:** `RUN_STARTED` is always first and carries this run's ids; text messages and tool calls left open are closed, every finished tool call gets a `TOOL_CALL_RESULT`, and nothing follows the terminal event. The AG-UI client's verifier rejects a run that breaks these rules, and a stored log can (the worker appends a bare `RUN_ERROR` when the agent is unavailable).

CopilotKit keeps messages, not custom events, so the evidence travels as two `ACTIVITY_SNAPSHOT` messages of type `a2g-answer` per run: the **head**, created when the first figure arrives (after the tool row, before the text), and the **tail**, created when the run ends, carrying the outcome (`done` or `error` with fixed text). Both hold the run's raw evidence events; every render folds them through the same parsers as before (`lib/chat/events.ts`), so a restored conversation is checked like a live one.

The agent itself was aligned too: it emits `TOOL_CALL_RESULT` (the outcome only, never the tool's output) after each `TOOL_CALL_END`, and closes any tool call the model never returned from before the text ends or the run errors (`backend/agent/src/msl_agent/agent.py`). The `ag-ui-strands` adapter was considered and not used: it wraps a plain Strands agent and serves its own HTTP app, while this agent's run carries deterministic tools, refusals before the model, the number check, row sets and A2UI surfaces that the adapter does not produce, behind the AgentCore `POST /invocations` contract.

## What each existing capability became

| Capability | In CopilotKit |
|---|---|
| Streaming answer | CopilotKit's assistant message; the text is the AI summary, labelled as such |
| Citations | Numbered markers after each sentence (`lib/chat/cite.ts`), drawn by the assistant message's markdown slot, plus a Sources row; both open the record sheet |
| Source facts, charts (ADR 0009) | The `a2g-answer` head, through `renderActivityMessages` |
| Show rows (ADR 0015), sample limitations, number check, aggregate-only note, errors | The `a2g-answer` tail |
| A2UI surfaces (ADR 0017) | An activity renderer for `a2ui-surface` that uses the existing gated renderer and catalog; a form's action runs the agent with `forwardedProps.a2gSurfaceAction`, which becomes `startChatRun(…, action)` |
| Answer feedback | CopilotKit's thumbs on the assistant message, saved with `rateAnswer`, and the optional note |
| Starters and follow-up suggestions | CopilotKit's suggestion pills (`useConfigureSuggestions`): starters before the first question, the latest answer's suggestions after |
| Tool activity | `useDefaultRenderTool`, one row per call in plain words |
| Screen context and its chips | `useAgentContext` (checked again by the agent and by the BE); the chips sit above CopilotKit's composer, each removable |
| One conversation per person, across close, navigation and reload | The agent's message list, saved to `sessionStorage` (`lib/chat/persistence.ts`); an answer cut off by a reload is marked interrupted |

Markdown from the model is rendered without raw HTML, links render only as citation markers, and images are not loaded.

The Director territory summaries and the Executive organisation analysis are not the chatbot: they keep their inline Astryx answer view (`components/chat/assistant-turn.tsx` with `lib/chat/use-chat.ts`).

## Extension points

These are left for the features built on this ticket; none is wired to the agent yet:

- **Frontend tools and human-in-the-loop** (`useFrontendTool`, `useHumanInTheLoop`): CopilotKit already passes the registered tools to `AppSyncChatAgent.run` as `input.tools`, and would send their results back as tool messages. Both need a field on `startChatRun` and agent support, and `RunStream` must then let those tool calls through.
- **Shared and agent state** (`useAgent` state, `useCoAgent`-style rendering): `input.state` reaches `run`; the agent emits no `STATE_*` events yet, and `RunStream` drops them until it does.
- **Generative UI**: per-tool renderers (`useRenderTool({ name: "show_chart" })`) and more activity renderers can be registered beside `ANSWER_RENDERERS`; the evidence head and tail are the place to move chart drawing into tool renders.
- **Context**: further `useAgentContext` entries arrive in `input.context`; the agent reads only the screen context today.

## Consequences

- CopilotKit's stylesheet (`@copilotkit/react-core/v2/styles.css`) scopes its tokens and resets to `[data-copilotkit]`, so the chat looks like CopilotKit and follows the app's light and dark mode (`.dark`), while the rest of the app is unchanged. It loads with the chat (`copilot-root.tsx`, through `next/dynamic`), not with every page. `components/chat/copilot-chat.css` adjusts it only where this app has a rule CopilotKit cannot know: room for the context chips, the popup kept clear of the top bar (it opens from the top bar, not CopilotKit's floating toggle), 44pt controls on touch screens, and WCAG AA contrast for the composer's edge (1.4.11) and placeholder (1.4.3), which `e2e/appearance-matrix.spec.ts` checks in all six looks.
- At docking width CopilotKit's sidebar narrows the page (it sets the body's inline end margin), so the workspace reflows instead of being covered; navigation becomes an icon rail.
- pnpm does not run dependency install scripts, so `@scarf/scarf` (an install-time analytics ping in CopilotKit's dependencies) never runs. The provider sets no runtime URL and no learning configuration, so CopilotKit makes no network request; `e2e/copilot-chat.spec.ts` fails if a page requests any `copilotkit.ai` address.

## Testing

- `frontend/src/lib/chat/agent/run-stream.test.ts`: the AG-UI verifier accepts the output for an ordinary answer and for a log cut short; the allow-list; the A2UI gate; stop and error outcomes.
- `frontend/src/lib/chat/agent/appsync-agent.test.ts`: the request (question, checked context, history, surface action), errors as fixed text, time-out, a log without a terminal event, stop.
- `frontend/src/lib/chat/agent/turns.test.ts`, `persistence.test.ts`, `cite.test.ts`: turns and history, reload, stored data checks, citation markers.
- `backend/agent/tests/test_runtime.py`: every run the agent streams passes the same AG-UI rules, and tool results carry no tool output.
- `frontend/e2e/copilot-chat.spec.ts` on every iPad and MacBook project: panel, docked sidebar and full page, an answer with its evidence, no CopilotKit network traffic. `chat.spec.ts`, `chat-drawer.spec.ts`, `a2ui-chat.spec.ts` and the `chat-*` screens of the matrix cover the rest.
