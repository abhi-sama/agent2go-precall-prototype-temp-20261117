import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Stack } from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'data');

/** Fields served by the BE account. Add a field here when the contract grows. */
export const BE_FIELDS = [
  { typeName: 'Query', fieldName: 'me' },
  { typeName: 'Query', fieldName: 'landingKpis' },
  { typeName: 'Query', fieldName: 'geoActivity' },
  { typeName: 'Query', fieldName: 'activityTrends' },
  { typeName: 'Query', fieldName: 'activityEvidence' },
  { typeName: 'Query', fieldName: 'directorOverview' },
  { typeName: 'Query', fieldName: 'territoryComparison' },
  { typeName: 'Query', fieldName: 'executiveOverview' },
  { typeName: 'Query', fieldName: 'executiveDrilldown' },
  { typeName: 'Query', fieldName: 'topicHeatmap' },
  { typeName: 'Query', fieldName: 'questionAnalytics' },
  { typeName: 'Query', fieldName: 'emergingTopics' },
  { typeName: 'Query', fieldName: 'directorDrilldown' },
  { typeName: 'Query', fieldName: 'directorExceptions' },
  { typeName: 'Query', fieldName: 'territorySummaryEvidence' },
  { typeName: 'Query', fieldName: 'myFlags' },
  { typeName: 'Query', fieldName: 'adminAccessOverview' },
  { typeName: 'Query', fieldName: 'accessAudit' },
  { typeName: 'Query', fieldName: 'searchHcps' },
  { typeName: 'Query', fieldName: 'hcpProfile' },
  { typeName: 'Query', fieldName: 'adminDataQuality' },
  { typeName: 'Query', fieldName: 'adminIngestionRuns' },
  { typeName: 'Query', fieldName: 'authorizationVerificationGrid' },
  { typeName: 'Query', fieldName: 'hcpTimeline' },
  { typeName: 'Query', fieldName: 'adminMetadataReconciliation' },
  { typeName: 'Query', fieldName: 'adminDefinitions' },
  { typeName: 'Query', fieldName: 'governanceRequestQueue' },
  { typeName: 'Query', fieldName: 'adminIssueAssistant' },
  { typeName: 'Mutation', fieldName: 'flagIssue' },
  { typeName: 'Query', fieldName: 'chatEvents' },
  { typeName: 'Query', fieldName: 'myChatHistory' },
  { typeName: 'Query', fieldName: 'chatCitation' },
  { typeName: 'Query', fieldName: 'chatAnswerRows' },
  { typeName: 'Mutation', fieldName: 'exportChatRows' },
  { typeName: 'Mutation', fieldName: 'startChatRun' },
  { typeName: 'Mutation', fieldName: 'approveIdentityMapping' },
  { typeName: 'Mutation', fieldName: 'setRolePermissions' },
  { typeName: 'Mutation', fieldName: 'createScopeAssignment' },
  { typeName: 'Query', fieldName: 'insightDiscovery' },
  { typeName: 'Query', fieldName: 'mslInsightResponses' },
  { typeName: 'Query', fieldName: 'semanticInsightSearch' },
  { typeName: 'Query', fieldName: 'savedViews' },
  { typeName: 'Mutation', fieldName: 'saveView' },
  { typeName: 'Query', fieldName: 'myAppearance' },
  { typeName: 'Mutation', fieldName: 'setAppearance' },
  { typeName: 'Query', fieldName: 'adminHierarchy' },
  { typeName: 'Query', fieldName: 'adminAccessTimeline' },
  { typeName: 'Mutation', fieldName: 'requestScopeChange' },
  { typeName: 'Mutation', fieldName: 'decideScopeChange' },
  { typeName: 'Query', fieldName: 'adminVisibility' },
  { typeName: 'Mutation', fieldName: 'setCatalogVisibility' },
  { typeName: 'Mutation', fieldName: 'setResponseAccess' },
  { typeName: 'Mutation', fieldName: 'createDefinition' },
  { typeName: 'Mutation', fieldName: 'approveDefinition' },
  { typeName: 'Mutation', fieldName: 'createGovernanceRequest' },
  { typeName: 'Mutation', fieldName: 'decideGovernanceRequest' },
  { typeName: 'Query', fieldName: 'catalogQuestions' },
  { typeName: 'Query', fieldName: 'questionResponses' },
  { typeName: 'Query', fieldName: 'postCallDrafts' },
  { typeName: 'Query', fieldName: 'myFollowUpTasks' },
  { typeName: 'Query', fieldName: 'topicAlertRules' },
  { typeName: 'Query', fieldName: 'topicAlerts' },
  { typeName: 'Mutation', fieldName: 'createPostCallDraft' },
  { typeName: 'Mutation', fieldName: 'confirmPostCallDraft' },
  { typeName: 'Mutation', fieldName: 'confirmFollowUpTasks' },
  { typeName: 'Mutation', fieldName: 'createTopicAlertRule' },
  { typeName: 'Query', fieldName: 'preCallBrief' },
  { typeName: 'Query', fieldName: 'myBriefs' },
  { typeName: 'Mutation', fieldName: 'generateBrief' },
  { typeName: 'Mutation', fieldName: 'saveBriefEdits' },
  { typeName: 'Mutation', fieldName: 'exportBrief' },
  { typeName: 'Query', fieldName: 'evalSuites' },
  { typeName: 'Query', fieldName: 'evalRuns' },
  { typeName: 'Query', fieldName: 'evalRun' },
  { typeName: 'Query', fieldName: 'evalRunDiff' },
  { typeName: 'Query', fieldName: 'evalRatings' },
  { typeName: 'Mutation', fieldName: 'startEvalRun' },
  { typeName: 'Mutation', fieldName: 'rateAnswer' },
  { typeName: 'Query', fieldName: 'executiveThemes' },
  { typeName: 'Query', fieldName: 'executiveTopicMatrix' },
  { typeName: 'Query', fieldName: 'executiveTrends' },
  { typeName: 'Query', fieldName: 'leadershipSummary' },
  { typeName: 'Query', fieldName: 'myLeadershipSummaries' },
  { typeName: 'Mutation', fieldName: 'generateLeadershipSummary' },
  { typeName: 'Mutation', fieldName: 'exportLeadershipSummary' },
] as const;

