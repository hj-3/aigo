import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ddbGet, ddbQuery, ddbPut, ddbUpdate } from '@aigo/aws-clients';
import { requireAuth, requireRole, extractClaims } from '../middleware/auth.js';
import { ImConfig } from '../config.js';
import { ulid } from 'ulid';

export const accountsRouter = new Hono();

accountsRouter.use('*', requireAuth());

const AddAccountSchema = z.object({
  accountId: z.string().regex(/^\d{12}$/),
  accountAlias: z.string().min(1).max(100),
  region: z.string().default('ap-northeast-2'),
  crossAccountRoleArn: z.string().regex(/^arn:aws:iam::/),
});

accountsRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];

  const { items } = await ddbQuery({
    TableName: ImConfig.tables.accounts,
    KeyConditionExpression: 'PK = :pk',
    FilterExpression: '#st <> :removed',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':removed': 'REMOVED' },
  });

  return c.json({ items });
});

accountsRouter.get('/:accountId', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { accountId } = c.req.param();

  const account = await ddbGet({
    TableName: ImConfig.tables.accounts,
    Key: { PK: `ORG#${orgId}`, SK: `ACCOUNT#${accountId}` },
  });

  if (!account) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json(account);
});

accountsRouter.post('/', requireRole('ADMIN'), zValidator('json', AddAccountSchema), async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const body = c.req.valid('json');
  const now = new Date().toISOString();

  const item = {
    PK: `ORG#${orgId}`,
    SK: `ACCOUNT#${body.accountId}`,
    linkId: ulid(),
    orgId,
    accountId: body.accountId,
    accountAlias: body.accountAlias,
    region: body.region,
    crossAccountRoleArn: body.crossAccountRoleArn,
    status: 'ACTIVE',
    createdBy: claims['cognito:username'],
    createdAt: now,
    updatedAt: now,
  };

  await ddbPut({ TableName: ImConfig.tables.accounts, Item: item });
  return c.json(item, 201);
});

accountsRouter.delete('/:accountId', requireRole('ADMIN'), async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { accountId } = c.req.param();

  await ddbUpdate({
    TableName: ImConfig.tables.accounts,
    Key: { PK: `ORG#${orgId}`, SK: `ACCOUNT#${accountId}` },
    UpdateExpression: 'SET #st = :s, updatedAt = :now',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: { ':s': 'REMOVED', ':now': new Date().toISOString() },
  });

  return c.json({ deleted: true });
});
