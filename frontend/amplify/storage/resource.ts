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
