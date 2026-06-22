import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ddbGet, ddbQuery, ddbPut, ddbUpdate } from '@aigo/aws-clients';
import { requireAuth, requireRole, extractClaims } from '../middleware/auth.js';
import { ImConfig } from '../config.js';
import { ulid } from 'ulid';

export const imIntegrationsRouter = new Hono();

imIntegrationsRouter.use('*', requireAuth());

const CreateIntegrationSchema = z.object({
  type: z.enum(['SLACK', 'PAGERDUTY', 'OPSGENIE', 'WEBHOOK']),
  name: z.string().min(1).max(100),
  config: z.record(z.string()),
});

imIntegrationsRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];

  const { items } = await ddbQuery({
    TableName: ImConfig.tables.integrations,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}` },
  });

  return c.json({ items });
});

imIntegrationsRouter.get('/:integrationId', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { integrationId } = c.req.param();

  const integration = await ddbGet({
    TableName: ImConfig.tables.integrations,
    Key: { PK: `ORG#${orgId}`, SK: `INTEGRATION#${integrationId}` },
  });

  if (!integration) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json(integration);
});

imIntegrationsRouter.post('/', requireRole('ADMIN'), zValidator('json', CreateIntegrationSchema), async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const body = c.req.valid('json');
  const integrationId = ulid();
  const now = new Date().toISOString();

  const item = {
    PK: `ORG#${orgId}`,
    SK: `INTEGRATION#${integrationId}`,
    integrationId,
    orgId,
    type: body.type,
    name: body.name,
    config: body.config,
    enabled: true,
    createdBy: claims['cognito:username'],
    createdAt: now,
    updatedAt: now,
    webhookToken: body.type === 'WEBHOOK' ? ulid() : null,
    GSI1PK: integrationId,
  };

  await ddbPut({ TableName: ImConfig.tables.integrations, Item: item });
  return c.json(item, 201);
});

imIntegrationsRouter.delete('/:integrationId', requireRole('ADMIN'), async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { integrationId } = c.req.param();

  await ddbUpdate({
    TableName: ImConfig.tables.integrations,
    Key: { PK: `ORG#${orgId}`, SK: `INTEGRATION#${integrationId}` },
    UpdateExpression: 'SET enabled = :f, updatedAt = :now',
    ExpressionAttributeValues: { ':f': false, ':now': new Date().toISOString() },
  });

  return c.json({ deleted: true });
});
