import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..', '..');

/** BE-account infrastructure. This stack only synthesizes; local execution remains on floci. */
export class BackendStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const feAccountId = new cdk.CfnParameter(this, 'FeAccountId', {
      type: 'String',
      description: 'AWS account that owns the Amplify FE stack.',
      allowedPattern: '^\\d{12}$',
    });
    const feAppSyncApiId = new cdk.CfnParameter(this, 'FeAppSyncApiId', {
      type: 'String',
      description: 'The FE AppSync API ID. Obtained from the synthesized Amplify stack output.',
    });
    const feAppSyncUrl = new cdk.CfnParameter(this, 'FeAppSyncUrl', {
      type: 'String',
      description: 'The FE AppSync GraphQL URL used by the BE worker to publish live chat events.',
    });
    const cognitoIssuer = new cdk.CfnParameter(this, 'CognitoIssuer', {
      type: 'String',
      description: 'Issuer URL of the FE Cognito user pool.',
    });
    const cognitoClientId = new cdk.CfnParameter(this, 'CognitoClientId', {
      type: 'String',
      description: 'App client ID of the FE Cognito user pool.',
    });
    const agentImageUri = new cdk.CfnParameter(this, 'AgentImageUri', {
      type: 'String',
      default: '000000000000.dkr.ecr.us-east-1.amazonaws.com/a2g-agent:local-synth-only',
      description: 'ECR image URI for the AgentCore runtime. Replace the synth-only default before deployment.',
    });

    const vpc = new ec2.Vpc(this, 'BackendVpc', {
      // Fn::GetAZs stays deploy-time data, so an offline synth never needs AWS credentials.
      availabilityZones: [
        cdk.Fn.select(0, cdk.Fn.getAzs()),
        cdk.Fn.select(1, cdk.Fn.getAzs()),
      ],
      natGateways: 1,
      subnetConfiguration: [
        // NAT is the only public surface; no application or database resource receives a public IP.
        { name: 'ingress', subnetType: ec2.SubnetType.PUBLIC },
        { name: 'application', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        { name: 'database', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    });
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'BE API and chat worker outbound access; database ingress is granted separately.',
      allowAllOutbound: true,
    });
    const agentSecurityGroup = new ec2.SecurityGroup(this, 'AgentRuntimeSecurityGroup', {
      vpc,
      description: 'AgentCore runtime access to Postgres only.',
      allowAllOutbound: true,
    });
    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: 'Postgres accepts application connections only from BE compute.',
      allowAllOutbound: false,
    });
    databaseSecurityGroup.addIngressRule(lambdaSecurityGroup, ec2.Port.tcp(5432), 'BE Lambdas to Postgres');
    databaseSecurityGroup.addIngressRule(agentSecurityGroup, ec2.Port.tcp(5432), 'Agent runtime to Postgres');

    const appDatabaseSecret = new secretsmanager.Secret(this, 'ApplicationDatabaseSecret', {
      description: 'Credentials for the non-owner app_user Postgres login. Created by the deployment migration.',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'app_user' }),
        generateStringKey: 'password',
        excludePunctuation: true,
      },
    });
    const database = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_6 }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      credentials: rds.Credentials.fromGeneratedSecret('a2g_admin'),
      databaseName: 'agent2go',
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
      allocatedStorage: 100,
      storageEncrypted: true,
      publiclyAccessible: false,
      multiAz: true,
      backupRetention: Duration.days(7),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    // CloudFormation resolves the generated password at deployment time; no credential is committed
    // to source or appears in the synthesized template. The deployment migration creates app_user.
    const applicationDsn = cdk.Fn.join('', [
      'postgresql://app_user:', appDatabaseSecret.secretValueFromJson('password').unsafeUnwrap(),
      '@', database.dbInstanceEndpointAddress, ':', database.dbInstanceEndpointPort, '/agent2go',
    ]);

    const apiRole = new iam.Role(this, 'ApiRole', {
      roleName: 'a2g-be-api',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')],
      description: 'BE API Lambda: RLS-scoped reads, flag write role assumption, and chat-worker invocation.',
    });
    const workerRole = new iam.Role(this, 'ChatWorkerRole', {
      roleName: 'a2g-be-chat',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')],
      description: 'BE chat worker: invokes AgentCore and publishes only live chat events to FE AppSync.',
    });
    const agentRole = new iam.Role(this, 'AgentRuntimeRole', {
      roleName: 'a2g-agent-runtime',
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'AgentCore runtime: invokes approved Bedrock models and assumes only the FE chat-write role.',
    });

    const flagsRoleArn = Stack.of(this).formatArn({
      service: 'iam', account: feAccountId.valueAsString, region: '', resource: 'role/a2g-be-flags',
    });
    const chatWriterRoleArn = Stack.of(this).formatArn({
      service: 'iam', account: feAccountId.valueAsString, region: '', resource: 'role/a2g-agent-chat-writer',
    });
    const chatReaderRoleArn = Stack.of(this).formatArn({
      service: 'iam', account: feAccountId.valueAsString, region: '', resource: 'role/a2g-be-chat-history',
    });
    const briefsReaderRoleArn = Stack.of(this).formatArn({
      service: 'iam', account: feAccountId.valueAsString, region: '', resource: 'role/a2g-be-briefs',
    });
    const briefWriterRoleArn = Stack.of(this).formatArn({
      service: 'iam', account: feAccountId.valueAsString, region: '', resource: 'role/a2g-agent-brief-writer',
    });
    apiRole.addToPolicy(new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: [flagsRoleArn, briefsReaderRoleArn, chatReaderRoleArn] }));
    agentRole.addToPolicy(new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: [chatWriterRoleArn, briefWriterRoleArn] }));

    const apiCode = lambda.Code.fromAsset(backendRoot, {
      exclude: ['**/.venv/**', '**/__pycache__/**', '**/.pytest_cache/**', 'infra/build/**'],
      bundling: {
        image: lambda.Runtime.PYTHON_3_12.bundlingImage,
        command: [
          'bash', '-c',
          [
            "python -m pip install --no-cache-dir --target /asset-output 'psycopg[binary]>=3.2' 'pyjwt[crypto]>=2.9'",
            'cp -R /asset-input/lambdas/api/src/a2g_api /asset-output/a2g_api',
            'cp -R /asset-input/libs/a2g_logging/src/a2g_logging /asset-output/a2g_logging',
          ].join(' && '),
        ],
      },
    });
    const commonEnvironment = {
      A2G_ENV: 'aws',
      A2G_COGNITO_ISSUER: cognitoIssuer.valueAsString,
      A2G_COGNITO_CLIENT_IDS: cognitoClientId.valueAsString,
      A2G_DB_DSN: applicationDsn,
    };
    const api = new lambda.Function(this, 'ApiFunction', {
      functionName: 'a2g-be-api',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'a2g_api.handler.handler',
      code: apiCode,
      role: apiRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSecurityGroup],
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        ...commonEnvironment,
        A2G_CHAT_WORKER_FUNCTION: 'a2g-be-chat',
        // Pre-call briefs (docs/adr/0009): the API Lambda calls the agent, then reopens the brief it saved.
        A2G_AGENT_RUNTIME_ARN: cdk.Fn.getAtt('AgentRuntime', 'AgentRuntimeArn').toString(),
        A2G_BRIEFS_TABLE: 'a2g-precall-briefs',
        A2G_BRIEFS_ROLE_ARN: briefsReaderRoleArn,
        A2G_CHAT_HISTORY_TABLE: 'a2g-chat-turns',
        A2G_CHAT_HISTORY_ROLE_ARN: chatReaderRoleArn,
      },
    });
    const worker = new lambda.Function(this, 'ChatWorkerFunction', {
      functionName: 'a2g-be-chat',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'a2g_api.chat_worker.handler',
      code: apiCode,
      role: workerRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSecurityGroup],
      timeout: Duration.minutes(5),
      memorySize: 512,
      environment: {
        ...commonEnvironment,
        A2G_AGENT_RUNTIME_ARN: cdk.Fn.getAtt('AgentRuntime', 'AgentRuntimeArn').toString(),
        A2G_FE_APPSYNC_URL: feAppSyncUrl.valueAsString,
      },
    });
    api.grantInvoke(worker);

    const feApiArn = Stack.of(this).formatArn({
      service: 'appsync', account: feAccountId.valueAsString, resource: 'apis', resourceName: feAppSyncApiId.valueAsString,
    });
    api.addPermission('AllowOnlyFeAppSync', {
      principal: new iam.ServicePrincipal('appsync.amazonaws.com'),
      sourceAccount: feAccountId.valueAsString,
      sourceArn: feApiArn,
    });
    workerRole.addToPolicy(new iam.PolicyStatement({
      actions: ['appsync:GraphQL'],
      resources: [`${feApiArn}/types/Mutation/fields/publishChatEvent`],
    }));

    const modelArns = [
      'arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-5-5-v1:0',
      'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-5-5-v1:0',
    ];
    agentRole.addToPolicy(new iam.PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: modelArns }));

    const agentRuntime = new agentcore.CfnRuntime(this, 'AgentRuntime', {
      agentRuntimeName: 'a2g-agent-runtime',
      description: 'MSL Agent Strands runtime; invoked only by the BE chat worker.',
      roleArn: agentRole.roleArn,
      agentRuntimeArtifact: { containerConfiguration: { containerUri: agentImageUri.valueAsString } },
      environmentVariables: {
        DATABASE_URL: applicationDsn,
        A2G_FE_WRITE_ROLE_ARN: chatWriterRoleArn,
        A2G_FE_CHAT_TABLE: 'a2g-chat-turns',
        A2G_FE_BRIEF_WRITE_ROLE_ARN: briefWriterRoleArn,
        A2G_FE_BRIEF_TABLE: 'a2g-precall-briefs',
      },
      networkConfiguration: {
        networkMode: 'VPC',
        networkModeConfig: {
          subnets: vpc.privateSubnets.map((subnet) => subnet.subnetId),
          securityGroups: [agentSecurityGroup.securityGroupId],
        },
      },
    });
    for (const role of [workerRole, apiRole]) {
      role.addToPolicy(new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [agentRuntime.attrAgentRuntimeArn],
      }));
    }
    new cdk.CfnOutput(this, 'ApiFunctionArn', { value: api.functionArn });
    new cdk.CfnOutput(this, 'ApplicationDatabaseSecretArn', { value: appDatabaseSecret.secretArn });
    new cdk.CfnOutput(this, 'AgentRuntimeArn', { value: agentRuntime.attrAgentRuntimeArn });
  }
}
