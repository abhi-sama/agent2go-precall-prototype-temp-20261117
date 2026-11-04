# The local stack is floci, and Amplify Gen2 deploys into it through offline synth

Everything runs locally on floci (`floci/floci:2.4.0`).
floci emulates both accounts in one container: the account is the 12-digit access key id.
FE `111111111111` is floci's default account, because unsigned browser-facing calls (Cognito sign-in, AppSync with a Bearer token) land in the default account.
BE is `222222222222`.
`backend/infra/scripts/up.sh` brings the whole stack up and seeds it.
Real AWS is never contacted, so `ampx sandbox`, `cdk deploy` and any AWS console sign-in are out.

The Amplify Gen2 backend in `frontend/amplify/` stays the source of truth for AWS.
Locally, the provisioner synthesizes it offline, the same CloudFormation `ampx` would deploy, by running `amplify/backend.ts` with the Amplify CDK context.
It then pushes the file assets to the CDK bootstrap bucket in floci S3 and creates or updates the stack through floci CloudFormation.
`ampx generate outputs` also calls AWS, so `amplify_outputs.json` is written from the stack outputs instead.

## Spike findings (2026-11-04, floci 2.4.0)

| Area | Result |
|---|---|
| Two accounts | Works. Resources are isolated per account; FE cannot see BE RDS or DynamoDB. |
| Cognito | User pool, groups, `USER_SRP_AUTH`, `USER_PASSWORD_AUTH`, and hosted-UI managed login with PKCE S256 (authorize -> login -> code -> token) all work. `RespondToAuthChallenge` requires the `Session` that real Cognito tolerates omitting (Amplify JS sends it). The issuer is `http://floci:4566/<pool>` because of `FLOCI_HOSTNAME`. |
| AppSync | Cognito auth works and invalid tokens get 401. JS and VTL resolvers invoke a Lambda in the other account. Gaps: `ctx.request.headers` is always empty (ADR 0002); an explicit `null` variable crashes the executor, so clients omit null variables; `@aws_cognito_user_pools` without arguments is rejected, so the schema relies on the default auth mode; no subscriptions. |
| Lambda | `python3.12` runs in the AWS base image on the compose network; `AWS_ENDPOINT_URL=http://floci:4566` is injected. |
| RDS Postgres + pgvector | `FLOCI_SERVICES_RDS_DEFAULT_POSTGRES_IMAGE=pgvector/pgvector:pg16` works; `CREATE EXTENSION vector` gives 0.8.7. |
| DynamoDB | Per-account tables work. |
| CloudFormation from Amplify Gen2 | Deploys to `CREATE_COMPLETE` and updates in place, with two adjustments: resolver code is inline (floci rejects `CodeS3Location`), and the AppSync log config is omitted on floci (its CDK `LogRetention` custom resource ignores `AWS_ENDPOINT_URL`). The Cognito identity pool is stubbed. |
| CORS | floci answers no CORS preflights. The browser reaches it through a same-origin Next.js rewrite (`/_floci/*`, local builds only). |
| AgentCore | Stub only; the agent runs as its own local container (ticket #3). |

## Considered options

Hand-provisioning Cognito and AppSync with boto3 was rejected once the spike showed the Amplify stack deploys.
Keeping one definition for local and AWS avoids drift between the two.
