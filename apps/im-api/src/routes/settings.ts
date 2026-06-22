import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ddbGet, ddbPut, ddbQuery, ddbUpdate } from '@aigo/aws-clients';
import { requireAuth, requireRole, extractClaims } from '../middleware/auth.js';
import { ImConfig } from '../config.js';

export const imSettingsRouter = new Hono();

imSettingsRouter.use('*', requireAuth());

const UpdateSettingsSchema = z.object({
  mode: z.enum(['ALLOWLIST', 'ALL']).optional(),
  notificationEmail: z.string().email().optional(),
  severityThreshold: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
});

imSettingsRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];

  const settings = await ddbGet({
    TableName: ImConfig.tables.settings,
    Key: { PK: `ORG#${orgId}`, SK: 'SETTINGS' },
  });

  return c.json(settings ?? { mode: 'ALLOWLIST', severityThreshold: 'HIGH' });
});

imSettingsRouter.patch('/', requireRole('ADMIN'), zValidator('json', UpdateSettingsSchema), async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const body = c.req.valid('json');

  const existing = (await ddbGet({
    TableName: ImConfig.tables.settings,
    Key: { PK: `ORG#${orgId}`, SK: 'SETTINGS' },
  })) ?? {};

  const updated = {
    ...existing,
    ...body,
    PK: `ORG#${orgId}`,
    SK: 'SETTINGS',
    orgId,
    updatedAt: new Date().toISOString(),
    updatedBy: claims['cognito:username'],
  };

  await ddbPut({ TableName: ImConfig.tables.settings, Item: updated });
  return c.json(updated);
});

// Allowed actions sub-routes
imSettingsRouter.get('/allowed-actions', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];

  const { items } = await ddbQuery({
    TableName: ImConfig.tables.allowedActions,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':sk': 'ACTION#' },
  });

  return c.json({ items });
});

imSettingsRouter.patch('/allowed-actions/:actionId', requireRole('ADMIN'), async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { actionId } = c.req.param();
  const body = await c.req.json<{ isEnabled: boolean }>();

  const existing = await ddbGet({
    TableName: ImConfig.tables.allowedActions,
    Key: { PK: `ORG#${orgId}`, SK: `ACTION#${actionId}` },
  });

  if (!existing) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  await ddbUpdate({
    TableName: ImConfig.tables.allowedActions,
    Key: { PK: `ORG#${orgId}`, SK: `ACTION#${actionId}` },
    UpdateExpression: 'SET isEnabled = :e, updatedAt = :now',
    ExpressionAttributeValues: { ':e': body.isEnabled, ':now': new Date().toISOString() },
  });

  return c.json({ actionId, isEnabled: body.isEnabled });
});
