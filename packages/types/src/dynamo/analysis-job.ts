import type { ISODateString, JobId, OrgId, RepoId, SourceChannel, UserId } from '../common.js';

export type JobType = 'PR_ANALYSIS' | 'INCIDENT' | 'MANUAL' | 'SCHEDULED';
export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface PrContext {
  readonly prNumber: number;
  readonly prTitle: string;
  readonly prUrl: string;
  readonly commitSha: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly authorLogin: string;
  readonly diffS3Key: string;
}

export interface AnalysisJobItem {
  readonly PK: `JOB#${JobId}`;
  readonly SK: 'METADATA';
  readonly jobId: JobId;
  readonly orgId: OrgId;
  readonly repoId: RepoId;
  readonly type: JobType;
  readonly status: JobStatus;
  readonly source: SourceChannel;
  readonly prContext?: PrContext;
  readonly triggeredBy: UserId;
  readonly idempotencyKey: string;
  readonly retryCount: number;
  readonly errorMessage?: string;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
  readonly startedAt?: ISODateString;
  readonly completedAt?: ISODateString;
  // GSI1: repoId + createdAt
  readonly GSI1PK: `REPO#${RepoId}`;
  readonly GSI1SK: ISODateString;
  // GSI2: orgId#status + createdAt
  readonly GSI2PK: `ORG#${OrgId}#${JobStatus}`;
  readonly GSI2SK: ISODateString;
}

export interface AnalysisJob
  extends Omit<AnalysisJobItem, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK' | 'GSI2PK' | 'GSI2SK'> {}
