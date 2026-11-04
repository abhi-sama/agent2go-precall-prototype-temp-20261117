# agent2go: MSL Agent

An iPad-first web app giving Medical Science Liaisons, Directors, Executives and Data/Security Administrators a role-specific workspace over five medical-affairs datasets.
Every number, search and AI answer is limited to the viewer's effective-dated territory scope.
The requirements are transcribed in [docs/requirements.md](docs/requirements.md), the spec is issue #1, and vocabulary is in [GLOSSARY.md](GLOSSARY.md).

## Run it locally

Everything runs on your machine.
[floci](https://floci.io/floci/) emulates both AWS accounts; nothing contacts real AWS.

Prerequisites: Docker, [uv](https://docs.astral.sh/uv/), pnpm, Node 20+, and `psql`.

```bash
backend/infra/scripts/up.sh                      # start floci, provision both accounts, seed (about 1 min the first time)
cd frontend && pnpm dev --port 3210              # http://localhost:3210
backend/infra/scripts/test.sh                    # every test: unit, DB, API-as-persona, stack e2e, local-only build check
backend/infra/scripts/down.sh                    # stop the stack
```

Sign in at `/login` as any seeded user.
The local build shows a one-tap list of seeded users, and the header has a persona quick-switch.
The shared local password is `custom.a2g.local_password` in the generated `frontend/amplify_outputs.json`.
Both exist only in local builds.

Without the stack, `cd frontend && pnpm dev` runs the UI against fixtures (`NEXT_PUBLIC_DATA_ADAPTER=mock`).

## How a request flows

```
browser ──(Cognito ID token, x-user-full-name, x-user-email, x-correlation-id)──▶ FE AppSync (Cognito auth)
   FE account 111111111111                                                        │ JS resolver (beInvoke.js)
                                                                                  ▼
   BE account 222222222222                                    BE API Lambda (backend/lambdas/api)
                                                    verify token · claims win · map login → user
                                                    BEGIN; app.set_request_identity(...); query; COMMIT
                                                                                  ▼
                                                    Postgres 16 + pgvector, RLS on every table
```

Chat follows the same route to the AgentCore Runtime agent (`backend/agent`), which calls Bedrock (ticket #3).
The decisions behind this are in [docs/adr/](docs/adr/).

## Repository layout

| Path | What |
|---|---|
| `frontend/` | Next.js App Router app (TypeScript, Tailwind, shadcn/ui, React Three Fiber, ECharts) |
| `frontend/amplify/` | Amplify Gen2 backend: Cognito (persona groups) and the AppSync API whose resolvers call the BE Lambda |
| `backend/lambdas/api/` | BE API Lambda: token verification, claims-win identity, RLS-scoped resolvers |
| `backend/libs/a2g_logging/` | Structured JSON logging with allowlist redaction, for every Python service |
| `backend/db/` | Migrations (source schema, application schema, RLS), deterministic synthetic seed, seed-users manifest |
| `backend/agent/` | Strands agent speaking AG-UI, AgentCore Runtime contract |
| `backend/infra/` | Local stack: floci compose file and the provisioner (`a2g-provision`) |
| `tests/api/` | API-as-persona harness and tests: seeded users sign in and call AppSync |
| `docs/` | Requirements, ADRs, feature map |

## Local stack details

- `up.sh` is idempotent and reseeds the database deterministically on every run (`--skip-seed` keeps it).
  It deploys the Amplify Gen2 stack into floci CloudFormation, builds and deploys the BE Lambda, and creates one Cognito user per entry in `backend/db/seed-users.json`.
  It then writes `frontend/.env.local`, `frontend/amplify_outputs.json` and `backend/infra/.state/outputs.json`, all gitignored.
- Ports: floci `4566`, BE Postgres via the RDS proxy on `7001`, web `3210`, stack e2e `3211`.
- Where floci differs from AWS, the local stand-in is documented in [ADR 0004](docs/adr/0004-floci-local-stack-and-amplify-deploy-path.md).

## Logging

Every service logs one JSON object per line: `ts`, `level`, `msg`, `correlation_id`, `service`, plus allowlisted id, count and enum fields.
Tokens, emails, names and HCP free text never reach a log line.
This is enforced by allowlists (`backend/libs/a2g_logging`, `frontend/src/lib/log/logger.ts`) and proven by unit tests and by `tests/api/test_logging.py` against real Lambda output.

## Building a feature

See [docs/feature-map.md](docs/feature-map.md) for the remaining slices and the steps every data-backed field follows.
