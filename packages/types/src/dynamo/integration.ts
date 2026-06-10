import type { ISODateString, IntegrationId, OrgId, UserId } from '../common.js';

export type IntegrationType = 'github_app' | 'slack' | 'pagerduty' | 'jira';
export type IntegrationStatus = 'active' | 'inactive' | 'error';

export interface IntegrationItem {
  readonly PK: `INT#${IntegrationId}`;
  readonly SK: 'METADATA';
  readonly integrationId: IntegrationId;
  readonly orgId: OrgId;
  readonly type: IntegrationType;
  readonly status: IntegrationStatus;
  readonly externalId: string;      // GitHub installation ID, Slack workspace ID, etc.
  readonly externalName: string;    // Human-readable name
  readonly secretArn: string;       // Secrets Manager ARN for credentials
  readonly metadata: Record<string, string>;
  readonly installedBy: UserId;
  readonly lastHealthCheckAt?: ISODateString;
  readonly errorMessage?: string;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
  // GSI1: orgId + type
  readonly GSI1PK: `ORG#${OrgId}`;
  readonly GSI1SK: `${IntegrationType}#${ISODateString}`;
}

export interface Integration
  extends Omit<IntegrationItem, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK'> {}
