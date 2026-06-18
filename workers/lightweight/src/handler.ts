import { randomUUID } from 'node:crypto';
import type { SQSRecord } from 'aws-lambda';
import { ddbGet, ddbUpdate, ddbPut, sqsSendMessage, s3PutObject, Config } from '@aigo/aws-clients';
import { createContextLogger } from '@aigo/logger';
import { fetchAndStorePrDiff } from './diff-fetcher.js';
import { invokeOrchestratorAsync } from './lambda-client.js';

// ── Message types ─────────────────────────────────────────────────────────────

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
  readonly installationId?: string;
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

interface CommandQueueMessage {
  readonly type: 'COMMAND';
  readonly messageId: string;
  readonly timestamp: string;
  readonly source: 'slack' | 'dashboard';
  readonly command: 'APPROVE' | 'REJECT' | 'INVESTIGATE';
  readonly reportId: string;
  readonly orgId: string;
  readonly actorId: string;
  readonly comment?: string;
}

interface IncidentQueueMessage {
  readonly type: 'INCIDENT_TRIGGERED';
  readonly messageId: string;
  readonly timestamp: string;
  readonly source: string;
  readonly incidentId: string;
  readonly orgId: string;
  readonly serviceId: string;
  readonly incidentSource: string;
  readonly awsAlarmArn?: string;
  readonly awsRegion?: string;
  readonly title: string;
  readonly affectedResources?: string[];
}

type QueueMessage = AnalysisQueueMessage | CommandQueueMessage | IncidentQueueMessage;

// ── DDB record shapes ─────────────────────────────────────────────────────────

interface RepositoryRecord {
  readonly repoId: string;
  readonly orgId: string;
  readonly fullName: string;
  readonly providerRepoFullName?: string;
  readonly defaultBranch: string;
}

interface IntegrationRecord {
  readonly installationId: string;
  readonly status: string;
}

interface ReportRecord {
  readonly reportId: string;
  readonly orgId: string;
  readonly repoId?: string;
  readonly prContext?: { prUrl?: string; prNumber?: number; authorLogin?: string };
  readonly riskScore?: number;
  readonly riskLevel?: string;
  readonly approvalStatus?: string;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function processRecord(record: SQSRecord): Promise<void> {
  const message = JSON.parse(record.body) as QueueMessage;
  const log = createContextLogger({ source: 'lightweight-worker', messageType: message.type });

  switch (message.type) {
    case 'ANALYSIS_REQUESTED':
      return processAnalysis(message, log);
    case 'COMMAND':
      return processCommand(message, log);
    case 'INCIDENT_TRIGGERED':
      return processIncident(message, log);
    default:
      log.warn('Unknown message type — skipping', { type: (message as { type: string }).type });
  }
}

// ── ANALYSIS_REQUESTED ────────────────────────────────────────────────────────

async function processAnalysis(message: AnalysisQueueMessage, log: ReturnType<typeof createContextLogger>): Promise<void> {
  const { jobId, orgId, repoId, prContext } = message;
  log.info('Processing analysis job', { jobId });

  const now = new Date().toISOString();
  try {
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
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      log.info('Job already IN_PROGRESS, retrying processing', { jobId });
    } else {
      throw err;
    }
  }

  const [repo, githubIntegration] = await Promise.all([
    ddbGet<RepositoryRecord>({
      TableName: Config.tableName('Repositories'),
      Key: { PK: `REPO#${repoId}`, SK: 'METADATA' },
    }),
    ddbGet<IntegrationRecord>({
      TableName: Config.tableName('Integrations'),
      Key: { PK: `ORG#${orgId}`, SK: 'INTEGRATION#GITHUB' },
    }),
  ]);

  if (!repo) {
    log.error('Repository not found', { repoId });
    throw new Error(`Repository not found: ${repoId}`);
  }

  const installationId =
    (githubIntegration?.status === 'ACTIVE' ? githubIntegration.installationId : undefined) ??
    message.installationId;

  const repoFullName = repo.fullName ?? repo.providerRepoFullName ?? '';

  log.info('Fetching PR diff', { prNumber: prContext.prNumber, installationId });
  const diff = await fetchAndStorePrDiff(repoFullName, prContext, orgId, installationId);

  await s3PutObject(Config.s3.diffsBucket, prContext.diffS3Key, diff.diffContent, 'text/plain');

