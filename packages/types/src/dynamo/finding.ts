import type {
  AgentType,
  FindingId,
  ISODateString,
  RepoId,
  ReportId,
  Severity,
} from '../common.js';

export type FindingCategory =
  | 'security'
  | 'quality'
  | 'performance'
  | 'cost'
  | 'compliance'
  | 'style'
  | 'infrastructure'
  | 'dependency';

export interface FindingLocation {
  readonly file: string;
  readonly startLine: number;
  readonly endLine?: number;
  readonly column?: number;
}

export interface FindingItem {
  readonly PK: `FINDING#${FindingId}`;
  readonly SK: 'METADATA';
  readonly findingId: FindingId;
  readonly reportId: ReportId;
  readonly repoId: RepoId;
  readonly agent: AgentType;
  readonly severity: Severity;
  readonly category: FindingCategory;
  readonly title: string;
  readonly description: string;
  readonly evidence: string;
  readonly location?: FindingLocation;
  readonly fixable: boolean;
  readonly confidence: number;        // 0.0 - 1.0
  readonly fixSuggestion?: string;
  readonly ruleId?: string;
  readonly references?: readonly string[];
  readonly createdAt: ISODateString;
  // GSI1: reportId + severity
  readonly GSI1PK: `REPORT#${ReportId}`;
  readonly GSI1SK: `${Severity}#${ISODateString}`;
  // GSI2: repoId#category + createdAt
  readonly GSI2PK: `REPO#${RepoId}#${FindingCategory}`;
  readonly GSI2SK: ISODateString;
}

export interface Finding
  extends Omit<FindingItem, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK' | 'GSI2PK' | 'GSI2SK'> {}

/** Canonical Finding payload emitted by agents (before DynamoDB storage). */
export interface AgentFinding {
  readonly agent: AgentType;
  readonly severity: Severity;
  readonly category: FindingCategory;
  readonly title: string;
  readonly description: string;
  readonly evidence: string;
  readonly location?: FindingLocation;
  readonly fixable: boolean;
  readonly confidence: number;
  readonly fixSuggestion?: string;
  readonly ruleId?: string;
  readonly references?: readonly string[];
}
