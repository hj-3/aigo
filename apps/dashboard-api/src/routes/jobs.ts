import { Hono } from 'hono';
import { ddbGet, ddbQuery, Config } from '@aigo/aws-clients';
import { requireAuth, extractClaims } from '../middleware/auth.js';

export const jobsRouter = new Hono();

jobsRouter.use('*', requireAuth());

jobsRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const status = c.req.query('status') ?? 'PENDING';

  const { items } = await ddbQuery({
    TableName: Config.tableName('AnalysisJobs'),
    IndexName: 'GSI2-orgStatus-createdAt-index',
    KeyConditionExpression: 'GSI2PK = :pk',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}#${status}` },
    ScanIndexForward: false,
    Limit: 50,
  });

  return c.json(items);
});

// GET /jobs/active — PENDING + IN_PROGRESS jobs combined (for dashboard live view)
jobsRouter.get('/active', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];

  const [pending, inProgress] = await Promise.all([
    ddbQuery({
      TableName: Config.tableName('AnalysisJobs'),
      IndexName: 'GSI2-orgStatus-createdAt-index',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': `ORG#${orgId}#PENDING` },
      ScanIndexForward: false,
      Limit: 20,
    }),
    ddbQuery({
      TableName: Config.tableName('AnalysisJobs'),
      IndexName: 'GSI2-orgStatus-createdAt-index',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': `ORG#${orgId}#IN_PROGRESS` },
      ScanIndexForward: false,
      Limit: 20,
    }),
  ]);

  const combined = [...inProgress.items, ...pending.items]
    .sort((a, b) => {
      const aTime = (a as Record<string, string>)['createdAt'] ?? '';
      const bTime = (b as Record<string, string>)['createdAt'] ?? '';
      return bTime.localeCompare(aTime);
    })
    .slice(0, 10);

  return c.json(combined);
});

jobsRouter.get('/agent-runs', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const jobId = c.req.query('jobId');

  if (!jobId) {
    return c.json({ error: 'MISSING_PARAM', message: 'jobId query parameter required' }, 400);
  }

  // Verify the job belongs to this org before returning agent runs
  const job = await ddbGet({
    TableName: Config.tableName('AnalysisJobs'),
    Key: { PK: `JOB#${jobId}`, SK: 'METADATA' },
  });

  if (!job || (job as Record<string, string>)['orgId'] !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  const { items } = await ddbQuery({
    TableName: Config.tableName('AgentRuns'),
    IndexName: 'GSI1-jobId-agentType-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `JOB#${jobId}` },
    ScanIndexForward: true,
  });

  return c.json(items);
});

jobsRouter.get('/:jobId', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { jobId } = c.req.param();

  const job = await ddbGet({
    TableName: Config.tableName('AnalysisJobs'),
    Key: { PK: `JOB#${jobId}`, SK: 'METADATA' },
  });

  if (!job || (job as Record<string, string>)['orgId'] !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  return c.json(job);
});
