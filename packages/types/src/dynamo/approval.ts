import type { ApprovalId, ISODateString, OrgId, ReportId, UserId } from '../common.js';
import type { ApprovalStatus } from './report.js';

export type ApprovalDecision = 'APPROVED' | 'REJECTED';

export interface ApprovalItem {
  readonly PK: `APPROVAL#${ApprovalId}`;
  readonly SK: 'METADATA';
  readonly approvalId: ApprovalId;
  readonly reportId: ReportId;
  readonly orgId: OrgId;
  readonly decision: ApprovalDecision;
  readonly decidedBy: UserId;
  readonly comment?: string;
  readonly previousStatus: ApprovalStatus;
  readonly createdAt: ISODateString;
  // GSI1: reportId
  readonly GSI1PK: `REPORT#${ReportId}`;
  readonly GSI1SK: ISODateString;
  // GSI2: orgId + createdAt
  readonly GSI2PK: `ORG#${OrgId}`;
  readonly GSI2SK: ISODateString;
}

export interface Approval
  extends Omit<ApprovalItem, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK' | 'GSI2PK' | 'GSI2SK'> {}
