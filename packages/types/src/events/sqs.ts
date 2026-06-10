import type { FixId, ISODateString, IncidentId, JobId, OrgId, RepoId, SourceChannel, UserId } from '../common.js';
import type { IncidentSource } from '../dynamo/incident.js';
import type { JobType } from '../dynamo/analysis-job.js';

/** Base envelope for all SQS messages */
interface SqsMessageBase {
  readonly messageId: string;
  readonly timestamp: ISODateString;
  readonly source: SourceChannel;
}

// ──────────────────────────────────────────────────────────────────────────────
// analysis-queue
// ──────────────────────────────────────────────────────────────────────────────
export interface AnalysisQueueMessage extends SqsMessageBase {
  readonly type: 'ANALYSIS_REQUESTED';
  readonly jobId: JobId;
  readonly orgId: OrgId;
  readonly repoId: RepoId;
  readonly jobType: JobType;
  readonly triggeredBy: UserId;
  readonly idempotencyKey: string;
  readonly prContext?: {
    readonly prNumber: number;
    readonly prTitle: string;
    readonly prUrl: string;
    readonly commitSha: string;
    readonly baseBranch: string;
    readonly headBranch: string;
    readonly authorLogin: string;
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// fix-queue
// ──────────────────────────────────────────────────────────────────────────────
export interface FixQueueMessage extends SqsMessageBase {
  readonly type: 'FIX_REQUESTED';
  readonly fixId: FixId;
  readonly jobId: JobId;
  readonly orgId: OrgId;
  readonly repoId: RepoId;
  readonly requestedBy: UserId;
  readonly targetFindings: readonly string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// incident-queue
// ──────────────────────────────────────────────────────────────────────────────
export interface IncidentQueueMessage extends SqsMessageBase {
  readonly type: 'INCIDENT_TRIGGERED';
  readonly incidentId: IncidentId;
  readonly orgId: OrgId;
  readonly serviceId: string;
  readonly incidentSource: IncidentSource;
  readonly awsAlarmArn?: string;
  readonly awsRegion: string;
  readonly title: string;
  readonly affectedResources: readonly string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// command-queue
// ──────────────────────────────────────────────────────────────────────────────
export type CommandType = 'APPROVE' | 'REJECT' | 'REQUEST_FIX' | 'RERUN' | 'INVESTIGATE';

export interface CommandQueueMessage extends SqsMessageBase {
  readonly type: 'COMMAND';
  readonly command: CommandType;
  readonly reportId?: string;
  readonly orgId: OrgId;
  readonly actorId: UserId;
  readonly comment?: string;
  readonly targetFindings?: readonly string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// notification-queue
// ──────────────────────────────────────────────────────────────────────────────
export type NotificationType =
  | 'ANALYSIS_COMPLETE'
  | 'HIGH_RISK_DETECTED'
  | 'FIX_READY'
  | 'FIX_APPLIED'
  | 'INCIDENT_DETECTED'
  | 'INCIDENT_RESOLVED'
  | 'APPROVAL_NEEDED';

export interface NotificationQueueMessage extends SqsMessageBase {
  readonly type: 'NOTIFICATION';
  readonly notificationType: NotificationType;
  readonly orgId: OrgId;
  readonly recipients: readonly string[];   // userId[]
  readonly payload: Record<string, unknown>;
  readonly slackChannel?: string;
}

export type SqsMessagePayload =
  | AnalysisQueueMessage
  | FixQueueMessage
  | IncidentQueueMessage
  | CommandQueueMessage
  | NotificationQueueMessage;
