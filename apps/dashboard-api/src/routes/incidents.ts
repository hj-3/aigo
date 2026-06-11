import { Hono } from 'hono';
import { ddbGet, ddbQuery, Config } from '@aigo/aws-clients';
import { requireAuth, extractClaims } from '../middleware/auth.js';

export const incidentsRouter = new Hono();

incidentsRouter.use('*', requireAuth());

incidentsRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];

  const { items } = await ddbQuery({
    TableName: Config.tableName('Incidents'),
    IndexName: 'GSI1-orgId-createdAt-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}` },
    ScanIndexForward: false,
    Limit: 50,
  });

  return c.json(items);
});

incidentsRouter.get('/:incidentId', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { incidentId } = c.req.param();

  const incident = await ddbGet({
    TableName: Config.tableName('Incidents'),
    Key: { PK: `INCIDENT#${incidentId}`, SK: 'METADATA' },
  });

  if (!incident || (incident as Record<string, string>)['orgId'] !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  return c.json(incident);
});
