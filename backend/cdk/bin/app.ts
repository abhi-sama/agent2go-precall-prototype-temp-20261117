import * as cdk from 'aws-cdk-lib';
import { BackendStack } from '../lib/backend-stack.js';

const app = new cdk.App();

// Keep synthesis environment-agnostic and offline. A real deployment supplies
// CDK_DEFAULT_ACCOUNT/CDK_DEFAULT_REGION and the FE parameters documented in docs/infrastructure.md.
new BackendStack(app, 'MslAgentBackend');
