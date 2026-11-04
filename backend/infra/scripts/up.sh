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

echo "== starting floci"
docker compose up -d floci

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
