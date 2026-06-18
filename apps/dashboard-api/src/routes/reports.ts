import { Hono } from 'hono';
import { ddbGet, ddbQuery, ddbUpdate, ddbPut, sqsSendMessage, Config } from '@aigo/aws-clients';
import { ulid } from 'ulid';
import { requireAuth, requireRole, extractClaims } from '../middleware/auth.js';
const SQS_NOTIFICATION_QUEUE_URL = process.env['SQS_NOTIFICATION_QUEUE_URL'] ?? '';

export const reportsRouter = new Hono();

reportsRouter.use('*', requireAuth());

reportsRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];

  const { items } = await ddbQuery({
    TableName: Config.tableName('Reports'),
    IndexName: 'GSI3-orgApprovalStatus-createdAt-index',
    KeyConditionExpression: 'GSI3PK = :pk',
    FilterExpression: 'approvalStatus <> :deleted',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':deleted': 'DELETED' },
    ScanIndexForward: false,
    Limit: 50,
  });

  return c.json(items);
});

reportsRouter.get('/:reportId', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { reportId } = c.req.param();

  const report = await ddbGet({
    TableName: Config.tableName('Reports'),
    Key: { PK: `REPORT#${reportId}`, SK: 'METADATA' },
  });

  if (!report || (report as Record<string, string>)['orgId'] !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  // Findings are stored with GSI1PK = "JOB#{jobId}" (reportId doesn't exist yet at save_findings time).
  // GSI name is GSI1-reportId-severity-index but the key prefix is JOB# not REPORT#.
  const jobId = (report as Record<string, string>)['jobId'] ?? '';
  const { items: findings } = await ddbQuery({
    TableName: Config.tableName('Findings'),
    IndexName: 'GSI1-reportId-severity-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `JOB#${jobId}` },
    ScanIndexForward: false,
  });

  return c.json({ ...report, findings });
});

/**
 * POST /reports/:reportId/approve
 * Records approval/rejection decision and updates AgentCore Memory so future analyses
 * can learn from human feedback.
 */
