import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ddbGet, ddbQuery, ddbPut } from '@aigo/aws-clients';
import { requireAuth, requireRole, extractClaims } from '../middleware/auth.js';
import { ImConfig } from '../config.js';
import { ulid } from 'ulid';

export const targetsRouter = new Hono();

targetsRouter.use('*', requireAuth());

const CreateTargetSchema = z.object({
  alarmName: z.string().min(1),
  accountId: z.string().regex(/^\d{12}$/),
  region: z.string().default('ap-northeast-2'),
  serviceName: z.string().min(1),
  description: z.string().optional(),
});

targetsRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const accountId = c.req.query('accountId');

  const queryParams: Parameters<typeof ddbQuery>[0] = accountId
    ? {
        TableName: ImConfig.tables.targets,
        IndexName: 'GSI1-account-alarmName-index',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `ACCOUNT#${accountId}` },
      }
    : {
        TableName: ImConfig.tables.targets,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `ORG#${orgId}` },
      };

  const { items } = await ddbQuery(queryParams);
  return c.json({ items });
});

targetsRouter.get('/:targetId', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { targetId } = c.req.param();

  const target = await ddbGet({
    TableName: ImConfig.tables.targets,
    Key: { PK: `ORG#${orgId}`, SK: `TARGET#${targetId}` },
  });

  if (!target) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json(target);
});

targetsRouter.post('/', requireRole('ADMIN'), zValidator('json', CreateTargetSchema), async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const body = c.req.valid('json');
  const targetId = ulid();
  const now = new Date().toISOString();

  const item = {
    PK: `ORG#${orgId}`,
    SK: `TARGET#${targetId}`,
    targetId,
    orgId,
    alarmName: body.alarmName,
    accountId: body.accountId,
    region: body.region,
    serviceName: body.serviceName,
    description: body.description ?? '',
    enabled: true,
    createdBy: claims['cognito:username'],
    createdAt: now,
    updatedAt: now,
    GSI1PK: `ACCOUNT#${body.accountId}`,
    GSI1SK: body.alarmName,
  };

  await ddbPut({ TableName: ImConfig.tables.targets, Item: item });
  return c.json(item, 201);
});
