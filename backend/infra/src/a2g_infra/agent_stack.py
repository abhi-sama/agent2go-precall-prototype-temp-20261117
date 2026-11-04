"""The agent side of the local stack: the FE conversation store and the agent container.

* FE account: the conversation table and the narrow cross-account role the agent assumes to write to
  it (docs/adr/0005) are part of the Amplify backend, so they deploy with it. The role can only
  ``PutItem`` / ``UpdateItem`` on that table.
* The agent itself (AgentCore Runtime stand-in) runs as a container on the compose network next to
  floci, with the BE database as ``app_user`` and floci as its Bedrock endpoint (docs/adr/0007).
"""

from __future__ import annotations

import os
import subprocess
import time
import urllib.request

from .config import (
    AGENT_HOST_PORT,
    COMPOSE_FILE,
    FE_CHAT_TABLE,
    FE_CHAT_WRITER_ROLE_ARN,
)

def fe_store() -> dict:
    """The conversation table and write role come from the Amplify backend (frontend/amplify/storage)."""
    return {"table": FE_CHAT_TABLE, "role_arn": FE_CHAT_WRITER_ROLE_ARN}


def deploy_agent(db: dict, store: dict) -> dict:
    """Build and (re)start the agent container with the stack's coordinates in its environment."""
    env = {
        **os.environ,
        "A2G_AGENT_DATABASE_URL": db["app_dsn_internal"],
        "A2G_FE_WRITE_ROLE_ARN": store["role_arn"],
        "A2G_FE_CHAT_TABLE": store["table"],
        "COMPOSE_PROFILES": "agent",
    }
    subprocess.run(
        ["docker", "compose", "-f", str(COMPOSE_FILE), "up", "-d", "--build", "--force-recreate", "agent"],
        env=env,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    url = f"http://localhost:{AGENT_HOST_PORT}"
    deadline = time.time() + 90
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{url}/ping", timeout=3) as resp:
                if resp.status == 200:
                    return {"url": url}
        except OSError:
            time.sleep(1)
    raise SystemExit("the agent container did not become healthy; see `docker logs` for its container")
