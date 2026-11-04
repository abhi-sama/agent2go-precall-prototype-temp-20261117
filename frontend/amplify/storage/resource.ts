import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';

/** Fixed names: the BE Lambda is configured with them (A2G_FLAGS_TABLE / A2G_FLAGS_ROLE_ARN). */
export const FLAGS_TABLE_NAME = 'a2g-feedback-flags';
export const FLAGS_ROLE_NAME = 'a2g-be-flags';
/** Execution role of the BE API Lambda (created by the BE CDK, ticket #24; same name locally). */
export const BE_API_ROLE_NAME = 'a2g-be-api';

export interface FlagsStoreOptions {
  /** Account that owns the BE API Lambda. Only that Lambda's execution role may assume the flags role. */
  beAccountId: string;
  /** True when deploying into the floci emulator instead of AWS. */
  localEmulator: boolean;
}

/**
 * FE DynamoDB table for feedback flags (docs/adr/0006), plus the narrow role the BE API
 * Lambda assumes to use it. The BE verifies the caller and the flagged record first; the
 * role can only add items and read by partition key, so it cannot edit, delete or scan.
 *
 * Item shape: pk `USER#<userId>`, sk `FLAG#<createdAt>#<flagId>`.
 */
export function defineFlagsStore(stack: Stack, options: FlagsStoreOptions) {
  const table = new dynamodb.Table(stack, 'FeedbackFlags', {
    tableName: FLAGS_TABLE_NAME,
    partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    removalPolicy: options.localEmulator ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
  });

  const role = new iam.Role(stack, 'BeFlagsRole', {
    roleName: FLAGS_ROLE_NAME,
    // Trust the one execution role, not the whole BE account: other BE workloads cannot assume it.
    assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${options.beAccountId}:role/${BE_API_ROLE_NAME}`),
    description: 'Assumed by the BE API Lambda to read and add feedback flags. Nothing else.',
  });
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: ['dynamodb:PutItem', 'dynamodb:Query'],
      resources: [table.tableArn],
    }),
  );
  return { table, role };
}

/** Fixed names: the agent container is configured with them (A2G_FE_CHAT_TABLE / A2G_FE_WRITE_ROLE_ARN). */
export const CHAT_TABLE_NAME = 'a2g-chat-turns';
export const CHAT_WRITER_ROLE_NAME = 'a2g-agent-chat-writer';
/** Execution role of the AgentCore agent (created by the BE CDK, ticket #24). */
export const AGENT_ROLE_NAME = 'a2g-agent-runtime';

export interface ChatStoreOptions {
  beAccountId: string;
  localEmulator: boolean;
}

/**
 * FE DynamoDB table for conversation turns, written by the agent itself through a narrow role
 * (docs/adr/0005, 0007). The role can only put or update items: it cannot read, scan or delete, so
 * the agent can never read anyone's history. Items are keyed `USER#<userId>` / `THREAD#...`.
 */
export function defineChatStore(stack: Stack, options: ChatStoreOptions) {
  const table = new dynamodb.Table(stack, 'ChatTurns', {
    tableName: CHAT_TABLE_NAME,
    partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    timeToLiveAttribute: 'expires_at',
    removalPolicy: options.localEmulator ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
  });

  const role = new iam.Role(stack, 'AgentChatWriterRole', {
    roleName: CHAT_WRITER_ROLE_NAME,
    assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${options.beAccountId}:role/${AGENT_ROLE_NAME}`),
    description: 'Assumed by the agent to save its own conversation turns. Nothing else.',
  });
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
      resources: [table.tableArn],
    }),
  );
  return { table, role };
}

/** Fixed names: the BE API Lambda and the agent container are configured with them (A2G_BRIEFS_* / A2G_FE_BRIEF_*). */
export const BRIEFS_TABLE_NAME = 'a2g-precall-briefs';
export const BRIEF_WRITER_ROLE_NAME = 'a2g-agent-brief-writer';
export const BRIEF_READER_ROLE_NAME = 'a2g-be-briefs';

export interface BriefStoreOptions {
  beAccountId: string;
  localEmulator: boolean;
}

/**
 * FE DynamoDB table for pre-call briefs (docs/adr/0009). Two narrow roles, one job each:
 * the agent writes a finished brief (PutItem only, so it can neither read nor change anyone's),
 * and the BE API Lambda reads a user's own partition and saves their edits (GetItem, Query,
 * UpdateItem; it cannot create, replace, delete or scan).
 *
 * Item shape: pk `USER#<userId>`, sk `BRIEF#<briefId>` (briefIds sort by creation time).
 */
export function defineBriefStore(stack: Stack, options: BriefStoreOptions) {
  const table = new dynamodb.Table(stack, 'PreCallBriefs', {
    tableName: BRIEFS_TABLE_NAME,
    partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    timeToLiveAttribute: 'expires_at',
    removalPolicy: options.localEmulator ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
  });

  const writer = new iam.Role(stack, 'AgentBriefWriterRole', {
    roleName: BRIEF_WRITER_ROLE_NAME,
    assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${options.beAccountId}:role/${AGENT_ROLE_NAME}`),
    description: 'Assumed by the agent to save a finished pre-call brief. Nothing else.',
  });
  writer.addToPolicy(new iam.PolicyStatement({ actions: ['dynamodb:PutItem'], resources: [table.tableArn] }));

  const reader = new iam.Role(stack, 'BeBriefsRole', {
    roleName: BRIEF_READER_ROLE_NAME,
    assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${options.beAccountId}:role/${BE_API_ROLE_NAME}`),
    description: 'Assumed by the BE API Lambda to reopen a user\'s briefs and save their edits. Nothing else.',
  });
  reader.addToPolicy(
    new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:UpdateItem'],
      resources: [table.tableArn],
    }),
  );
  return { table, writer, reader };
}
