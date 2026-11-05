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
    # ``nohup ... &`` stays in the launcher's process group on macOS. A caller
    # such as an automated local-stack command can close that group immediately,
    # taking the bridge down after this script reports success. Start a new
    # session so this task-owned process outlives its short-lived launcher.
    A2G_CLI_ROOT="$ROOT" A2G_CLI_PORT="$PORT" A2G_CLI_HOST="$HOST" \
      A2G_CLI_PID_FILE="$PID_FILE" A2G_CLI_LOG_FILE="$LOG_FILE" \
      A2G_CLI_BACKEND="${LLM_BACKEND:-claude-cli}" python3 - <<'PY'
import os
import subprocess
from pathlib import Path

root = Path(os.environ["A2G_CLI_ROOT"])
pid_file = Path(os.environ["A2G_CLI_PID_FILE"])
log_file = Path(os.environ["A2G_CLI_LOG_FILE"])
env = os.environ.copy()
env["LLM_BACKEND"] = os.environ["A2G_CLI_BACKEND"]

with log_file.open("ab") as log:
    process = subprocess.Popen(
        [
            "uv", "run", "--project", str(root / "backend" / "agent"), "--quiet",
            "uvicorn", "msl_agent.cli_llm:app", "--host", os.environ["A2G_CLI_HOST"],
            "--port", os.environ["A2G_CLI_PORT"],
        ],
        cwd=root,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )

pid_file.write_text(f"{process.pid}\n", encoding="utf-8")
PY
    ;;
  stop)
    if owned_pid; then
      # ``start_new_session`` makes this PID the process-group leader. Stop its
      # own group so ``uv`` cannot leave the uvicorn child listening on the port.
      bridge_pid=$(cat "$PID_FILE")
      kill -TERM -- "-$bridge_pid"
    fi
    rm -f "$PID_FILE"
    ;;
  *)
    echo "usage: cli-llm.sh start|stop" >&2
    exit 2
    ;;
esac
