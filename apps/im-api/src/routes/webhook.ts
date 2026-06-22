import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { ddbGet, ddbPut, ddbQuery } from '@aigo/aws-clients';
import { ImConfig } from '../config.js';
import { ulid } from 'ulid';

export const webhookRouter = new Hono();

// No JWT auth — webhook token validated per-request against integration record

async function findIntegration(integrationId: string): Promise<Record<string, unknown> | null> {
  // GSI1-integrationId-index returns PK + SK (KEYS_ONLY projection)
  const { items } = await ddbQuery({
    TableName: ImConfig.tables.integrations,
    IndexName: 'GSI1-integrationId-index',
    KeyConditionExpression: 'GSI1PK = :id',
    ExpressionAttributeValues: { ':id': integrationId },
    Limit: 1,
  });

  if (items.length === 0) return null;

  // Fetch full item using PK + SK returned by the GSI
  const key = items[0] as Record<string, string>;
  return ddbGet({
    TableName: ImConfig.tables.integrations,
    Key: { PK: key['PK'], SK: key['SK'] },
  }) as Promise<Record<string, unknown> | null>;
}

function timingSafeEqual_(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) {
      // Still compare to avoid timing leak on length
      timingSafeEqual(ab, Buffer.alloc(ab.length));
      return false;
    }
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

webhookRouter.post('/:integrationId', async (c) => {
  const { integrationId } = c.req.param();
  const providedToken = c.req.header('X-Webhook-Token') ?? c.req.query('token') ?? '';

  const integration = await findIntegration(integrationId);

  if (!integration) return c.json({ error: 'NOT_FOUND' }, 404);
  if (!(integration['enabled'] as boolean)) return c.json({ error: 'NOT_FOUND' }, 404);

  const expectedToken = (integration['webhookToken'] as string) ?? '';
  if (!expectedToken || !timingSafeEqual_(expectedToken, providedToken)) {
    return c.json({ error: 'FORBIDDEN' }, 403);
  }

  const orgId = integration['orgId'] as string;
  const integrationType = integration['type'] as string;
  const payload = await c.req.json<Record<string, unknown>>();
  const incidentId = ulid();
  const now = new Date().toISOString();

  // Normalize title and severity per integration type
  let title: string;
  let severity: string;

  if (integrationType === 'PAGERDUTY') {
    const msg = (payload['messages'] as Array<Record<string, unknown>>)?.[0] ?? payload;
    title = String((msg['event'] as Record<string, unknown>)?.['description'] ?? 'PagerDuty incident');
    const sev = String((msg['event'] as Record<string, unknown>)?.['data']?.['severity'] ?? 'high');
    severity = sev.toUpperCase();
  } else if (integrationType === 'OPSGENIE') {
    title = String(payload['title'] ?? 'OpsGenie alert');
    const priority = String(payload['priority'] ?? 'P2');
    severity = priority === 'P1' ? 'CRITICAL' : priority === 'P2' ? 'HIGH' : 'MEDIUM';
  } else {
    title = String(payload['title'] ?? payload['summary'] ?? 'Webhook incident');
    severity = String(payload['severity'] ?? 'HIGH').toUpperCase();
  }

  if (!['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(severity)) severity = 'HIGH';

  const item = {
    PK: `INCIDENT#${incidentId}`,
    SK: 'METADATA',
    incidentId,
    orgId,
    source: `WEBHOOK_${integrationType}`,
    integrationId,
    title,
    severity,
    status: 'OPEN',
    affectedServices: (payload['affectedServices'] as string[]) ?? [],
    rawPayload: payload,
    createdAt: now,
    updatedAt: now,
    GSI1PK: `ORG#${orgId}`,
    GSI1SK: 'STATUS#OPEN',
    GSI2PK: 'ACCOUNT#NONE',
    GSI2SK: now,
  };

  await ddbPut({ TableName: ImConfig.tables.incidents, Item: item });

  if (integration['autoInvestigate']) {
    const { SFNClient, StartExecutionCommand } = await import('@aws-sdk/client-sfn');
    const sfn = new SFNClient({ region: ImConfig.region });
    await sfn.send(new StartExecutionCommand({
      stateMachineArn: ImConfig.sfnArn,
      name: `${incidentId}-webhook`,
      input: JSON.stringify({ incidentId, orgId, title, severity }),
    }));
  }

  return c.json({ received: true, incidentId });
});
