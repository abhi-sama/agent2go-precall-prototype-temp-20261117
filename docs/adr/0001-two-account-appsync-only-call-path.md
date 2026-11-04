# Two AWS accounts, and AppSync is the only way in

The system spans two AWS accounts.
The FE account holds Amplify Gen2 hosting, Cognito, AppSync and DynamoDB for operational state.
The BE account holds Bedrock, Postgres with pgvector, the BE Lambda(s) and the AgentCore Runtime.
The browser calls only the FE AppSync API, and every AppSync resolver invokes the BE API Lambda cross-account.
That Lambda either queries RLS-scoped Postgres or calls the AgentCore Runtime, whose agent calls Bedrock.
Nothing calls the agent or a model directly, and the same route serves charts, search, briefs, chat and evals.

The captain approved this as the only architecture, so it is a constraint, not a preference.
It keeps every data and AI path behind one identity check and one authorization layer, the BE.
Each new GraphQL field therefore needs three things: a schema entry in `frontend/amplify/data/schema.graphql`, an entry in `BE_FIELDS` (`frontend/amplify/api/resource.ts`), and a resolver in `backend/lambdas/api`.
All BE-backed fields share the resolver code in `frontend/amplify/data/beInvoke.js`.

## Consequences

- The BE Lambda's resource policy must allow the FE AppSync service role (BE CDK, ticket #24).
  The Amplify definition uses `skipPermissions` because the FE account cannot grant it.
- The BE reports typed refusals (`Unauthorized`, `Forbidden`, `NoScope`, `BadRequest`) as a payload envelope, and the shared resolver raises them with `util.error`.
  A thrown Lambda error reaches AppSync as `Lambda:Unhandled` (AWS) or `LambdaExecutionException` (floci), which loses the type the frontend classifies on.
