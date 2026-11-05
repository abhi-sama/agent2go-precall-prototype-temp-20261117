#!/usr/bin/env bash
# Stop the local stack and remove the containers floci started for it.
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$SCRIPT_DIR/.."
# floci launches Lambda, RDS and AppSync-runtime containers as siblings, labelled by
# docker-compose.yml; remove only those, never another floci instance's.
docker ps -aq --filter "label=io.agent2go.stack=${A2G_STACK_LABEL:-local}" | xargs -r docker rm -f >/dev/null
"$SCRIPT_DIR/cli-llm.sh" stop
COMPOSE_PROFILES=llm,api,agent docker compose down
