import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { defineBeApi } from './api/resource';

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

backend.addOutput({
  data: {
    url: api.graphqlUrl,
    aws_region: apiStack.region,
    default_authorization_type: 'AMAZON_COGNITO_USER_POOLS',
    authorization_types: [],
  },
});
