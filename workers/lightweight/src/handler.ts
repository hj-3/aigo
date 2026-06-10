import type { SQSRecord } from 'aws-lambda';
import { ddbGet, ddbUpdate, s3PutObject, Config } from '@aigo/aws-clients';
import { createContextLogger } from '@aigo/logger';
import { fetchAndStorePrDiff } from './diff-fetcher.js';
import { invokeAgent, getOrchestratorAgentId, getOrchestratorAgentAliasId } from './agentcore-client.js';
import { randomUUID } from 'node:crypto';

interface AnalysisQueueMessage {
  readonly type: 'ANALYSIS_REQUESTED';
  readonly messageId: string;
  readonly timestamp: string;
  readonly source: string;
  readonly jobId: string;
  readonly orgId: string;
  readonly repoId: string;
  readonly jobType: string;
  readonly triggeredBy: string;
  readonly idempotencyKey: string;
  readonly prContext: {
    readonly prNumber: number;
    readonly prTitle: string;
    readonly prUrl: string;
    readonly commitSha: string;
    readonly baseBranch: string;
    readonly headBranch: string;
    readonly authorLogin: string;
    readonly diffS3Key: string;
  };
}

interface RepositoryRecord {
  readonly repoId: string;
  readonly orgId: string;
  readonly providerRepoFullName: string;
  readonly defaultBranch: string;
}

export async function processRecord(record: SQSRecord): Promise<void> {
  const message = JSON.parse(record.body) as AnalysisQueueMessage;
  const { jobId, orgId, repoId, prContext } = message;

  const log = createContextLogger({ jobId, orgId, repoId, source: 'lightweight-worker' });

  // ── 1. Mark job as IN_PROGRESS ────────────────────────────────────────────
  const now = new Date().toISOString();
  await ddbUpdate({
    TableName: Config.tableName('AnalysisJobs'),
    Key: { PK: `JOB#${jobId}`, SK: 'METADATA' },
    UpdateExpression: 'SET #status = :status, updatedAt = :now, GSI2PK = :gsi2pk',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': 'IN_PROGRESS',
      ':now': now,
      ':gsi2pk': `ORG#${orgId}#IN_PROGRESS`,
      ':pending': 'PENDING',
    },
    ConditionExpression: '#status = :pending',
  });

  // ── 2. Fetch repository details ───────────────────────────────────────────
  const repo = await ddbGet<RepositoryRecord>({
    TableName: Config.tableName('Repositories'),
    Key: { PK: `REPO#${repoId}`, SK: 'METADATA' },
  });

  if (!repo) {
    log.error('Repository not found', { repoId });
    throw new Error(`Repository not found: ${repoId}`);
  }

  // ── 3. Fetch PR diff and store to S3 ─────────────────────────────────────
  log.info('Fetching PR diff', { prNumber: prContext.prNumber });
  const diff = await fetchAndStorePrDiff(repo.providerRepoFullName, prContext, orgId);

  await s3PutObject(Config.s3.diffsBucket, prContext.diffS3Key, diff.diffContent, 'text/plain');

  // ── 4. Build orchestrator input and invoke AgentCore ─────────────────────
  const agentInput = JSON.stringify({
    jobId,
    orgId,
    repoId,
    jobType: message.jobType,
    prContext: {
      ...prContext,
      repoFullName: repo.providerRepoFullName,
      defaultBranch: repo.defaultBranch,
    },
    diffMetadata: {
      changedFiles: diff.changedFiles,
      additions: diff.additions,
      deletions: diff.deletions,
      commitMessages: diff.commitMessages,
      s3Key: prContext.diffS3Key,
      s3Bucket: Config.s3.diffsBucket,
    },
  });

  log.info('Invoking orchestrator agent', { agentId: getOrchestratorAgentId() });

  const agentResponse = await invokeAgent({
    agentId: getOrchestratorAgentId(),
    agentAliasId: getOrchestratorAgentAliasId(),
    sessionId: `${jobId}-${randomUUID()}`,
    inputText: agentInput,
  });

  // ── 5. Store raw agent output to S3 ──────────────────────────────────────
  const outputS3Key = `agent-outputs/${orgId}/${repoId}/${jobId}/orchestrator-response.json`;
  await s3PutObject(
    Config.s3.agentOutputsBucket,
    outputS3Key,
    JSON.stringify({ completion: agentResponse.completion, sessionId: agentResponse.sessionId }),
  );

  // ── 6. Update job with agent session reference ────────────────────────────
  await ddbUpdate({
    TableName: Config.tableName('AnalysisJobs'),
    Key: { PK: `JOB#${jobId}`, SK: 'METADATA' },
    UpdateExpression: 'SET agentSessionId = :sessionId, agentOutputS3Key = :s3Key, updatedAt = :now',
    ExpressionAttributeValues: {
      ':sessionId': agentResponse.sessionId,
      ':s3Key': outputS3Key,
      ':now': new Date().toISOString(),
    },
  });

  log.info('Analysis job dispatched to AgentCore', {
    jobId,
    sessionId: agentResponse.sessionId,
    outputS3Key,
  });
}
