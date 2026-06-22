import { Hono } from 'hono';
import { ddbGet, ddbQuery } from '@aigo/aws-clients';
import { requireAuth, extractClaims } from '../middleware/auth.js';
import { ImConfig } from '../config.js';

export const reportsRouter = new Hono();

reportsRouter.use('*', requireAuth());

reportsRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 50);

  const { items } = await ddbQuery({
    TableName: ImConfig.tables.reports,
    IndexName: 'GSI1-orgId-generatedAt-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}` },
    ScanIndexForward: false,
    Limit: limit,
  });

  return c.json({ items });
});

reportsRouter.get('/:reportId', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { reportId } = c.req.param();

  const report = await ddbGet({
    TableName: ImConfig.tables.reports,
    Key: { PK: `REPORT#${reportId}`, SK: 'METADATA' },
  });

  if (!report || (report as Record<string, string>)['orgId'] !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  return c.json(report);
});

reportsRouter.get('/:reportId/download', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { reportId } = c.req.param();

  const report = await ddbGet({
    TableName: ImConfig.tables.reports,
    Key: { PK: `REPORT#${reportId}`, SK: 'METADATA' },
  });

  if (!report || (report as Record<string, string>)['orgId'] !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  const s3Key = (report as Record<string, string>)['s3Key'];
  if (!s3Key) return c.json({ error: 'REPORT_NOT_READY' }, 404);

  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const s3 = new S3Client({ region: ImConfig.region });
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: ImConfig.reportsBucket, Key: s3Key }),
    { expiresIn: 300 },
  );

  return c.json({ url });
});
