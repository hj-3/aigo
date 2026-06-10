import type { ISODateString, OrgId } from '../common.js';

/** EventBridge custom bus event envelope */
export interface AigoEventBase<TDetail = unknown> {
  readonly version: '0';
  readonly source: 'aigo.platform';
  readonly 'detail-type': string;
  readonly detail: TDetail;
  readonly time: string;             // EventBridge-native ISO
  readonly region: string;
  readonly account: string;
}

export interface JobCreatedDetail {
  readonly orgId: OrgId;
  readonly jobId: string;
  readonly jobType: string;
  readonly repoFullName: string;
}

export interface AnalysisCompletedDetail {
  readonly orgId: OrgId;
  readonly jobId: string;
  readonly reportId: string;
  readonly riskLevel: string;
  readonly mergeRecommendation: string;
}

export interface IncidentTriggeredDetail {
  readonly orgId: OrgId;
  readonly incidentId: string;
  readonly serviceId: string;
  readonly severity: string;
  readonly source: string;
  readonly awsAlarmArn?: string;
  readonly timestamp: ISODateString;
}

export type JobCreatedEvent = AigoEventBase<JobCreatedDetail> & {
  readonly 'detail-type': 'aigo.job.created';
};

export type AnalysisCompletedEvent = AigoEventBase<AnalysisCompletedDetail> & {
  readonly 'detail-type': 'aigo.analysis.completed';
};

export type IncidentTriggeredEvent = AigoEventBase<IncidentTriggeredDetail> & {
  readonly 'detail-type': 'aigo.incident.triggered';
};

export type AigoEvent =
  | JobCreatedEvent
  | AnalysisCompletedEvent
  | IncidentTriggeredEvent;
