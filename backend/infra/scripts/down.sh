#!/usr/bin/env bash
# Stop the local stack and remove the containers floci started for it.
set -euo pipefail
cd "$(dirname "$0")/.."
# floci launches Lambda, RDS and AppSync-runtime containers as siblings, labelled by
# docker-compose.yml; remove only those, never another floci instance's.
docker ps -aq --filter "label=io.agent2go.stack=${A2G_STACK_LABEL:-local}" | xargs -r docker rm -f >/dev/null
COMPOSE_PROFILES=llm,agent docker compose down
