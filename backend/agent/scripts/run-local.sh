#!/usr/bin/env bash
# Starts only this lane's containers. It never copies the operator key into the worktree.
set -euo pipefail

key_file="${HOME}/.config/agent2go/keys.env"
anthropic_key=""
if [[ -f "$key_file" ]]; then
  anthropic_key="$(awk -F= '$1 ~ /^[[:space:]]*(export[[:space:]]+)?ANTHROPIC_API_KEY[[:space:]]*$/ { value=$2; gsub(/^[[:space:]\"'"'"']+|[[:space:]\"'"'"']+$/, "", value); print value; exit }' "$key_file")"
fi

if docker ps -a --format '{{.Names}}' | grep -qx 'floci-a2g-agent'; then
  echo "floci-a2g-agent already exists; refusing to replace an existing container." >&2
  exit 1
fi

if [[ -n "$anthropic_key" ]]; then
  if docker ps -a --format '{{.Names}}' | grep -qx 'litellm-a2g-agent'; then
    echo "litellm-a2g-agent already exists; refusing to replace an existing container." >&2
    exit 1
  fi
  docker run -d --name litellm-a2g-agent -p 4000:4000 \
    -v "$(pwd)/litellm-config.yaml:/app/config.yaml:ro" \
    -e "ANTHROPIC_API_KEY=$anthropic_key" \
    ghcr.io/berriai/litellm:main-stable --config /app/config.yaml >/dev/null
  docker run -d --name floci-a2g-agent -p 4568:4566 \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -e FLOCI_SERVICES_BEDROCK_RUNTIME_BACKEND=proxy \
    -e FLOCI_SERVICES_BEDROCK_RUNTIME_PROXY_URL=http://host.docker.internal:4000/v1 \
    -e FLOCI_SERVICES_BEDROCK_RUNTIME_PROXY_MODEL_MAPPING=anthropic.claude-sonnet-5-5-v1:0=claude-sonnet-5-5,anthropic.claude-haiku-5-5-v1:0=claude-haiku-5-5 \
    floci/floci:latest >/dev/null
  echo "floci proxy running on :4568; LiteLLM is on :4000."
else
  # Floci defaults to its fixed ConverseStream stub when no real key is available.
  docker run -d --name floci-a2g-agent -p 4568:4566 \
    -v /var/run/docker.sock:/var/run/docker.sock \
    floci/floci:latest >/dev/null
  echo "floci stub running on :4568 (ANTHROPIC_API_KEY is absent or empty)."
fi
