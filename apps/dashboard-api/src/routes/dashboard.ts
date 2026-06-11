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
      IndexName: 'GSI2-orgStatus-createdAt-index',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': `ORG#${orgId}#PENDING` },
      Limit: 100,
    }),
    ddbQuery<{ incidentId: string }>({
      TableName: Config.tableName('Incidents'),
      IndexName: 'GSI1-orgId-createdAt-index',
      KeyConditionExpression: 'GSI1PK = :pk',
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':status': 'OPEN' },
      Limit: 100,
    }),
    ddbQuery<{ approvalId: string }>({
      TableName: Config.tableName('Approvals'),
      IndexName: 'GSI2-orgId-createdAt-index',
      KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK >= :today',
      FilterExpression: 'decision = :approved',
      ExpressionAttributeValues: {
        ':pk': `ORG#${orgId}`,
        ':today': today.toISOString(),
        ':approved': 'APPROVED',
      },
      Limit: 100,
    }),
    ddbQuery<{ reportId: string; repoId: string; riskLevel: string; mergeRecommendation: string; createdAt: string }>({
      TableName: Config.tableName('Reports'),
      IndexName: 'GSI3-orgApprovalStatus-createdAt-index',
      KeyConditionExpression: 'GSI3PK = :pk',
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
