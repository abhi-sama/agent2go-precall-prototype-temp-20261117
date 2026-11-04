import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { defineBeApi } from './api/resource';
import { defineFlagsStore } from './storage/resource';

const backend = defineBackend({ auth });

// ARN of the BE account's API Lambda (deployed by backend/infra BE CDK, ticket #24).
const beApiLambdaArn =
  process.env.A2G_BE_API_LAMBDA_ARN ??
  'arn:aws:lambda:us-east-1:222222222222:function:a2g-be-api';

const apiStack = backend.createStack('MslAgentApi');
const api = defineBeApi(apiStack, backend.auth.resources.userPool, {
  beApiLambdaArn,
  localEmulator: process.env.A2G_DEPLOY_TARGET === 'floci',
});

const localEmulator = process.env.A2G_DEPLOY_TARGET === 'floci';
// Fail closed: a real deployment must name the BE account that may assume the flags role.
const beAccountId = process.env.A2G_BE_ACCOUNT_ID ?? (localEmulator ? '222222222222' : undefined);
if (!beAccountId) throw new Error('A2G_BE_ACCOUNT_ID is required outside the local emulator');
defineFlagsStore(apiStack, { beAccountId, localEmulator });

backend.addOutput({
  data: {
    url: api.graphqlUrl,
    aws_region: apiStack.region,
    default_authorization_type: 'AMAZON_COGNITO_USER_POOLS',
    authorization_types: [],
  },
});
