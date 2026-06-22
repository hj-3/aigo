import { Hono } from 'hono';
import { ddbGet, ddbQuery, ddbUpdate } from '@aigo/aws-clients';
import { requireAuth, extractClaims } from '../middleware/auth.js';
import { ImConfig } from '../config.js';

export const remediationsRouter = new Hono();

remediationsRouter.use('*', requireAuth());

remediationsRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const incidentId = c.req.query('incidentId');

  const queryParams: Parameters<typeof ddbQuery>[0] = incidentId
    ? {
        TableName: ImConfig.tables.remediations,
        IndexName: 'GSI1-orgId-incident-index',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':sk': `INCIDENT#${incidentId}` },
        ScanIndexForward: true,
      }
    : {
        TableName: ImConfig.tables.remediations,
        IndexName: 'GSI1-orgId-incident-index',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `ORG#${orgId}` },
        ScanIndexForward: false,
        Limit: 100,
      };

  const { items } = await ddbQuery(queryParams);
  return c.json({ items });
});

remediationsRouter.post('/:actionId/execute', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { actionId } = c.req.param();

  const action = await ddbGet({
    TableName: ImConfig.tables.remediations,
    Key: { PK: `REMEDIATION#${actionId}`, SK: 'METADATA' },
  });

  if (!action || (action as Record<string, string>)['orgId'] !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  if ((action as Record<string, string>)['status'] !== 'PENDING') {
    return c.json({ error: 'ACTION_NOT_PENDING' }, 422);
  }

  const a = action as Record<string, unknown>;

  // Flatten action fields so action-executor can read them directly from event
  const executorPayload = {
    actionId,
    orgId,
    incidentId: a['incidentId'] ?? '',
    actionType: a['actionType'] ?? 'MANUAL',
    params: a['params'] ?? {},
    crossAccountRoleArn: a['crossAccountRoleArn'] ?? null,
    description: a['description'] ?? '',
    targetResource: a['targetResource'] ?? '',
  };

  const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
  const lambda = new LambdaClient({ region: ImConfig.region });
  await lambda.send(new InvokeCommand({
    FunctionName: process.env['IM_ACTION_EXECUTOR_FUNCTION'] ?? 'aigo-im-action-executor:live',
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify(executorPayload)),
  }));

  await ddbUpdate({
    TableName: ImConfig.tables.remediations,
    Key: { PK: `REMEDIATION#${actionId}`, SK: 'METADATA' },
    UpdateExpression: 'SET #s = :s, executedAt = :now',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':s': 'RUNNING', ':now': new Date().toISOString() },
  });

  return c.json({ actionId, status: 'RUNNING' });
});
