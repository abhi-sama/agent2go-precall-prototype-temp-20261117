#!/usr/bin/env bash
# Start/stop the host-side subscription CLI bridge.  Credentials remain owned by
# the official CLI; this script never reads, exports, or mounts them.
set -euo pipefail

ACTION=${1:?usage: cli-llm.sh start|stop}
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
PORT=${A2G_CLI_LLM_PORT:-4001}
HOST=${A2G_CLI_LLM_HOST:-0.0.0.0}
PROJECT=${A2G_PROJECT:-agent2go}
PID_FILE=${A2G_CLI_LLM_PID_FILE:-"/tmp/${PROJECT}-cli-llm-${PORT}.pid"}
LOG_FILE=${A2G_CLI_LLM_LOG_FILE:-"/tmp/${PROJECT}-cli-llm-${PORT}.log"}

owned_pid() {
  [ -s "$PID_FILE" ] || return 1
  local pid
  pid=$(cat "$PID_FILE")
  kill -0 "$pid" 2>/dev/null || return 1
  ps -p "$pid" -o command= 2>/dev/null | grep -Fq 'msl_agent.cli_llm'
}

case "$ACTION" in
  start)
    if owned_pid; then
      exit 0
    fi
    rm -f "$PID_FILE"
    LLM_BACKEND=${LLM_BACKEND:-claude-cli} \
      nohup uv run --project "$ROOT/backend/agent" --quiet uvicorn msl_agent.cli_llm:app \
        --host "$HOST" --port "$PORT" >"$LOG_FILE" 2>&1 &
    echo "$!" >"$PID_FILE"
    ;;
  stop)
    if owned_pid; then
      kill "$(cat "$PID_FILE")"
    fi
    rm -f "$PID_FILE"
    ;;
  *)
    echo "usage: cli-llm.sh start|stop" >&2
    exit 2
    ;;
esac
