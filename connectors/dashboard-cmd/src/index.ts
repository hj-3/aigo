import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { handle } from 'hono/aws-lambda';
import { ddbGet, ddbUpdate, ddbPut, sqsSendMessage, Config } from '@aigo/aws-clients';
import { getLogger } from '@aigo/logger';
import { randomUUID } from 'node:crypto';

const logger = getLogger('dashboard-cmd-connector');

function ulid(): string {
  return Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 9).toUpperCase();
}

function extractUserId(event: APIGatewayProxyEventV2): string {
  // Cognito JWT claims are in requestContext.authorizer.jwt.claims
  const claims = (event.requestContext as unknown as {
    authorizer?: { jwt?: { claims?: Record<string, string> } }
  }).authorizer?.jwt?.claims;
  return claims?.['sub'] ?? 'unknown';
}

function extractOrgId(event: APIGatewayProxyEventV2): string {
  const claims = (event.requestContext as unknown as {
    authorizer?: { jwt?: { claims?: Record<string, string> } }
  }).authorizer?.jwt?.claims;
  return claims?.['custom:orgId'] ?? '';
}

const app = new Hono();

// ── POST /reports/{reportId}/approve ──────────────────────────────────────────
app.post(
  '/reports/:reportId/approve',
  zValidator('json', z.object({ comment: z.string().optional() })),
  async (c) => {
    const { reportId } = c.req.param();
    const { comment } = c.req.valid('json');
    const event = c.env as unknown as APIGatewayProxyEventV2;
    const userId = extractUserId(event);
    const orgId = extractOrgId(event);

    const approvalId = ulid();
    const now = new Date().toISOString();

    await ddbPut({
      TableName: Config.tableName('Approvals'),
      Item: {
        PK: `APPROVAL#${approvalId}`,
        SK: 'METADATA',
        approvalId,
        reportId,
        orgId,
        decision: 'APPROVED',
        decidedBy: userId,
        comment,
        createdAt: now,
        GSI1PK: `REPORT#${reportId}`,
        GSI1SK: now,
        GSI2PK: `ORG#${orgId}`,
        GSI2SK: now,
      },
    });

    await ddbUpdate({
      TableName: Config.tableName('Reports'),
      Key: { PK: `REPORT#${reportId}`, SK: 'METADATA' },
      UpdateExpression: 'SET approvalStatus = :status, updatedAt = :now',
      ExpressionAttributeValues: { ':status': 'APPROVED', ':now': now },
    });

    await sqsSendMessage(Config.sqs.commandQueueUrl, {
      type: 'COMMAND',
      messageId: randomUUID(),
      timestamp: now,
      source: 'dashboard',
      command: 'APPROVE',
      reportId,
      orgId,
      actorId: userId,
      comment,
    }, { messageGroupId: `${orgId}#${reportId}`, messageDeduplicationId: `approve-${approvalId}` });

    return c.json({ approvalId, status: 'APPROVED' }, 201);
  },
);

// ── POST /reports/{reportId}/reject ───────────────────────────────────────────
app.post(
  '/reports/:reportId/reject',
  zValidator('json', z.object({ comment: z.string().min(1) })),
  async (c) => {
    const { reportId } = c.req.param();
    const { comment } = c.req.valid('json');
    const event = c.env as unknown as APIGatewayProxyEventV2;
    const userId = extractUserId(event);
    const orgId = extractOrgId(event);

    const approvalId = ulid();
    const now = new Date().toISOString();

    await ddbPut({
      TableName: Config.tableName('Approvals'),
      Item: {
        PK: `APPROVAL#${approvalId}`,
        SK: 'METADATA',
        approvalId,
        reportId,
        orgId,
        decision: 'REJECTED',
        decidedBy: userId,
        comment,
        createdAt: now,
        GSI1PK: `REPORT#${reportId}`,
        GSI1SK: now,
        GSI2PK: `ORG#${orgId}`,
        GSI2SK: now,
      },
    });

    await ddbUpdate({
      TableName: Config.tableName('Reports'),
      Key: { PK: `REPORT#${reportId}`, SK: 'METADATA' },
      UpdateExpression: 'SET approvalStatus = :status, updatedAt = :now',
      ExpressionAttributeValues: { ':status': 'REJECTED', ':now': now },
    });

    return c.json({ approvalId, status: 'REJECTED' }, 201);
  },
);

// ── POST /fix ─────────────────────────────────────────────────────────────────
app.post(
  '/fix',
  zValidator('json', z.object({
    reportId: z.string(),
    targetFindings: z.array(z.string()).optional(),
    comment: z.string().optional(),
  })),
  async (c) => {
    const { reportId, targetFindings, comment } = c.req.valid('json');
    const event = c.env as unknown as APIGatewayProxyEventV2;
    const userId = extractUserId(event);
    const orgId = extractOrgId(event);

    // Fetch report to get jobId and repoId
    const report = await ddbGet<{ jobId: string; repoId: string }>(
      { TableName: Config.tableName('Reports'), Key: { PK: `REPORT#${reportId}`, SK: 'METADATA' } },
    );

    if (!report) {
      return c.json({ error: 'REPORT_NOT_FOUND' }, 404);
    }

    const fixId = ulid();
    const now = new Date().toISOString();

    await ddbPut({
      TableName: Config.tableName('FixRequests'),
      Item: {
        PK: `FIX#${fixId}`,
        SK: 'METADATA',
        fixId,
        reportId,
        orgId,
        jobId: report.jobId,
        status: 'PENDING',
        requestedBy: userId,
        targetFindings: targetFindings ?? [],
        comment,
        createdAt: now,
        updatedAt: now,
        GSI1PK: `REPORT#${reportId}`,
        GSI1SK: `PENDING#${now}`,
        GSI2PK: `ORG#${orgId}#PENDING`,
        GSI2SK: now,
      },
    });

    await sqsSendMessage(Config.sqs.fixQueueUrl, {
      type: 'FIX_REQUESTED',
      messageId: randomUUID(),
      timestamp: now,
      source: 'dashboard',
      fixId,
      jobId: report.jobId,
      orgId,
      repoId: report.repoId,
      requestedBy: userId,
      targetFindings: targetFindings ?? [],
    }, { messageGroupId: `${orgId}#${reportId}`, messageDeduplicationId: `fix-${fixId}` });

    logger.info('Fix request created', { fixId, reportId, orgId });
    return c.json({ fixId, status: 'PENDING' }, 201);
  },
);

export const handler = handle(app);
