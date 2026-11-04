# The agent writes its own outputs to FE DynamoDB through a narrow cross-account role

Generated outputs (briefs, summaries, theme cards, chat history, landing KPI snapshots) are app state, so they live in FE DynamoDB.
The agent persists them itself by assuming a cross-account role in the FE account.
That role can only `PutItem`/`UpdateItem` on the generated-output tables, with items keyed to the requesting user.
It cannot read other users' items, submit CRM records, grant access, or confirm tasks.
Every saved output carries its owner, scope, data-through date, generation time and evidence links, so access is re-checked and staleness flagged on open and on export.

The captain chose this over routing every write back through AppSync.
The narrow role keeps the blast radius equal to "write my own generated output".

Not built in ticket 01: the role, the tables and the write tool belong to tickets #3 and #24.
floci's STS refuses `AssumeRole` to a role that does not exist, so the local path needs the role created in the FE account.
