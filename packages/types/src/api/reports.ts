import type { PaginationInput, PaginatedResult, ReportId } from '../common.js';
import type { Report } from '../dynamo/report.js';
import type { Finding } from '../dynamo/finding.js';

export interface ListReportsInput extends PaginationInput {
  readonly repoId?: string;
  readonly approvalStatus?: string;
  readonly riskLevel?: string;
  readonly from?: string;
  readonly to?: string;
}

export type ListReportsOutput = PaginatedResult<Report>;

export interface GetReportInput {
  readonly reportId: ReportId;
}

export interface GetReportOutput {
  readonly report: Report;
  readonly findings: readonly Finding[];
}
