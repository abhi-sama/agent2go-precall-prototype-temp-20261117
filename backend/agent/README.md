# MSL Agent Runtime

The AgentCore Runtime-compatible service behind chat (ticket #3, [ADR 0007](../../docs/adr/0007-chat-runs-stream-through-a-polled-event-log.md)).
It exposes `GET /ping` and `POST /invocations` on port 8080; an invocation returns an SSE stream of AG-UI events.

```
POST /invocations  {identity, thread_id, run_id, messages[]}
  RUN_STARTED, CUSTOM model_mode,
  [TOOL_CALL_START, CUSTOM source_facts, CUSTOM citations, TOOL_CALL_END]*,
  TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT*, TEXT_MESSAGE_END,
  CUSTOM number_check, CUSTOM suggestions, CUSTOM conversation_saved, RUN_FINISHED   (or RUN_ERROR)
```

| Module | Role |
|---|---|
| `repository.py` | Read tools' SQL. Connects as `app_user` and binds the caller with `app.set_request_identity` before any query, so RLS limits every result. |
| `tools.py` | Strands tools (`get_activity_summary`, `search_recorded_responses`, `get_my_scope`, `suggest_follow_ups`); they record facts and citations as they run. |
| `agent.py` | Runs the Strands agent over Bedrock ConverseStream and turns its events into AG-UI events. |
| `numbers.py` | Checks that figures in the answer came from tool results. |
| `writes.py` | The narrow write tool: assumes the FE role and puts one turn in FE DynamoDB. The model cannot call it. |

The stack (`backend/infra/scripts/up.sh`) builds and runs this as a container next to floci.
Bedrock calls go to floci, which proxies to LiteLLM and Claude when a key is present and answers with its stub when not.

## Tests

```bash
cd backend/agent && uv sync --all-groups && uv run pytest
```

Unit tests use a scripted model.
`test_stub_floci.py` starts a throwaway floci (no key needed) and runs the real agent against its Bedrock stub; it skips without Docker.
End-to-end behaviour with Claude is proved through the API by `tests/api/test_chat.py`.
