import type { ISODateString, OrgId, YearMonth } from '../common.js';

export interface AgentUsage {
  readonly totalRuns: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCostUsd: number;
}

export interface UsageRecordItem {
  readonly PK: `USAGE#${OrgId}#${YearMonth}`;
  readonly SK: 'METADATA';
  readonly orgId: OrgId;
  readonly yearMonth: YearMonth;        // "2024-01"
  readonly analysisJobsCount: number;
  readonly incidentsCount: number;
  readonly fixRequestsCount: number;
  readonly reposAnalyzed: number;
  readonly agentUsage: Record<string, AgentUsage>;   // keyed by AgentType
  readonly totalCostUsd: number;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

export interface UsageRecord
  extends Omit<UsageRecordItem, 'PK' | 'SK'> {}