reportsRouter.post('/:reportId/approve', requireRole('REVIEWER'), async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const userId = claims.sub;
  const { reportId } = c.req.param();
  const { decision, comment } = await c.req.json<{ decision: 'APPROVED' | 'REJECTED'; comment?: string }>();

  if (!['APPROVED', 'REJECTED'].includes(decision)) {
    return c.json({ error: 'INVALID_DECISION' }, 400);
  }

  const report = await ddbGet({
    TableName: Config.tableName('Reports'),
    Key: { PK: `REPORT#${reportId}`, SK: 'METADATA' },
  }) as Record<string, unknown> | null;

  if (!report || (report['orgId'] as string) !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  const now = new Date().toISOString();
  const approvalId = ulid();

  // ── 1. Write Approvals record ─────────────────────────────────────────────
  await ddbPut({
    TableName: Config.tableName('Approvals'),
    Item: {
      PK: `APPROVAL#${approvalId}`,
      SK: 'METADATA',
      approvalId,
      reportId,
      orgId,
      userId,
      decision,
      comment: comment ?? '',
      createdAt: now,
      GSI1PK: `REPORT#${reportId}`,
      GSI1SK: now,
      GSI2PK: `ORG#${orgId}`,
      GSI2SK: now,
    },
  });

  // ── 2. Update Report with approval status ─────────────────────────────────
  await ddbUpdate({
    TableName: Config.tableName('Reports'),
    Key: { PK: `REPORT#${reportId}`, SK: 'METADATA' },
    UpdateExpression: 'SET approvalStatus = :status, approvedBy = :userId, approvedAt = :now, updatedAt = :now',
    ExpressionAttributeValues: {
      ':status': decision,
      ':userId': userId,
      ':now': now,
    },
  });

  // ── 3. Update AgentMemory — write feedback so future analyses improve ──────
  const repoId = report['repoId'] as string;
  const riskScore = (report['riskScore'] as number) ?? 0;
  const riskLevel = (report['riskLevel'] as string) ?? '';
  const prCtx = (report['prContext'] as Record<string, unknown>) ?? {};
  const prNumber = (prCtx['prNumber'] as number) ?? 0;
  const prUrl = (prCtx['prUrl'] as string) ?? '';
  const authorLogin = (prCtx['authorLogin'] as string) ?? '';

  if (repoId) {
    await ddbPut({
      TableName: Config.tableName('AgentMemory'),
      Item: {
        PK: `MEMORY#APPROVAL_FEEDBACK#ORG#${orgId}#REPO#${repoId}`,
        SK: now,
        memoryType: 'APPROVAL_FEEDBACK',
        orgId,
        repoId,
        reportId,
        prNumber,
        authorLogin,
        riskScore,
        riskLevel,
        humanDecision: decision,
        humanComment: comment ?? '',
        reviewerId: userId,
        GSI1PK: `ORG#${orgId}#REPO#${repoId}`,
        GSI1SK: now,
        GSI2PK: `ORG#${orgId}#APPROVALS`,
        GSI2SK: now,
        ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 3600),
      },
    });
  }

  // ── 4. Send GitHub PR Review via notification-worker ─────────────────────
  if (prUrl && SQS_NOTIFICATION_QUEUE_URL) {
    // Get org's GitHub installationId from Integrations table
    const integration = await ddbGet<{ installationId: string; status: string }>({
      TableName: Config.tableName('Integrations'),
      Key: { PK: `ORG#${orgId}`, SK: 'INTEGRATION#GITHUB' },
    });

    // notification-queue is a STANDARD queue — do NOT pass FIFO params (MessageGroupId etc.)
    await sqsSendMessage(
      SQS_NOTIFICATION_QUEUE_URL,
      {
        type: 'NOTIFICATION',
        messageId: ulid(),
        timestamp: now,
        source: 'dashboard',
        notificationType: 'REVIEW_SUBMITTED',
        orgId,
        recipients: [userId],
        installationId: integration?.installationId ?? '',
        payload: {
          prUrl,
          prNumber,
          repoId,
          decision,
          comment: comment ?? '',
          reportId,
          riskLevel,
          reviewerUserId: userId,
        },
      },
    ).catch((err: unknown) => {
      console.error('[reports] REVIEW_SUBMITTED SQS send failed', { reportId, orgId, error: String(err) });
    });
  }

  return c.json({ approvalId, decision, reportId });
});

/**
 * DELETE /reports/:reportId — soft-delete a report (sets status to DELETED)
 */
reportsRouter.delete('/:reportId', requireRole('ADMIN'), async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { reportId } = c.req.param();

  const report = await ddbGet({
    TableName: Config.tableName('Reports'),
    Key: { PK: `REPORT#${reportId}`, SK: 'METADATA' },
  }) as Record<string, unknown> | null;

  if (!report || (report['orgId'] as string) !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  const now = new Date().toISOString();
  // Soft-delete: mark as DELETED so it's excluded from list queries (GSI3 filter)
  await ddbUpdate({
    TableName: Config.tableName('Reports'),
    Key: { PK: `REPORT#${reportId}`, SK: 'METADATA' },
    UpdateExpression: 'SET approvalStatus = :deleted, GSI3SK = :gsi3sk, updatedAt = :now',
    ExpressionAttributeValues: {
      ':deleted': 'DELETED',
      ':gsi3sk': `DELETED#${now}`,
      ':now': now,
    },
  });

  return c.json({ ok: true, reportId });
});

/**
 * GET /reports/:reportId/approvals — list approval history for a report
 */
reportsRouter.get('/:reportId/approvals', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { reportId } = c.req.param();

  const report = await ddbGet({
    TableName: Config.tableName('Reports'),
    Key: { PK: `REPORT#${reportId}`, SK: 'METADATA' },
  }) as Record<string, unknown> | null;

  if (!report || (report['orgId'] as string) !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  const { items } = await ddbQuery({
    TableName: Config.tableName('Approvals'),
    IndexName: 'GSI1-reportId-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `REPORT#${reportId}` },
    ScanIndexForward: false,
  });

  return c.json(items);
});
