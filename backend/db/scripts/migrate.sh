#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:=postgresql://postgres:postgres@localhost:55432/agent2go}"
for migration in "$(dirname "$0")"/../migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
