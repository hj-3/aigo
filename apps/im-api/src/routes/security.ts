import { Hono } from 'hono';
import { ddbGet, ddbQuery } from '@aigo/aws-clients';
import { requireAuth, extractClaims } from '../middleware/auth.js';
import { ImConfig } from '../config.js';

export const securityRouter = new Hono();

securityRouter.use('*', requireAuth());

securityRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const severity = c.req.query('severity');
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 100);

  const queryParams: Parameters<typeof ddbQuery>[0] = {
    TableName: ImConfig.tables.securityEvents,
    IndexName: 'GSI1-orgId-severity-index',
    KeyConditionExpression: severity
      ? 'GSI1PK = :pk AND GSI1SK = :sk'
      : 'GSI1PK = :pk',
    ExpressionAttributeValues: severity
      ? { ':pk': `ORG#${orgId}`, ':sk': `SEVERITY#${severity}` }
      : { ':pk': `ORG#${orgId}` },
    ScanIndexForward: false,
    Limit: limit,
  };

  const { items } = await ddbQuery(queryParams);
  return c.json({ items });
});

securityRouter.get('/:eventId', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { eventId } = c.req.param();

  const event = await ddbGet({
    TableName: ImConfig.tables.securityEvents,
    Key: { PK: `SECEVENT#${eventId}`, SK: 'METADATA' },
  });

  if (!event || (event as Record<string, string>)['orgId'] !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  return c.json(event);
});
