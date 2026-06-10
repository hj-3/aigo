import type { ISODateString, OrgId, RepoId, UserId } from '../common.js';

export type VcsProvider = 'github';

export interface RepoAnalysisConfig {
  readonly enableCodeReview: boolean;
  readonly enableInfraReview: boolean;
  readonly enableSecurityScan: boolean;
  readonly riskThreshold: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  readonly excludePaths: readonly string[];
  readonly requireApprovalOnHigh: boolean;
}

export interface RepositoryItem {
  readonly PK: `REPO#${RepoId}`;
  readonly SK: 'METADATA';
  readonly repoId: RepoId;
  readonly orgId: OrgId;
  readonly provider: VcsProvider;
  readonly providerRepoId: string;
  readonly fullName: string; // "org/repo"
  readonly name: string;
  readonly defaultBranch: string;
  readonly isPrivate: boolean;
  readonly language?: string;
  readonly config: RepoAnalysisConfig;
  readonly webhookId?: string;
  readonly registeredBy: UserId;
  readonly isActive: boolean;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
  // GSI1: orgId + provider
  readonly GSI1PK: `ORG#${OrgId}`;
  readonly GSI1SK: `${VcsProvider}#${string}`; // "github#2024-01-01T..."
}

export interface Repository
  extends Omit<RepositoryItem, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK'> {}
