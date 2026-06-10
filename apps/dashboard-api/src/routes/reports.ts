import { Hono } from 'hono';
import { ddbGet, ddbQuery, Config } from '@aigo/aws-clients';
import { requireAuth, extractClaims } from '../middleware/auth.js';

export const reportsRouter = new Hono();

reportsRouter.use('*', requireAuth());

reportsRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];

  const { items } = await ddbQuery({
    TableName: Config.tableName('Reports'),
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}` },
    ScanIndexForward: false,
    Limit: 50,
  });

  return c.json(items);
});

reportsRouter.get('/:reportId', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { reportId } = c.req.param();

  const report = await ddbGet({
    TableName: Config.tableName('Reports'),
    Key: { PK: `REPORT#${reportId}`, SK: 'METADATA' },
  });

  if (!report || (report as Record<string, string>)['orgId'] !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  // Fetch findings for this report
  const jobId = (report as Record<string, string>)['jobId'];
  const { items: findings } = await ddbQuery({
    TableName: Config.tableName('Findings'),
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `JOB#${jobId}` },
    ScanIndexForward: false,
  });

  return c.json({ ...report, findings });
});
