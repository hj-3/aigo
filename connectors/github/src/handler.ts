import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { ddbPut, ddbGet, sqsSendMessage, getSecret } from '@aigo/aws-clients';
import { Config } from '@aigo/aws-clients';
import { createContextLogger } from '@aigo/logger';
import type { GitHubPRWebhookPayload } from '@aigo/types';
import { validateGitHubSignature, extractRawBody } from './validator.js';
import { randomUUID } from 'node:crypto';

const ULID_PLACEHOLDER = (): string => {
  return Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 9).toUpperCase();
};

const ACCEPTED_ACTIONS = new Set(['opened', 'synchronize', 'ready_for_review', 'reopened']);

interface GithubAppCredentials {
  readonly webhookSecret: string;
  readonly appId: string;
  readonly privateKey: string;
  readonly installationId: string;
}

export async function handleGitHubWebhook(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;
  const logger = createContextLogger({ requestId, source: 'github-connector' });

  // ── 1. Validate signature ──────────────────────────────────────────────────
  const secretArn = Config.s3.artifactsBucket; // placeholder; real: process.env.GITHUB_SECRET_ARN
  const githubSecretArn = process.env['GITHUB_SECRET_ARN'];
  if (!githubSecretArn) {
    logger.error('GITHUB_SECRET_ARN env var missing');
    return { statusCode: 500, body: '{"error":"config_error"}' };
  }

  let credentials: GithubAppCredentials;
  try {
    credentials = await getSecret(githubSecretArn) as unknown as GithubAppCredentials;
  } catch (err) {
    logger.error('Failed to fetch GitHub secret', { error: String(err) });
    return { statusCode: 500, body: '{"error":"secret_fetch_failed"}' };
  }

  if (!validateGitHubSignature(event, credentials.webhookSecret)) {
    logger.warn('Invalid GitHub webhook signature', { requestId });
    return { statusCode: 401, body: '{"error":"invalid_signature"}' };
  }

  // ── 2. Parse and validate payload ─────────────────────────────────────────
  const rawBody = extractRawBody(event);
  const eventType = event.headers['x-github-event'];

  if (eventType === 'ping') {
    return { statusCode: 200, body: '{"ok":true}' };
  }

  if (eventType !== 'pull_request') {
    return { statusCode: 204, body: '' };
  }

  let payload: GitHubPRWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as GitHubPRWebhookPayload;
  } catch {
    logger.warn('Failed to parse webhook payload');
    return { statusCode: 400, body: '{"error":"invalid_json"}' };
  }

  if (!ACCEPTED_ACTIONS.has(payload.action)) {
    return { statusCode: 204, body: '' };
  }

  if (payload.pull_request.draft) {
    return { statusCode: 204, body: '' };
  }

  // ── 3. Resolve orgId and repoId from repository.node_id ───────────────────
  // In a real implementation, look up Repositories table by providerRepoId
  const providerRepoId = String(payload.repository.id);
  const repoRecord = await ddbGet<{ orgId: string; repoId: string; config: { autoAnalyzeOnPR: boolean } }>(
    {
      TableName: Config.tableName('Repositories'),
      Key: { PK: `PROVIDER_REPO#${providerRepoId}`, SK: 'METADATA' },
    },
  );

  if (!repoRecord) {
    logger.info('Repository not registered, skipping', { providerRepoId });
    return { statusCode: 200, body: '{"skipped":"repo_not_registered"}' };
  }

  if (!repoRecord.config.autoAnalyzeOnPR) {
    return { statusCode: 200, body: '{"skipped":"auto_analyze_disabled"}' };
  }

  // ── 4. Idempotency check — skip if job already exists for this commit ──────
  const { orgId, repoId } = repoRecord;
  const commitSha = payload.pull_request.head.sha;
  const idempotencyKey = `${repoId}#PR#${payload.number}#${commitSha}`;

  const existingJob = await ddbGet<{ jobId: string }>(
    {
      TableName: Config.tableName('AnalysisJobs'),
      Key: { PK: `IDEMPOTENCY#${idempotencyKey}`, SK: 'METADATA' },
    },
  );

  if (existingJob) {
    logger.info('Duplicate webhook event, skipping', { idempotencyKey });
    return { statusCode: 200, body: JSON.stringify({ skipped: 'duplicate', jobId: existingJob.jobId }) };
  }

  // ── 5. Create AnalysisJob ─────────────────────────────────────────────────
  const jobId = ULID_PLACEHOLDER();
  const now = new Date().toISOString();
  const triggeredBy = 'system'; // GitHub webhooks are system-triggered

  const jobItem = {
    PK: `JOB#${jobId}`,
    SK: 'METADATA',
    jobId,
    orgId,
    repoId,
    type: 'PR_ANALYSIS',
    status: 'PENDING',
    source: 'github',
    idempotencyKey,
    retryCount: 0,
    triggeredBy,
    prContext: {
      prNumber: payload.number,
      prTitle: payload.pull_request.title,
      prUrl: payload.pull_request.html_url,
      commitSha,
      baseBranch: payload.pull_request.base.ref,
      headBranch: payload.pull_request.head.ref,
      authorLogin: payload.pull_request.user.login,
      diffS3Key: `diffs/${orgId}/${repoId}/pr-${payload.number}/${commitSha}.diff`,
    },
    createdAt: now,
    updatedAt: now,
    GSI1PK: `REPO#${repoId}`,
    GSI1SK: now,
    GSI2PK: `ORG#${orgId}#PENDING`,
    GSI2SK: now,
  };

  // Transact: create job + idempotency marker
  try {
    await ddbPut({ TableName: Config.tableName('AnalysisJobs'), Item: jobItem });
    await ddbPut({
      TableName: Config.tableName('AnalysisJobs'),
      Item: {
        PK: `IDEMPOTENCY#${idempotencyKey}`,
        SK: 'METADATA',
        jobId,
        createdAt: now,
        ttl: Math.floor(Date.now() / 1000) + 86400 * 7, // 7 days
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    });
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return { statusCode: 200, body: '{"skipped":"race_condition"}' };
    }
    throw err;
  }

  // ── 6. Publish to SQS analysis-queue ─────────────────────────────────────
  const sqsPayload = {
    type: 'ANALYSIS_REQUESTED',
    messageId: randomUUID(),
    timestamp: now,
    source: 'github' as const,
    jobId,
    orgId,
    repoId,
    jobType: 'PR_ANALYSIS',
    triggeredBy,
    idempotencyKey,
    prContext: jobItem.prContext,
  };

  await sqsSendMessage(Config.sqs.analysisQueueUrl, sqsPayload, {
    messageGroupId: `${orgId}#${repoId}`,
    messageDeduplicationId: idempotencyKey,
  });

  logger.info('Analysis job created', { jobId, prNumber: payload.number, orgId, repoId });
  return { statusCode: 200, body: JSON.stringify({ jobId }) };
}
