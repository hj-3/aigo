import type {
  ISODateString,
  JobId,
  OrgId,
  RepoId,
  ReportId,
  RiskLevel,
} from '../common.js';

export type ApprovalStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'AUTO_APPROVED';
export type MergeRecommendation =
  | 'APPROVE'
  | 'APPROVE_WITH_FIXES'
  | 'REQUEST_CHANGES'
  | 'BLOCK';

export interface AgentSummaries {
  readonly codeReview?: string;
  readonly infraReview?: string;
  readonly securityReview?: string;
  readonly riskAssessment: string;
}

export interface ReportItem {
  readonly PK: `REPORT#${ReportId}`;
  readonly SK: 'METADATA';
  readonly reportId: ReportId;
  readonly jobId: JobId;
  readonly orgId: OrgId;
  readonly repoId: RepoId;
  readonly riskScore: number;       // 0-100
  readonly riskLevel: RiskLevel;
  readonly mergeRecommendation: MergeRecommendation;
  readonly approvalStatus: ApprovalStatus;
  readonly findingCounts: {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
    readonly info: number;
    readonly total: number;
  };
  readonly agentSummaries: AgentSummaries;
  readonly reportS3Key?: string;
  readonly githubCheckRunId?: number;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
  // GSI1: jobId
  readonly GSI1PK: `JOB#${JobId}`;
  readonly GSI1SK: ISODateString;
  // GSI2: repoId + createdAt
  readonly GSI2PK: `REPO#${RepoId}`;
  readonly GSI2SK: ISODateString;
  // GSI3: orgId#approvalStatus + createdAt
  readonly GSI3PK: `ORG#${OrgId}#${ApprovalStatus}`;
  readonly GSI3SK: ISODateString;
}

export interface Report
  extends Omit<ReportItem, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK' | 'GSI2PK' | 'GSI2SK' | 'GSI3PK' | 'GSI3SK'> {}
