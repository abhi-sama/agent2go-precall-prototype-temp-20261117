# Chat write approvals resume through AppSync

Ask the agent can propose exactly three writes: saving a pre-call brief, saving a post-call workflow draft, and setting a feedback flag. A proposed write is parsed into a closed, bounded shape in the Strands agent and ends its run with a standard AG-UI `RUN_FINISHED` interrupt. CopilotKit's `useInterrupt` renders the proposal, permits the user to edit only its text field, and either resolves it or cancels it.

The browser does not send a write directly to an agent runtime or CopilotKit. `AppSyncChatAgent` turns the interrupt response into the existing FE AppSync path's `resumeChatRun` mutation. That mutation reads the original terminal event under the caller's RLS session, verifies that it is this caller's interrupted run and that the replacement values name only existing proposal fields, then starts a new worker run linked by `chat_runs.resumes_run_id`. The worker persists the resume events in the same append-only event log. A cancellation follows the same path and emits no browser-side mutation.

On approval the agent emits one closed browser tool call, `a2g_execute_write`. Its arguments are rebuilt from the persisted event metadata in the agent, not the browser response. `useFrontendTool` invokes the existing AppSync-backed brief, post-call, or flag mutation, each of which checks scope and permissions independently. The browser also registers closed-list navigation, HCP-open (after an RLS-backed profile read), dashboard-filter, and clipboard tools; none accepts an arbitrary URL, query, or access scope.

Conversation history remains routine user-owned persistence and is not a write requiring this approval. No CopilotKit Cloud key, runtime endpoint, telemetry, or public API key is configured.
