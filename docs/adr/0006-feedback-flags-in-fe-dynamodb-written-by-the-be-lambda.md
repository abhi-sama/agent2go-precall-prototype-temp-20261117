# Feedback flags live in FE DynamoDB and the BE Lambda is their only writer

A user can flag an incorrect summary, identifier or territory assignment and see its review status.
Flags are operational state, so they are stored in the FE account's DynamoDB table `a2g-feedback-flags`, not in BE Postgres.

The browser still calls only AppSync, and the `flagIssue` mutation and `myFlags` query still go to the BE API Lambda (ADR 0001).
The Lambda verifies the token (ADR 0002), checks under RLS that the flagged call, HCP or territory is one the caller may see (ADR 0003), and then writes to FE DynamoDB.
It does that the same way the agent will write its outputs (ADR 0005): by assuming a narrow role in the FE account, `a2g-be-flags`, which can only `PutItem` and `Query` that table.
It cannot edit, delete or scan.

## Shape

- Item key: partition `USER#<userId>`, sort `FLAG#<createdAt>#<flagId>`. The user id comes from the verified identity, never from the request.
- Attributes: `kind` (`SUMMARY`, `IDENTIFIER`, `TERRITORY_ASSIGNMENT`), `targetType` (`SUMMARY`, `CALL`, `HCP`, `TERRITORY`), `targetId`, optional `note`, `status`, `createdAt`, `updatedAt`, and the scope label and data-through date at flagging time, like any saved output.
- Status is `OPEN`, `IN_REVIEW`, `RESOLVED` or `DISMISSED`. A new flag is `OPEN`. The review workflow that moves it on belongs to the admin tickets (#15, #17); until then the status is changed in the table directly, and the API shows whatever is stored.
- Reads are a query on the caller's own partition, so flags are private to their owner.
- Flagging the same open item again returns the existing flag, so a double tap does not file two reports.
- A target that is absent and a target that is out of scope are refused identically (`BadRequest`), so the mutation is not an oracle for records the caller may not see. Summaries are saved AI outputs held in FE DynamoDB, so their reference is checked for shape only.

## Consequences

- `a2g-be-flags` trusts only the BE API Lambda's execution role (`a2g-be-api` in the BE account), not the whole BE account, and the deploy fails if `A2G_BE_ACCOUNT_ID` is missing outside floci. That execution role needs `sts:AssumeRole` on `a2g-be-flags`. Both the table and the role are defined in `frontend/amplify/storage/resource.ts`, so floci and AWS deploy the same definition. The BE CDK (ticket #24) adds the Lambda-side permission.
- The free-text note can describe an HCP. It is stored and returned to its owner but never logged; logs carry the flag id, kind and status only.
- Locally, floci's STS honours `AssumeRole` across its two emulated accounts, so the write path is the real one, not a stand-in.
