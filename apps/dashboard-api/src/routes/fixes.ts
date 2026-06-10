import { Hono } from 'hono';
import { ddbGet, ddbQuery, Config } from '@aigo/aws-clients';
import { requireAuth, extractClaims } from '../middleware/auth.js';

export const fixesRouter = new Hono();

fixesRouter.use('*', requireAuth());

fixesRouter.get('/:fixId', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { fixId } = c.req.param();

  const fix = await ddbGet({
    TableName: Config.tableName('FixRequests'),
    Key: { PK: `FIX#${fixId}`, SK: 'METADATA' },
  });

  if (!fix || (fix as Record<string, string>)['orgId'] !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  return c.json(fix);
});

// List all fix requests for a specific report
fixesRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const reportId = c.req.query('reportId');

  if (reportId) {
    const { items } = await ddbQuery({
      TableName: Config.tableName('FixRequests'),
      IndexName: 'GSI1-reportId-status-index',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `REPORT#${reportId}` },
      ScanIndexForward: false,
    });
    // Filter by orgId (GSI does not contain orgId in the key)
    return c.json(
      (items as Record<string, string>[]).filter((item) => item['orgId'] === orgId),
    );
  }

  // List by org + status
  const status = c.req.query('status') ?? 'PENDING';
  const { items } = await ddbQuery({
    TableName: Config.tableName('FixRequests'),
    IndexName: 'GSI2-orgStatus-createdAt-index',
    KeyConditionExpression: 'GSI2PK = :pk',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}#${status}` },
    ScanIndexForward: false,
    Limit: 50,
  });

  return c.json(items);
});
