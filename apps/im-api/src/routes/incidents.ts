import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ddbGet, ddbQuery, ddbPut, ddbUpdate } from '@aigo/aws-clients';
import { requireAuth, extractClaims } from '../middleware/auth.js';
import { ImConfig } from '../config.js';
import { ulid } from 'ulid';

export const incidentsRouter = new Hono();

incidentsRouter.use('*', requireAuth());

const CreateIncidentSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  affectedServices: z.array(z.string()).default([]),
  linkedAccountId: z.string().optional(),
});

const UpdateIncidentSchema = z.object({
  status: z.enum(['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED']).optional(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  resolution: z.string().optional(),
});

incidentsRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 100);

  const queryParams: Parameters<typeof ddbQuery>[0] = {
    TableName: ImConfig.tables.incidents,
    IndexName: 'GSI1-orgId-status-index',
    KeyConditionExpression: status
      ? 'GSI1PK = :pk AND GSI1SK = :sk'
      : 'GSI1PK = :pk',
    ExpressionAttributeValues: status
      ? { ':pk': `ORG#${orgId}`, ':sk': `STATUS#${status}` }
      : { ':pk': `ORG#${orgId}` },
    ScanIndexForward: false,
    Limit: limit,
  };

  const { items } = await ddbQuery(queryParams);
  return c.json({ items });
});

incidentsRouter.get('/:incidentId', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { incidentId } = c.req.param();

  const incident = await ddbGet({
    TableName: ImConfig.tables.incidents,
    Key: { PK: `INCIDENT#${incidentId}`, SK: 'METADATA' },
  });

  if (!incident || (incident as Record<string, string>)['orgId'] !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  return c.json(incident);
});

incidentsRouter.post('/', zValidator('json', CreateIncidentSchema), async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const body = c.req.valid('json');
  const incidentId = ulid();
  const now = new Date().toISOString();

  const item = {
    PK: `INCIDENT#${incidentId}`,
    SK: 'METADATA',
    incidentId,
    orgId,
    title: body.title,
    description: body.description ?? '',
    severity: body.severity,
    status: 'OPEN',
    affectedServices: body.affectedServices,
    linkedAccountId: body.linkedAccountId ?? null,
    source: 'MANUAL',
    createdBy: claims['cognito:username'],
    createdAt: now,
    updatedAt: now,
    GSI1PK: `ORG#${orgId}`,
    GSI1SK: `STATUS#OPEN`,
    GSI2PK: `ACCOUNT#${body.linkedAccountId ?? 'NONE'}`,
    GSI2SK: now,
  };

  await ddbPut({ TableName: ImConfig.tables.incidents, Item: item });
  return c.json(item, 201);
});

incidentsRouter.patch('/:incidentId', zValidator('json', UpdateIncidentSchema), async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { incidentId } = c.req.param();
  const body = c.req.valid('json');

  const existing = await ddbGet({
    TableName: ImConfig.tables.incidents,
    Key: { PK: `INCIDENT#${incidentId}`, SK: 'METADATA' },
  });

  if (!existing || (existing as Record<string, string>)['orgId'] !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  const updates: string[] = ['updatedAt = :now'];
  const attrValues: Record<string, unknown> = { ':now': new Date().toISOString() };
  const attrNames: Record<string, string> = {};

  if (body.status) {
    updates.push('GSI1SK = :gsi1sk, #st = :status');
    attrValues[':gsi1sk'] = `STATUS#${body.status}`;
    attrValues[':status'] = body.status;
    attrNames['#st'] = 'status';
  }
  if (body.severity) {
    updates.push('severity = :severity');
    attrValues[':severity'] = body.severity;
  }
  if (body.resolution) {
    updates.push('resolution = :resolution');
    attrValues[':resolution'] = body.resolution;
  }

  await ddbUpdate({
    TableName: ImConfig.tables.incidents,
    Key: { PK: `INCIDENT#${incidentId}`, SK: 'METADATA' },
    UpdateExpression: `SET ${updates.join(', ')}`,
    ExpressionAttributeValues: attrValues,
    ...(Object.keys(attrNames).length ? { ExpressionAttributeNames: attrNames } : {}),
  });

  return c.json({ incidentId, updated: true });
});

