import { Hono } from 'hono';
import { ddbGet, ddbQuery, ddbUpdate, ddbPut, Config } from '@aigo/aws-clients';
import { ulid } from 'ulid';
import { requireAuth, requireRole, extractClaims } from '../middleware/auth.js';

export const reportsRouter = new Hono();

reportsRouter.use('*', requireAuth());

reportsRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];

  const { items } = await ddbQuery({
    TableName: Config.tableName('Reports'),
    IndexName: 'GSI3-orgApprovalStatus-createdAt-index',
    KeyConditionExpression: 'GSI3PK = :pk',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}` },
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

  // Fetch findings for this report
  const { items: findings } = await ddbQuery({
    TableName: Config.tableName('Findings'),
    IndexName: 'GSI1-reportId-severity-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `REPORT#${reportId}` },
    ScanIndexForward: false,
  });

  return c.json({ ...report, findings });
});

/**
 * POST /reports/:reportId/approve
 * Records approval/rejection decision and updates AgentCore Memory so future analyses
 * can learn from human feedback.
 */
reportsRouter.post('/:reportId/approve', requireRole('MEMBER'), async (c) => {
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
  // Find the PR analysis memory entry for this report to add human approval signal
  const repoId = report['repoId'] as string;
  const riskScore = report['riskScore'] as number ?? 0;
  const riskLevel = report['riskLevel'] as string ?? '';
  const prNumber = (report['prContext'] as Record<string, unknown>)?.['prNumber'] as number ?? 0;
  const authorLogin = (report['prContext'] as Record<string, unknown>)?.['authorLogin'] as string ?? '';

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

  return c.json({ approvalId, decision, reportId });
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
