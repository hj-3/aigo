import { Hono } from 'hono';
import { ddbGet, ddbUpdate, Config } from '@aigo/aws-clients';
import { requireAuth, requireRole, extractClaims } from '../middleware/auth.js';

export const settingsRouter = new Hono();

settingsRouter.use('*', requireAuth());

settingsRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];

  const org = await ddbGet({
    TableName: Config.tableName('Organizations'),
    Key: { PK: `ORG#${orgId}`, SK: 'METADATA' },
  });

  if (!org) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  // Return only the settings portion (exclude internal keys)
  const { PK, SK, GSI1PK, GSI1SK, ...settings } = org as Record<string, unknown>;
  void PK; void SK; void GSI1PK; void GSI1SK;
  return c.json(settings);
});

settingsRouter.patch('/', requireRole('ADMIN'), async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];

  const body = await c.req.json<Record<string, unknown>>();

  // Whitelist of updatable settings fields
  const ALLOWED_FIELDS = [
    'notificationChannels',
    'autoAnalyzeOnPR',
    'riskThreshold',
    'approvalRequired',
    'slackChannel',
    'timezone',
    'webhookUrls',
  ] as const;

  const now = new Date().toISOString();
  const updateExpressions: string[] = ['#updatedAt = :updatedAt'];
  const expressionAttributeNames: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const expressionAttributeValues: Record<string, unknown> = { ':updatedAt': now };

  for (const field of ALLOWED_FIELDS) {
    if (field in body) {
      updateExpressions.push(`#${field} = :${field}`);
      expressionAttributeNames[`#${field}`] = field;
      expressionAttributeValues[`:${field}`] = body[field];
    }
  }

  if (updateExpressions.length === 1) {
    return c.json({ error: 'NO_UPDATABLE_FIELDS' }, 400);
  }

  await ddbUpdate({
    TableName: Config.tableName('Organizations'),
    Key: { PK: `ORG#${orgId}`, SK: 'METADATA' },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ConditionExpression: 'attribute_exists(PK)',
  });

  return c.json({ ok: true, updatedAt: now });
});
