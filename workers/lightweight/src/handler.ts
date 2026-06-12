import type { SQSRecord } from 'aws-lambda';
import { ddbGet, ddbUpdate, s3PutObject, Config } from '@aigo/aws-clients';
import { createContextLogger } from '@aigo/logger';
import { fetchAndStorePrDiff } from './diff-fetcher.js';
import { invokeOrchestratorAsync } from './lambda-client.js';

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
  readonly installationId?: string;
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

  // ── 4. Build orchestrator input ───────────────────────────────────────────
  const orchestratorInput = {
    jobId,
    orgId,
    repoId,
    jobType: message.jobType,
    prContext: {
      ...prContext,
      repoFullName: repo.providerRepoFullName,
      defaultBranch: repo.defaultBranch,
      installationId: repo.installationId ?? '',
    },
    diffMetadata: {
      changedFiles: diff.changedFiles,
      additions: diff.additions,
      deletions: diff.deletions,
      commitMessages: diff.commitMessages,
      s3Key: prContext.diffS3Key,
      s3Bucket: Config.s3.diffsBucket,
    },
  };

  // ── 5. Invoke orchestrator Lambda asynchronously ──────────────────────────
  // The orchestrator handles: sub-agent analysis → DynamoDB → GitHub comment → Slack
  log.info('Dispatching to orchestrator Lambda');
  await invokeOrchestratorAsync(orchestratorInput);

  log.info('Analysis job dispatched to orchestrator', { jobId });
}
