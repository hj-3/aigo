import type { FixId, ISODateString, JobId, OrgId, ReportId, UserId } from '../common.js';

export type FixStatus =
  | 'PENDING'
  | 'GENERATING'
  | 'READY_FOR_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'APPLYING'
  | 'APPLIED'
  | 'FAILED';

export interface FixRequestItem {
  readonly PK: `FIX#${FixId}`;
  readonly SK: 'METADATA';
  readonly fixId: FixId;
  readonly reportId: ReportId;
  readonly orgId: OrgId;
  readonly jobId: JobId;
  readonly status: FixStatus;
  readonly requestedBy: UserId;
  readonly approvedBy?: UserId;
  readonly rejectedBy?: UserId;
  readonly fixAgentRunId?: string;
  readonly patchS3Key?: string;
  readonly fixPrNumber?: number;
  readonly fixPrUrl?: string;
  readonly fixBranch?: string;
  readonly targetFindings: readonly string[];   // findingId[]
  readonly comment?: string;
  readonly errorMessage?: string;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
  readonly completedAt?: ISODateString;
  // GSI1: reportId + status
  readonly GSI1PK: `REPORT#${ReportId}`;
  readonly GSI1SK: `${FixStatus}#${ISODateString}`;
  // GSI2: orgId#status + createdAt
  readonly GSI2PK: `ORG#${OrgId}#${FixStatus}`;
  readonly GSI2SK: ISODateString;
}

export interface FixRequest
  extends Omit<FixRequestItem, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK' | 'GSI2PK' | 'GSI2SK'> {}
