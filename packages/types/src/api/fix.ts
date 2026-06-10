import type { FixId, ReportId } from '../common.js';
import type { FixRequest } from '../dynamo/fix-request.js';

export interface RequestFixInput {
  readonly reportId: ReportId;
  readonly targetFindings?: readonly string[];  // empty = all fixable findings
  readonly comment?: string;
}

export interface RequestFixOutput {
  readonly fixRequest: FixRequest;
}

export interface GetFixStatusInput {
  readonly fixId: FixId;
}

export interface GetFixStatusOutput {
  readonly fixRequest: FixRequest;
}

export interface ApproveFixInput {
  readonly fixId: FixId;
  readonly comment?: string;
}

export interface RejectFixInput {
  readonly fixId: FixId;
  readonly reason: string;
}
