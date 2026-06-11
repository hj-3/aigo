import { Hono } from 'hono';
import { ddbQuery, Config } from '@aigo/aws-clients';
import { requireAuth, extractClaims } from '../middleware/auth.js';

export const repositoriesRouter = new Hono();

repositoriesRouter.use('*', requireAuth());

repositoriesRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];

  const { items } = await ddbQuery({
    TableName: Config.tableName('Repositories'),
    IndexName: 'GSI1-orgId-provider-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}` },
    ScanIndexForward: false,
  });

  return c.json(items);
});
