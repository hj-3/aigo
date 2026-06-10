import type { AgentType, ISODateString, JobId, OrgId, RunId } from '../common.js';

export type AgentRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export interface AgentRunItem {
  readonly PK: `RUN#${RunId}`;
  readonly SK: 'METADATA';
  readonly runId: RunId;
  readonly jobId: JobId;
  readonly orgId: OrgId;
  readonly agentType: AgentType;
  readonly status: AgentRunStatus;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
  readonly rawOutputS3Key?: string;
  readonly errorMessage?: string;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
  readonly completedAt?: ISODateString;
  // GSI1: jobId + agentType
  readonly GSI1PK: `JOB#${JobId}`;
  readonly GSI1SK: `${AgentType}#${ISODateString}`;
}

export interface AgentRun
  extends Omit<AgentRunItem, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK'> {}
