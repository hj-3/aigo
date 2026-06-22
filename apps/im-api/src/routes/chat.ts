import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { ddbGet, ddbQuery } from '@aigo/aws-clients';
import { requireAuth, extractClaims } from '../middleware/auth.js';
import { ImConfig } from '../config.js';

export const chatRouter = new Hono();

chatRouter.use('*', requireAuth());

const lambda = new LambdaClient({ region: process.env.AWS_REGION ?? 'ap-northeast-2' });

const CHAT_AGENT_FUNCTION = process.env.IM_CHAT_AGENT_FUNCTION ?? 'aigo-im-chat-agent:live';

const SendMessageSchema = z.object({
  message: z.string().min(1).max(4096),
  convId: z.string().optional(),
});

chatRouter.get('/:incidentId', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const { incidentId } = c.req.param();

  const { items } = await ddbQuery({
    TableName: ImConfig.tables.conversations,
    IndexName: 'GSI1-orgId-userId-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `INCIDENT#${incidentId}#ORG#${orgId}` },
    ScanIndexForward: true,
    Limit: 100,
  });

  return c.json({ items });
});

chatRouter.post('/:incidentId', zValidator('json', SendMessageSchema), async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const userId = claims['cognito:username'];
  const { incidentId } = c.req.param();
  const { message, convId } = c.req.valid('json');

  // Verify incident ownership
  const incident = await ddbGet({
    TableName: ImConfig.tables.incidents,
    Key: { PK: `INCIDENT#${incidentId}`, SK: 'METADATA' },
  });

  if (!incident || (incident as Record<string, string>)['orgId'] !== orgId) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  // Invoke chat agent Lambda synchronously
  const payload = JSON.stringify({ incidentId, orgId, userId, message, convId });
  const command = new InvokeCommand({
    FunctionName: CHAT_AGENT_FUNCTION,
    InvocationType: 'RequestResponse',
    Payload: Buffer.from(payload),
  });

  const lambdaResp = await lambda.send(command);
  const resultBytes = lambdaResp.Payload;
  if (!resultBytes) {
    return c.json({ error: 'CHAT_AGENT_ERROR' }, 502);
  }

  const result = JSON.parse(Buffer.from(resultBytes).toString());
  if (result.statusCode !== 200) {
    return c.json({ error: result.body ?? 'CHAT_AGENT_ERROR' }, 502);
  }

  const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
  return c.json(body);
});
