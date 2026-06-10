/**
 * Reads runtime configuration from environment variables.
 * All config is sourced from Lambda environment variables,
 * which are populated from SSM Parameter Store / Secrets Manager at deploy time.
 */

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const Config = {
  get region(): string {
    return optionalEnv('AWS_REGION', 'ap-northeast-2');
  },
  get stage(): string {
    return optionalEnv('STAGE', 'prod');
  },
  get tableName(): (table: string) => string {
    const prefix = optionalEnv('DYNAMODB_TABLE_PREFIX', 'aigo');
    return (table: string) => `${prefix}-${table}`;
  },
  get s3(): {
    artifactsBucket: string;
    diffsBucket: string;
    reportsBucket: string;
    agentOutputsBucket: string;
    patchesBucket: string;
    incidentsBucket: string;
  } {
    return {
      artifactsBucket: requireEnv('S3_ARTIFACTS_BUCKET'),
      diffsBucket: requireEnv('S3_DIFFS_BUCKET'),
      reportsBucket: requireEnv('S3_REPORTS_BUCKET'),
      agentOutputsBucket: requireEnv('S3_AGENT_OUTPUTS_BUCKET'),
      patchesBucket: requireEnv('S3_PATCHES_BUCKET'),
      incidentsBucket: requireEnv('S3_INCIDENTS_BUCKET'),
    };
  },
  get sqs(): {
    analysisQueueUrl: string;
    fixQueueUrl: string;
    incidentQueueUrl: string;
    commandQueueUrl: string;
    notificationQueueUrl: string;
  } {
    return {
      analysisQueueUrl: requireEnv('SQS_ANALYSIS_QUEUE_URL'),
      fixQueueUrl: requireEnv('SQS_FIX_QUEUE_URL'),
      incidentQueueUrl: requireEnv('SQS_INCIDENT_QUEUE_URL'),
      commandQueueUrl: requireEnv('SQS_COMMAND_QUEUE_URL'),
      notificationQueueUrl: requireEnv('SQS_NOTIFICATION_QUEUE_URL'),
    };
  },
  get eventBusName(): string {
    return requireEnv('EVENTBRIDGE_BUS_NAME');
  },
} as const;
