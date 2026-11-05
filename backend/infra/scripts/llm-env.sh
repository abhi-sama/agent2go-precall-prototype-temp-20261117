#!/usr/bin/env bash
# Shared by up.sh and test.sh: choose the local LLM backend and export what the agent container needs.
# Sourced, never executed.  The agent container is recreated by every provisioner run, so every caller of
# `a2g-provision` must export the same A2G_BEDROCK_BACKEND, or the agent silently falls back to stub mode.
# Claude CLI is the local default.  It keeps subscription credentials inside the
# official CLI; the host bridge invokes it from an empty working directory.
KEYS_FILE="${A2G_KEYS_FILE:-$HOME/.config/agent2go/keys.env}"
LLM_BACKEND=${LLM_BACKEND:-claude-cli}
COMPOSE_SERVICES=(floci graphql)
case "$LLM_BACKEND" in
  claude-cli|codex-cli)
    export A2G_BEDROCK_BACKEND=proxy COMPOSE_PROFILES=llm
    # The relay runs in Docker while the subscription CLI bridge runs on the host.
    # Isolated stacks select a unique bridge port, so keep the relay target aligned.
    export A2G_LLM_RELAY_PORT="${A2G_LLM_RELAY_PORT:-${A2G_CLI_LLM_PORT:-4001}}"
    # A subscription CLI answers in 10-30 s, so brief and summary generation may wait longer than the AWS 25 s.
    export A2G_AGENT_TIMEOUT_SECONDS=${A2G_AGENT_TIMEOUT_SECONDS:-50}
    "$SCRIPT_DIR/cli-llm.sh" start
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

