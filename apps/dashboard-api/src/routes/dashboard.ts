import { Hono } from 'hono';
import { ddbQuery, Config } from '@aigo/aws-clients';
import { requireAuth, extractClaims } from '../middleware/auth.js';

export const dashboardRouter = new Hono();

dashboardRouter.use('*', requireAuth());

dashboardRouter.get('/stats', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Parallel queries for stats
  const [pendingJobs, openIncidents, approvedToday, recentReports] = await Promise.all([
    ddbQuery<{ jobId: string }>({
      TableName: Config.tableName('AnalysisJobs'),
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': `ORG#${orgId}#PENDING` },
      Select: 'COUNT',
    }),
    ddbQuery<{ incidentId: string }>({
      TableName: Config.tableName('Incidents'),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':status': 'OPEN' },
      Select: 'COUNT',
    }),
    ddbQuery<{ approvalId: string }>({
      TableName: Config.tableName('Approvals'),
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK >= :today',
      FilterExpression: 'decision = :approved',
      ExpressionAttributeValues: {
        ':pk': `ORG#${orgId}`,
        ':today': today.toISOString(),
        ':approved': 'APPROVED',
      },
      Select: 'COUNT',
    }),
    ddbQuery<{ reportId: string; repoId: string; riskLevel: string; mergeRecommendation: string; createdAt: string }>({
      TableName: Config.tableName('Reports'),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `ORG#${orgId}` },
      ScanIndexForward: false,
      Limit: 10,
    }),
  ]);

  return c.json({
    totalJobs: 0, // would need separate count query
    pendingJobs: pendingJobs.items.length,
    openIncidents: openIncidents.items.length,
    approvedToday: approvedToday.items.length,
    recentReports: recentReports.items.map((r) => ({
      ...r,
      repoName: r.repoId,
    })),
  });
});
