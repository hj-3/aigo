/**
 * Branded primitive type for nominal typing.
 * Prevents accidental mixing of semantically different string/number values.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

// ──────────────────────────────────────────────────────────────────────────────
// Entity ID types (all ULID strings)
// ──────────────────────────────────────────────────────────────────────────────
export type OrgId = Brand<string, 'OrgId'>;
export type UserId = Brand<string, 'UserId'>;
export type RepoId = Brand<string, 'RepoId'>;
export type IntegrationId = Brand<string, 'IntegrationId'>;
export type JobId = Brand<string, 'JobId'>;
export type RunId = Brand<string, 'RunId'>;
export type ReportId = Brand<string, 'ReportId'>;
export type FindingId = Brand<string, 'FindingId'>;
export type ApprovalId = Brand<string, 'ApprovalId'>;
export type FixId = Brand<string, 'FixId'>;
export type IncidentId = Brand<string, 'IncidentId'>;
export type LogId = Brand<string, 'LogId'>;

export type ISODateString = Brand<string, 'ISODateString'>;
export type YearMonth = Brand<string, 'YearMonth'>; // "YYYY-MM"

// ──────────────────────────────────────────────────────────────────────────────
// Common enums
// ──────────────────────────────────────────────────────────────────────────────
export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type UserRole = 'OWNER' | 'ADMIN' | 'REVIEWER' | 'VIEWER';
export type SourceChannel = 'github' | 'slack' | 'dashboard' | 'aws-event';
export type AgentType =
  | 'orchestrator'
  | 'code-reviewer'
  | 'infra-reviewer'
  | 'risk-reviewer'
  | 'security-agent'
  | 'incident-agent'
  | 'fix-agent';

// ──────────────────────────────────────────────────────────────────────────────
// Pagination
// ──────────────────────────────────────────────────────────────────────────────
export interface PaginationInput {
  readonly limit?: number;
  readonly nextToken?: string;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly nextToken?: string;
  readonly count: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// API response envelopes
// ──────────────────────────────────────────────────────────────────────────────
export interface ApiSuccessResponse<T = unknown> {
  readonly success: true;
  readonly data: T;
  readonly requestId: string;
  readonly timestamp: ISODateString;
}

export interface ApiErrorResponse {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
  readonly requestId: string;
  readonly timestamp: ISODateString;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

// ──────────────────────────────────────────────────────────────────────────────
// Health check
// ──────────────────────────────────────────────────────────────────────────────
export interface HealthCheckResponse {
  readonly status: 'ok' | 'degraded' | 'down';
  readonly version: string;
  readonly region: string;
  readonly timestamp: ISODateString;
}
