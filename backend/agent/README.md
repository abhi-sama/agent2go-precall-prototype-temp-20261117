# MSL Agent Runtime

This is the AgentCore Runtime-compatible service for ticket #3. It exposes `GET /ping` and
`POST /invocations` on port 8080. Invocations return an SSE stream of AG-UI events.

## Local model path

Run `./scripts/run-local.sh`. The script reads `ANTHROPIC_API_KEY` at runtime from
`~/.config/agent2go/keys.env` and never copies it into this repository. With a non-empty key it
starts this lane's `floci-a2g-agent` on port 4568 and a LiteLLM proxy on port 4000. The default
Bedrock model is `anthropic.claude-sonnet-5-5-v1:0`, mapped to `claude-sonnet-5-5`; the cheap
live-test mapping is `anthropic.claude-haiku-5-5-v1:0` to `claude-haiku-5-5`. With no key it starts
floci's default Bedrock stub; Strands still calls `ConverseStream` through floci.

```bash
cd backend/agent
./scripts/run-local.sh
uv run uvicorn msl_agent.app:app --host 0.0.0.0 --port 8080
```

The runtime uses `strands.models.BedrockModel(streaming=True)`, which selects Bedrock
`ConverseStream`; this is necessary because floci proxies only `Converse` and `ConverseStream`.

## Tests

```bash
cd backend/agent
uv sync --all-groups
uv run pytest
```

`test_stub_ag_ui` is deterministic and always runs. The live floci -> LiteLLM -> Claude test
skips with an explicit message when the key is empty. To enable it after starting the local stack:

```bash
BEDROCK_MODEL_ID=anthropic.claude-haiku-5-5-v1:0 \
  RUN_LIVE_FLOCI_TESTS=1 uv run pytest tests/test_live_floci.py
```

## Contract gaps

Until `backend/db/` is merged, the read tool uses a synthetic fixture through the same repository
interface. The Postgres adapter already establishes `app.set_request_identity(user_id, persona,
correlation_id)` within the transaction before querying the future `agent_scope_call_facts` view.
The DynamoDB conversation-write tool is intentionally only a typed interface in this ticket.