incidentsRouter.get('/:incidentId/investigation', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { incidentId } = c.req.param();

  const existing = await ddbGet({
    TableName: ImConfig.tables.incidents,
    Key: { PK: `INCIDENT#${incidentId}`, SK: 'METADATA' },
  });
  if (!existing || (existing as Record<string, string>)['orgId'] !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  const result = await ddbGet({
    TableName: ImConfig.tables.investigation,
    Key: { PK: `INCIDENT#${incidentId}`, SK: 'SCOPE_RESULT' },
  });

  if (!result) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json(result);
});

incidentsRouter.post('/:incidentId/mitigation', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { incidentId } = c.req.param();

  const existing = await ddbGet({
    TableName: ImConfig.tables.incidents,
    Key: { PK: `INCIDENT#${incidentId}`, SK: 'METADATA' },
  });
  if (!existing || (existing as Record<string, string>)['orgId'] !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  const investigation = await ddbGet({
    TableName: ImConfig.tables.investigation,
    Key: { PK: `INCIDENT#${incidentId}`, SK: 'SCOPE_RESULT' },
  });
  if (!investigation) return c.json({ error: 'NO_INVESTIGATION_RESULT' }, 422);

  const recoveryOptions = (investigation as Record<string, unknown[]>)['recoveryOptions'] ?? [];
  if (recoveryOptions.length === 0) return c.json({ error: 'NO_RECOVERY_OPTIONS' }, 422);

  // Look up crossAccountRoleArn for the incident's linked account
  const linkedAccountId = (existing as Record<string, string>)['linkedAccountId'];
  let crossAccountRoleArn: string | null = null;
  if (linkedAccountId) {
    const linkedAccount = await ddbGet({
      TableName: ImConfig.tables.accounts,
      Key: { PK: `ORG#${orgId}`, SK: `ACCOUNT#${linkedAccountId}` },
    }) as Record<string, string> | null;
    crossAccountRoleArn = linkedAccount?.['crossAccountRoleArn'] ?? null;
  }

  const now = new Date().toISOString();
  const items = (recoveryOptions as Array<Record<string, unknown>>).map((opt, i) => ({
    PK: `REMEDIATION#${ulid()}`,
    SK: 'METADATA',
    incidentId,
    incidentTitle: (existing as Record<string, string>)['title'] ?? '',
    orgId,
    description: opt['description'] as string ?? '',
    actionType: opt['actionType'] as string ?? 'MANUAL',
    targetResource: opt['targetResource'] as string ?? '',
    params: (opt['params'] as Record<string, unknown>) ?? {},
    crossAccountRoleArn,
    riskLevel: opt['risk'] as string ?? 'MEDIUM',
    estimatedMinutes: (opt['estimatedMinutes'] as number) ?? 5,
    status: 'PENDING',
    order: i,
    createdAt: now,
    GSI1PK: `ORG#${orgId}`,
    GSI1SK: `INCIDENT#${incidentId}`,
  }));

  await Promise.all(items.map((item) =>
    ddbPut({ TableName: ImConfig.tables.remediations, Item: item }),
  ));

  return c.json({ created: items.length, incidentId });
});

incidentsRouter.post('/:incidentId/investigate', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { incidentId } = c.req.param();

  const existing = await ddbGet({
    TableName: ImConfig.tables.incidents,
    Key: { PK: `INCIDENT#${incidentId}`, SK: 'METADATA' },
  });

  if (!existing || (existing as Record<string, string>)['orgId'] !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  const { SFNClient, StartExecutionCommand } = await import('@aws-sdk/client-sfn');
  const sfn = new SFNClient({ region: ImConfig.region });
  const execution = await sfn.send(new StartExecutionCommand({
    stateMachineArn: ImConfig.sfnArn,
    name: `${incidentId}-${Date.now()}`,
    input: JSON.stringify({ incidentId, orgId }),
  }));

  await ddbUpdate({
    TableName: ImConfig.tables.incidents,
    Key: { PK: `INCIDENT#${incidentId}`, SK: 'METADATA' },
    UpdateExpression: 'SET #st = :s, investigationExecutionArn = :arn, updatedAt = :now',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: {
      ':s': 'INVESTIGATING',
      ':arn': execution.executionArn,
      ':now': new Date().toISOString(),
    },
  });

  return c.json({ incidentId, executionArn: execution.executionArn });
});
