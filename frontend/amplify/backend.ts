import { defineBackend } from '@aws-amplify/backend';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { auth } from './auth/resource';
import { defineBeApi } from './api/resource';
import { defineBriefStore, defineChatStore, defineEvalStore, defineFlagsStore } from './storage/resource';

const backend = defineBackend({ auth });

// ARN of the BE account's API Lambda (deployed by backend/infra BE CDK, ticket #24).
const beApiLambdaArn =
  process.env.A2G_BE_API_LAMBDA_ARN ??
  'arn:aws:lambda:us-east-1:222222222222:function:a2g-be-api';

const apiStack = backend.createStack('MslAgentApi');
// Operational state belongs to the FE account. The BE Lambda reaches this table only
// after AppSync has authenticated the caller; its stored partition key is that verified user.
const savedViews = new dynamodb.Table(apiStack, 'SavedViews', {
  partitionKey: { name: 'ownerUserId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'savedViewId', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  encryption: dynamodb.TableEncryption.AWS_MANAGED,
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
});
const api = defineBeApi(apiStack, backend.auth.resources.userPool, {
  beApiLambdaArn,
  localEmulator: process.env.A2G_DEPLOY_TARGET === 'floci',
});

const localEmulator = process.env.A2G_DEPLOY_TARGET === 'floci';
// Fail closed: a real deployment must name the BE account that may assume the flags role.
const beAccountId = process.env.A2G_BE_ACCOUNT_ID ?? (localEmulator ? '222222222222' : undefined);
if (!beAccountId) throw new Error('A2G_BE_ACCOUNT_ID is required outside the local emulator');
defineFlagsStore(apiStack, { beAccountId, localEmulator });
defineChatStore(apiStack, { beAccountId, localEmulator });
defineBriefStore(apiStack, { beAccountId, localEmulator });
defineEvalStore(apiStack, { beAccountId, localEmulator });

backend.addOutput({
  data: {
    url: api.graphqlUrl,
    aws_region: apiStack.region,
    default_authorization_type: 'AMAZON_COGNITO_USER_POOLS',
    authorization_types: [],
    saved_views_table: savedViews.tableName,
  },
});
