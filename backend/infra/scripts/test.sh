#!/usr/bin/env bash
# Run every foundation test against the local stack (start it first with up.sh).
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
export DATABASE_URL=$(python3 -c "import json;print(json.load(open('$REPO/backend/infra/.state/outputs.json'))['be']['owner_dsn'])")

echo "== logging redaction (unit)"
(cd "$REPO/backend/libs/a2g_logging" && uv run --quiet pytest -q)
echo "== BE API Lambda (unit)"
(cd "$REPO/backend/lambdas/api" && uv run --quiet pytest -q)
echo "== territory geography data (unit)"
python3 -m unittest discover -s "$REPO/backend/db/tests" -q
echo "== agent (unit; the floci stub fallback test starts a throwaway floci)"
(cd "$REPO/backend/agent" && uv run --quiet pytest -q)
echo "== database schema, RLS and seed (reseeds the database)"
bash "$REPO/backend/db/tests/test_database.sh"
echo "== restoring the login-to-user mapping the reseed cleared"
(cd "$REPO/backend/infra" && uv run --quiet a2g-provision --skip-seed >/dev/null)
echo "== API-as-persona (Cognito sign-in -> AppSync -> BE Lambda -> RLS Postgres)"
(cd "$REPO/tests" && uv run --quiet pytest -q -p no:warnings)
echo "== frontend (typecheck, lint, unit)"
(cd "$REPO/frontend" && pnpm --silent check)
echo "== frontend against the stack (real Cognito sign-in, quick-switch) at an iPad viewport"
(cd "$REPO/frontend" && pnpm --silent test:e2e:stack)
echo "== persona quick-switch and seeded users are absent from a deployed-style build"
(cd "$REPO/frontend" && pnpm --silent check:local-only)
