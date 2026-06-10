import type { ReportId } from '../common.js';
import type { Approval } from '../dynamo/approval.js';
import type { ApprovalDecision } from '../dynamo/approval.js';

export interface CreateApprovalInput {
  readonly reportId: ReportId;
  readonly decision: ApprovalDecision;
  readonly comment?: string;
}

export interface CreateApprovalOutput {
  readonly approval: Approval;
}
