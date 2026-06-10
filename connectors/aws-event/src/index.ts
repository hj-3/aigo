import type { EventBridgeEvent, Context } from 'aws-lambda';
import { ddbPut, sqsSendMessage, Config } from '@aigo/aws-clients';
import { getLogger, createContextLogger } from '@aigo/logger';
import { randomUUID } from 'node:crypto';

const logger = getLogger('aws-event-connector');

interface CloudWatchAlarmStateChange {
  readonly alarmName: string;
  readonly state: { readonly value: string };
  readonly previousState: { readonly value: string };
  readonly configuration: { readonly description?: string };
}

function ulid(): string {
  return Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 9).toUpperCase();
}

export async function handler(
  event: EventBridgeEvent<'CloudWatch Alarm State Change', CloudWatchAlarmStateChange>,
  _context: Context,
): Promise<void> {
  const requestId = randomUUID();
  const log = createContextLogger({ requestId, source: 'aws-event-connector' });

  const { detail, resources, region, account } = event;

  // Only process ALARM state transitions
  if (detail.state.value !== 'ALARM') {
    log.info('Skipping non-ALARM state change', { state: detail.state.value });
    return;
  }

  log.info('CloudWatch alarm triggered', { alarmName: detail.alarmName, region });

  // Resolve orgId from alarm tags or environment
  // In production, use resource tags to map alarm → orgId
  const orgId = process.env['DEFAULT_ORG_ID'];
  if (!orgId) {
    log.warn('DEFAULT_ORG_ID not set, cannot map alarm to organization');
    return;
  }

  const incidentId = ulid();
  const now = new Date().toISOString();
  const alarmArn = resources[0] ?? '';
  const serviceId = deriveServiceId(detail.alarmName);

  const incidentItem = {
    PK: `INCIDENT#${incidentId}`,
    SK: 'METADATA',
    incidentId,
    orgId,
    serviceId,
    title: `CloudWatch Alarm: ${detail.alarmName}`,
    description: detail.configuration.description ?? detail.alarmName,
    severity: 'HIGH',
    status: 'OPEN',
    source: 'cloudwatch_alarm',
    awsAlarmArn: alarmArn,
    awsRegion: region,
    affectedResources: resources,
    createdAt: now,
    updatedAt: now,
    GSI1PK: `ORG#${orgId}`,
    GSI1SK: now,
    GSI2PK: `SVC#${serviceId}#OPEN`,
    GSI2SK: now,
  };

  await ddbPut({ TableName: Config.tableName('Incidents'), Item: incidentItem });

  const sqsPayload = {
    type: 'INCIDENT_TRIGGERED',
    messageId: randomUUID(),
    timestamp: now,
    source: 'aws-event',
    incidentId,
    orgId,
    serviceId,
    incidentSource: 'cloudwatch_alarm',
    awsAlarmArn: alarmArn,
    awsRegion: region,
    title: incidentItem.title,
    affectedResources: resources,
  };

  await sqsSendMessage(Config.sqs.incidentQueueUrl, sqsPayload, {
    messageGroupId: `${orgId}#${serviceId}`,
    messageDeduplicationId: `incident-${incidentId}`,
  });

  log.info('Incident created', { incidentId, serviceId, orgId });
}

function deriveServiceId(alarmName: string): string {
  // Extract service name from alarm naming convention: "<project>-<service>-<metric>"
  const parts = alarmName.split('-');
  return parts.slice(1, -1).join('-') || 'unknown-service';
}
