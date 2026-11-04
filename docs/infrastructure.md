# Infrastructure definitions

Ticket #24 defines two account-scoped stacks. They are source definitions only: this repository does
not deploy either stack, and local development remains exclusively on floci.

## Synthesis

The FE definition is Amplify Gen2 in `frontend/amplify/`; the local provisioner invokes it with an
offline CDK context. The BE definition is the CDK app in `backend/cdk/`.

```bash
(cd frontend && pnpm exec tsx amplify/backend.ts) # offline FE synthesis context is set by the provisioner
(cd backend/cdk && pnpm install --frozen-lockfile && pnpm synth)
```

`backend/cdk` uses Docker only to package the Python Lambda asset during synthesis. It does not call
AWS, create a stack, or use credentials. Do not run `cdk deploy`, `ampx sandbox`, or an AWS login in
this phase.

The BE template has CloudFormation parameters for the FE account, AppSync API ID/URL, Cognito issuer
and app client. A deployment pipeline must provide values emitted by the reviewed FE stack. It must
also replace the synth-only `AgentImageUri` default, create the non-owner `app_user` from the generated
application secret, and run the existing database migrations; migration `001_source_schema.sql` enables
the `vector` extension.

## Least-privilege cross-account boundary

| Principal | Grant | Exact scope |
| --- | --- | --- |
| FE AppSync service | Invoke BE API Lambda | The one FE account and one AppSync API ARN only; the Lambda permission has both `SourceAccount` and `SourceArn`. |
| BE API Lambda (`a2g-be-api`) | Assume FE flags role | Only `arn:aws:iam::<FE account>:role/a2g-be-flags`; the FE role itself only writes/queries the flags table. |
| BE AgentCore runtime (`a2g-agent-runtime`) | Assume FE chat writer role | Only `arn:aws:iam::<FE account>:role/a2g-agent-chat-writer`; the FE role can only put/update the chat table. |
| BE API Lambda (`a2g-be-api`) | Assume FE briefs role; invoke the AgentCore runtime | Only `role/a2g-be-briefs` (GetItem, Query, UpdateItem on the briefs table) and `InvokeAgentRuntime` on the one runtime, so it can generate a brief and reopen or edit the caller's own. |
| BE AgentCore runtime (`a2g-agent-runtime`) | Assume FE brief writer role | Only `role/a2g-agent-brief-writer`; the FE role can only `PutItem` on the briefs table. |
| BE chat worker (`a2g-be-chat`) | AppSync GraphQL | Only the `publishChatEvent` mutation field on the one FE API. |

The API and chat worker receive only the non-owner Postgres credential and can reach the private
database security group. The AgentCore role can invoke only the approved Sonnet and Haiku Bedrock model
ARNs, and cannot invoke AppSync or DynamoDB directly. The browser has no IAM authorization path: its
normal calls remain Cognito-authenticated. `publishChatEvent` is IAM-only and is a server-to-server
subscription bridge; floci keeps the documented polling stand-in.

## Future Okta federation

Cognito is the application issuer and remains the token verifier for the BE. The FE definition creates
the `MSL`, `Director`, `Executive`, and `Administrator` groups now; group membership supplies the
persona, while Postgres effective-dated scope supplies authorization.

When Okta is approved, add it as an OIDC provider to the same Cognito user pool, with the authorization
code flow and PKCE. Keep Cognito as the callback/token issuer, map Okta `sub`, `name`, and `email` to
Cognito's immutable subject and standard `name`/`email` claims, and map personas through Cognito groups
only. Store the Okta client secret in the deployment secret manager—not source, an Amplify environment
file, browser configuration, or logs. The BE continues to verify Cognito's ID token (issuer, JWKS,
audience, expiry, and `token_use=id`); token claims continue to win over request fields. No territory,
permission, or RLS scope may be sourced from Okta claims.
