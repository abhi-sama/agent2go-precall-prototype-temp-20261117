#!/usr/bin/env bash
# One command: bring up the local agent2go stack (FE + BE emulated accounts on floci)
# and seed it. Safe to re-run; each run reseeds the database deterministically.
# Everything stays local: every AWS call goes to floci at http://localhost:4566.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=$(cd ../.. && pwd)

for tool in docker uv pnpm psql; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }
done

# Claude CLI is the local default.  It keeps subscription credentials inside the
# official CLI; the host bridge invokes it from an empty working directory.
KEYS_FILE="${A2G_KEYS_FILE:-$HOME/.config/agent2go/keys.env}"
LLM_BACKEND=${LLM_BACKEND:-claude-cli}
COMPOSE_SERVICES=(floci graphql)
case "$LLM_BACKEND" in
  claude-cli|codex-cli)
    export A2G_BEDROCK_BACKEND=proxy COMPOSE_PROFILES=llm
    "$(dirname "$0")/cli-llm.sh" start
    COMPOSE_SERVICES+=(litellm)
    echo "== ${LLM_BACKEND}: floci Bedrock proxy -> local CLI bridge"
    ;;
  api)
    if [ ! -f "$KEYS_FILE" ] || ! grep -Eq '^[[:space:]]*(export[[:space:]]+)?ANTHROPIC_API_KEY=["'"'"']?[^"'"'"'[:space:]]' "$KEYS_FILE"; then
      echo "LLM_BACKEND=api requires ANTHROPIC_API_KEY in $KEYS_FILE" >&2
      exit 1
    fi
    export A2G_BEDROCK_BACKEND=proxy COMPOSE_PROFILES=llm,api
    export A2G_LLM_RELAY_HOST=api-litellm A2G_LLM_RELAY_PORT=4000
    COMPOSE_SERVICES+=(litellm api-litellm)
    echo "== api: floci Bedrock proxy -> LiteLLM -> Claude API"
    ;;
  stub)
    export A2G_BEDROCK_BACKEND=stub COMPOSE_PROFILES=
    echo "== stub: floci's canned Bedrock response"
    ;;
  *)
    echo "LLM_BACKEND must be claude-cli, codex-cli, api, or stub" >&2
    exit 2
    ;;
esac

echo "== starting floci"
docker compose up -d "${COMPOSE_SERVICES[@]}"

echo "== installing frontend dependencies (Amplify backend synth needs them)"
(cd "$REPO/frontend" && pnpm install --frozen-lockfile --silent)

echo "== provisioning"
uv run --quiet a2g-provision "$@"

cat <<MSG

Local stack is up.
  Web app:   cd frontend && pnpm dev --port 3210   ->  http://localhost:3210
  Sign in:   any seeded user from backend/db/seed-users.json, password in frontend/amplify_outputs.json (custom.a2g.local_password)
  Tests:     backend/infra/scripts/test.sh
  Stop:      backend/infra/scripts/down.sh
MSG
