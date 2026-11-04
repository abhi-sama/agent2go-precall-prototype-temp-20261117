# Chat answers stream through a polled event log; numbers are computed, not generated

A chat question travels the approved route (ADR 0001): the browser's `startChatRun` mutation reaches the BE API Lambda through FE AppSync.
That Lambda verifies the caller, records a `chat_runs` row owned by the user, and starts the chat worker Lambda asynchronously, so the mutation returns at once.
The worker calls the agent over the AgentCore Runtime HTTP contract (`POST /invocations`, a server-sent stream of AG-UI events) and appends each event to `chat_run_events`.
The browser reads the events in order with the `chatEvents` query and renders them as they arrive.
Both tables are owner-only under RLS, so another user's run is indistinguishable from one that does not exist.

## AppSync subscriptions are not available locally

floci's AppSync has no subscriptions.
The polled event log is the stand-in: same events, same order, same ownership checks, delivered by a query instead of a push.
The frontend reads them through one function (`DataAdapter.chatEvents`), so replacing the poll with an `onChatEvent` subscription in AWS changes the adapter and the worker's publish step, not the panel or the agent.
That swap is part of the AWS infrastructure work (ticket #24), because it cannot be exercised on floci.
In AWS the worker calls `bedrock-agentcore` `InvokeAgentRuntime` (`AgentCoreRuntime` in `agent_client.py`, unit-tested only); locally it calls the agent container.

## Numbers are computed, not generated (requirements rule: deterministic code handles counts)

The agent's read tools run SQL under the caller's RLS session (the same `app.set_request_identity` contract as the API Lambda) and return finished results.
Each tool also emits the figures it computed as **source facts** and the records behind them as **citations**; the interface shows those, labelled as computed from the data.
The model's prose is an **AI summary**: the system prompt forbids computing, rounding or estimating, and `numbers.py` checks the finished text against the tool results and the user's own question.
Any figure it cannot match is reported as `number_check: unverified`, and the panel warns instead of presenting it as data.
Suggestions are a third, separate kind of content: proposals, written without numbers.

A territory the caller cannot read has no rows, so the tool returns one fixed answer ("outside your scope") whether the territory is real or not.
Aggregate-only personas (Executive) read no source rows here; their path is ticket #13.

## Conversation history

When a run finishes the agent saves the turn to FE DynamoDB with its write tool (ADR 0005): it assumes a cross-account role that can only `PutItem` / `UpdateItem` on one table, and the item is keyed `USER#<user_id>` with scope, data-through date, generation time and evidence links.
The runtime calls the tool after the answer; the model cannot call it or choose what is written.
Reading history back is not built yet.

## Without an API key

`up.sh` starts LiteLLM only when `~/.config/agent2go/keys.env` holds a key (LiteLLM sources the mounted file itself; the key is never copied into the repo or this project's environment).
With no key floci answers ConverseStream with its stub text and never calls tools, so the agent computes the default activity facts itself, labels the answer "Local stub model", and skips the number check.
`backend/agent/tests/test_stub_floci.py` proves this against a throwaway floci.
