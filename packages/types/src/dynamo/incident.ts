import type { IncidentId, ISODateString, OrgId, RiskLevel, UserId } from '../common.js';

export type IncidentStatus = 'OPEN' | 'INVESTIGATING' | 'MITIGATING' | 'RESOLVED' | 'CLOSED';
export type IncidentSource = 'cloudwatch_alarm' | 'eventbridge' | 'manual' | 'slack';

export interface IncidentItem {
  readonly PK: `INCIDENT#${IncidentId}`;
  readonly SK: 'METADATA';
  readonly incidentId: IncidentId;
  readonly orgId: OrgId;
  readonly serviceId: string;         // Logical service name (e.g., "api-gateway", "ecs-worker")
  readonly title: string;
  readonly description: string;
  readonly severity: RiskLevel;
  readonly status: IncidentStatus;
  readonly source: IncidentSource;
  readonly awsAlarmArn?: string;
  readonly awsRegion: string;
  readonly affectedResources: readonly string[];
  readonly rcaS3Key?: string;
  readonly incidentAgentRunId?: string;
  readonly resolvedBy?: UserId;
  readonly resolvedAt?: ISODateString;
  readonly mttr?: number;             // Minutes to resolve
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
  // GSI1: orgId + createdAt
  readonly GSI1PK: `ORG#${OrgId}`;
  readonly GSI1SK: ISODateString;
  // GSI2: serviceId#status + createdAt
  readonly GSI2PK: `SVC#${string}#${IncidentStatus}`;
  readonly GSI2SK: ISODateString;
}

export interface Incident
  extends Omit<IncidentItem, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK' | 'GSI2PK' | 'GSI2SK'> {}
