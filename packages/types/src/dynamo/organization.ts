import type { ISODateString, OrgId, RiskLevel } from '../common.js';

export type OrgPlan = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE';

export interface OrgSettings {
  readonly maxReposPerMonth: number;
  readonly riskThreshold: RiskLevel;
  readonly autoAnalyzeOnPR: boolean;
  readonly requireApprovalForFix: boolean;
  readonly defaultBranch: string;
  readonly slackWorkspaceId?: string;
  readonly slackDefaultChannel?: string;
  readonly allowedAgentTypes: readonly string[];
  readonly retentionDays: number;
}

export interface OrganizationItem {
  readonly PK: `ORG#${OrgId}`;
  readonly SK: 'METADATA';
  readonly orgId: OrgId;
  readonly name: string;
  readonly slug: string;
  readonly plan: OrgPlan;
  readonly settings: OrgSettings;
  readonly githubInstallationId?: string;
  readonly slackTeamId?: string;
  readonly isActive: boolean;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

export interface Organization
  extends Omit<OrganizationItem, 'PK' | 'SK'> {}
