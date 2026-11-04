# Database lane

`compose.yaml` runs this lane's isolated pgvector container on port `55432`.

```sh
docker compose -f backend/db/compose.yaml up -d
backend/db/scripts/migrate.sh
python3 backend/db/seed/generate.py
```

The source tables preserve the documented raw grain: `crm_call_id` is not a key,
`uniq_rspns_id` is seeded with a duplicate so it must be validated before use,
and roster date-like fields remain text. The seed writes `seed-users.json` for
the Cognito wiring lane. RLS is transaction-local: call
`app.set_request_identity(user_id, persona, correlation_id)` inside each request
transaction while connected as `app_user`.

`004_identity_resolution.sql` adds `app.resolve_user_id(subject)`, the only way the API maps a verified
token subject to a user (matched mappings only). `005_rls_performance.sql` rewrites the source-table
policies so scope is evaluated once per statement instead of once per row. In the integrated local stack
(`backend/infra/scripts/up.sh`) the same migrations and seed run against the BE account's floci RDS
instance, and the provisioner records each seeded user's Cognito subject in `users.identity_subject`.
