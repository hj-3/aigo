import type { ISODateString, LogId, OrgId, UserId } from '../common.js';

export type AuditAction =
  | 'org.created' | 'org.updated' | 'org.deleted'
  | 'user.invited' | 'user.role_changed' | 'user.removed'
  | 'repo.registered' | 'repo.deregistered'
  | 'job.created' | 'job.cancelled'
  | 'report.viewed'
  | 'approval.approved' | 'approval.rejected'
  | 'fix.requested' | 'fix.approved' | 'fix.rejected' | 'fix.applied'
  | 'incident.created' | 'incident.resolved'
  | 'settings.updated'
  | 'integration.connected' | 'integration.disconnected'
  | 'api_key.created' | 'api_key.revoked';

export interface AuditLogItem {
  readonly PK: `LOG#${LogId}`;         // ULID — naturally time-sortable
  readonly SK: 'METADATA';
  readonly logId: LogId;
  readonly orgId: OrgId;
  readonly actorId: UserId | 'system';
  readonly actorEmail?: string;
  readonly action: AuditAction;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly changes?: Record<string, { readonly before: unknown; readonly after: unknown }>;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly requestId: string;
  readonly createdAt: ISODateString;
  readonly ttl: number;                 // Unix timestamp, 90-day TTL
  // GSI1: orgId + createdAt
  readonly GSI1PK: `ORG#${OrgId}`;
  readonly GSI1SK: ISODateString;
  // GSI2: actorId + createdAt
  readonly GSI2PK: `ACTOR#${string}`;
  readonly GSI2SK: ISODateString;
}

export interface AuditLog
  extends Omit<AuditLogItem, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK' | 'GSI2PK' | 'GSI2SK'> {}
