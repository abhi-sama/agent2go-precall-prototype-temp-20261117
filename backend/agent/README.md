# MSL Agent Runtime

The AgentCore Runtime-compatible service behind chat (ticket #3, [ADR 0007](../../docs/adr/0007-chat-runs-stream-through-a-polled-event-log.md)).
It exposes `GET /ping` and `POST /invocations` on port 8080; an invocation returns an SSE stream of AG-UI events.

```
POST /invocations  {identity, thread_id, run_id, messages[], context?, a2ui_action?, page?}
  RUN_STARTED, CUSTOM model_mode, STATE_SNAPSHOT (progress),
  [TOOL_CALL_START, CUSTOM source_facts, CUSTOM citations, (ACTIVITY_SNAPSHOT a2ui-surface), TOOL_CALL_END]*,
  TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT*, TEXT_MESSAGE_END, (ACTIVITY_SNAPSHOT a2ui-surface: Adjust this answer),
  CUSTOM number_check, STATE_SNAPSHOT (progress done), CUSTOM suggestions, CUSTOM conversation_saved, RUN_FINISHED   (or RUN_ERROR)
```

| Module | Role |
|---|---|
| `schemas.py` | Request types, including the optional screen `context` (defaults for tool arguments and the summary task; never extra access). |
| `repository.py` | Read tools' SQL. Connects as `app_user` and binds the caller with `app.set_request_identity` before any query, so RLS limits every result. |
| `tools.py` | Strands tools (`get_activity_summary`, `search_recorded_responses`, `get_topic_trends`, `get_question_breakdown`, `show_chart`, `show_answer_distribution`, `get_my_scope`, `suggest_follow_ups`); they record facts, citations and visuals as they run. `get_topic_trends` and `get_question_breakdown` call the database's theme and emerging-topic functions (docs/adr/0011). |
| `chart_data.py`, `visuals.py`, `intent.py` | Whitelisted aggregate SQL for charts, the `visual` AG-UI event payloads built from it, and the deterministic floor that draws a chart when the model skipped the tool (docs/adr/0009). |
| `agent.py` | Runs the Strands agent over Bedrock ConverseStream and turns its events into AG-UI events. |
| `numbers.py` | Checks that figures in the answer came from tool results. |
| `a2ui.py` | A2UI v1.0 answer surfaces (a themes table, the Adjust this answer form) built from tool results, checked against `docs/a2ui/answer-catalog.json` and the number guard, and the validation of a `refine_answer` action (docs/adr/0017). |
| `page_proposals.py` | The deterministic detector for "set the page to ..." requests (docs/adr/0019). No model involved. |
| `progress.py` | The run's progress steps as AG-UI shared state, with a closed, data-free label catalog. |
| `writes.py` | The narrow write tool: assumes the FE role and puts one turn in FE DynamoDB. The model cannot call it. |

## Page context and shared state (docs/adr/0019)

- **`page`** (optional, validated by the BE Lambda and again by `schemas.PageContext`): the page's name, its filters and its headline figures, as the browser printed them. `agent.page_note` puts it in the system prompt as quoted JSON, labelled *unverified display text*; the persona in that note is the verified identity's. The model may use it only to tell which number a question means and may never repeat a page figure: the number guard accepts only tool results (and the user's own words), and it never reads `page`.
- **`STATE_SNAPSHOT` progress**: `{"progress": {"status": "running"|"done"|"error", "steps": [{"id", "label", "status"}]}}`, at most 12 steps, labels from `progress.py` only (`scope`, `tool:<toolUseId>`, `write`, `check`). The first follows `model_mode`; the last (status `done`, or `error` before `RUN_ERROR`) follows the number check.
- **`STATE_SNAPSHOT` proposal**: a question such as "filter the page to T01-01 for the last 30 days" is answered by code, before the model and any tool. After the usual scope checks, the snapshot also carries `"proposal": {"id", "status": "proposed", "reason", "filters": {"preset"|"from"+"to", "territoryId", "questionId"}, "reset"?}` and a fixed-text answer follows. A territory outside the caller's scope is refused with no proposal; an aggregate-only caller may propose dates only. Nothing changes on the page until the person chooses Apply.

The stack (`backend/infra/scripts/up.sh`) builds and runs this as a container next to floci.
Bedrock calls go to floci, which proxies to LiteLLM and Claude when a key is present and answers with its stub when not.

## Tests

```bash
cd backend/agent && uv sync --all-groups && uv run pytest
```

Unit tests use a scripted model.
`test_stub_floci.py` starts a throwaway floci (no key needed) and runs the real agent against its Bedrock stub; it skips without Docker.
End-to-end behaviour with Claude is proved through the API by `tests/api/test_chat.py` and `tests/api/test_chat_visuals.py`.
Chart values are recounted against a real database by `tests/test_visuals_db.py` when `A2G_AGENT_DB_URL` (app_user) and `A2G_OWNER_DB_URL` are set.