/**
 * FE AppSync API whose only data source is the BE account's API Lambda.
 * This is the approved call path: browser -> FE AppSync -> cross-account BE Lambda.
 */
export interface BeApiOptions {
  /** ARN of the BE account's API Lambda. */
  beApiLambdaArn: string;
  /** True when deploying into the floci emulator instead of AWS. */
  localEmulator: boolean;
}

export function defineBeApi(stack: Stack, userPool: cognito.IUserPool, options: BeApiOptions) {
  const api = new appsync.GraphqlApi(stack, 'MslAgentApi', {
    name: 'msl-agent-api',
    definition: appsync.Definition.fromFile(path.join(dataDir, 'schema.graphql')),
    authorizationConfig: {
      defaultAuthorization: {
        authorizationType: appsync.AuthorizationType.USER_POOL,
        userPoolConfig: { userPool },
      },
      // The chat worker uses SigV4 for the one server-to-server publish mutation.
      // Browser reads and all user mutations remain Cognito-authenticated.
      additionalAuthorizationModes: [{ authorizationType: appsync.AuthorizationType.IAM }],
    },
    // ERROR level never writes request/response bodies (no tokens, names, or HCP text).
    // logConfig adds a CDK LogRetention custom resource whose bundled SDK ignores
    // AWS_ENDPOINT_URL, so the floci deploy omits it (see docs/adr/0004).
    logConfig: options.localEmulator
      ? undefined
      : { fieldLogLevel: appsync.FieldLogLevel.ERROR, excludeVerboseContent: true },
    xrayEnabled: true,
  });

  // The BE Lambda lives in another account. Its resource policy (BE CDK, ticket #24)
  // must allow this API's service role; skipPermissions keeps CDK from trying to
  // add that policy from the FE account.
  const beFn = lambda.Function.fromFunctionAttributes(stack, 'BeApiLambda', {
    functionArn: options.beApiLambdaArn,
    sameEnvironment: false,
    skipPermissions: true,
  });
  const ds = api.addLambdaDataSource('BeApiLambda', beFn);

  // Inline code (not an S3 asset): identical in AWS, and floci's CloudFormation
  // only accepts inline resolver code.
  const code = appsync.Code.fromInline(readFileSync(path.join(dataDir, 'beInvoke.js'), 'utf8'));
  for (const { typeName, fieldName } of BE_FIELDS) {
    ds.createResolver(`${typeName}${fieldName}Resolver`, {
      typeName,
      fieldName,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code,
    });
  }

  // In AWS, the BE chat worker publishes an already-persisted event with its narrow IAM role.
  // floci has no subscriptions, so local clients continue polling chatEvents (ADR 0007).
  const chatPublisher = api.addNoneDataSource('ChatEventPublisher');
  chatPublisher.createResolver('PublishChatEventResolver', {
    typeName: 'Mutation',
    fieldName: 'publishChatEvent',
    runtime: appsync.FunctionRuntime.JS_1_0_0,
    code: appsync.Code.fromInline(`
      export function request(ctx) { return { payload: ctx.args.input }; }
      export function response(ctx) { return ctx.result; }
    `),
  });
  return api;
}