  const orchestratorInput = {
    jobId,
    orgId,
    repoId,
    jobType: message.jobType,
    prContext: {
      ...prContext,
      repoFullName,
      defaultBranch: repo.defaultBranch,
      installationId: installationId ?? '',
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

  log.info('Dispatching to orchestrator Lambda');
  await invokeOrchestratorAsync(orchestratorInput);
  log.info('Analysis job dispatched to orchestrator', { jobId });
}

// ── COMMAND (Slack /approve /reject) ─────────────────────────────────────────

async function processCommand(message: CommandQueueMessage, log: ReturnType<typeof createContextLogger>): Promise<void> {
  const { command, reportId, actorId, comment } = message;
  log.info('Processing command', { command, reportId });

  if (command !== 'APPROVE' && command !== 'REJECT') {
    log.info('Command not handled here', { command });
    return;
  }

  const decision = command === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const now = new Date().toISOString();

  // Fetch report by reportId — use report.orgId for all subsequent ops.
  // message.orgId is the Slack team_id (e.g. T04ABC) which does NOT equal the aigo orgId.
  const report = await ddbGet<ReportRecord>({
    TableName: Config.tableName('Reports'),
    Key: { PK: `REPORT#${reportId}`, SK: 'METADATA' },
  });

  if (!report) {
    log.warn('Report not found', { reportId });
    return;
  }

  const orgId = report.orgId!;  // derive orgId from the report itself
  const approvalId = randomUUID();

  // Write Approvals record
  await ddbPut({
    TableName: Config.tableName('Approvals'),
    Item: {
      PK: `APPROVAL#${approvalId}`,
      SK: 'METADATA',
      approvalId,
      reportId,
      orgId,
      userId: actorId,
      decision,
      comment: comment ?? '',
      createdAt: now,
      source: 'slack',
      GSI1PK: `REPORT#${reportId}`,
      GSI1SK: now,
      GSI2PK: `ORG#${orgId}`,
      GSI2SK: now,
    },
  });

  // Update Report approvalStatus
  await ddbUpdate({
    TableName: Config.tableName('Reports'),
    Key: { PK: `REPORT#${reportId}`, SK: 'METADATA' },
    UpdateExpression: 'SET approvalStatus = :status, approvedBy = :userId, approvedAt = :now, updatedAt = :now',
    ExpressionAttributeValues: { ':status': decision, ':userId': actorId, ':now': now },
  });

  // Send REVIEW_SUBMITTED to notification-queue → GitHub PR formal review
  const prCtx = report.prContext ?? {};
  const prUrl = prCtx.prUrl ?? '';
  const notificationQueueUrl = process.env['SQS_NOTIFICATION_QUEUE_URL'];

  if (prUrl && notificationQueueUrl) {
    const integration = await ddbGet<{ installationId: string; status: string }>({
      TableName: Config.tableName('Integrations'),
      Key: { PK: `ORG#${orgId}`, SK: 'INTEGRATION#GITHUB' },
    });

    // notification-queue is a STANDARD queue — no FIFO params
    await sqsSendMessage(
      notificationQueueUrl,
      {
        type: 'NOTIFICATION',
        messageId: randomUUID(),
        timestamp: now,
        source: 'slack-command',
        notificationType: 'REVIEW_SUBMITTED',
        orgId,
        recipients: [actorId],
        installationId: integration?.installationId ?? '',
        payload: {
          prUrl,
          prNumber: prCtx.prNumber,
          repoId: report.repoId ?? '',
          decision,
          comment: comment ?? '',
          reportId,
        },
      },
    );
  }

  log.info('Command processed', { command, reportId, decision, approvalId });
}

// ── INCIDENT_TRIGGERED ────────────────────────────────────────────────────────

async function processIncident(message: IncidentQueueMessage, log: ReturnType<typeof createContextLogger>): Promise<void> {
  const { incidentId, orgId, serviceId, title } = message;
  log.info('Processing incident', { incidentId, serviceId });

  const now = new Date().toISOString();

  // Update Incident to INVESTIGATING
  await ddbUpdate({
    TableName: Config.tableName('Incidents'),
    Key: { PK: `INCIDENT#${incidentId}`, SK: 'METADATA' },
    UpdateExpression: 'SET #status = :status, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': 'INVESTIGATING', ':now': now },
  });

  // Invoke orchestrator async with INCIDENT job type
  await invokeOrchestratorAsync({
    jobId: incidentId,
    jobType: 'INCIDENT',
    orgId,
    serviceId,
    incidentId,
    alarmName: title,
    startTime: now,
    affectedResources: message.affectedResources ?? [],
    awsRegion: message.awsRegion ?? process.env['AWS_REGION'] ?? 'ap-northeast-2',
  });

  log.info('Incident dispatched to orchestrator', { incidentId });
}
