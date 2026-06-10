import type { IncidentId, PaginationInput, PaginatedResult } from '../common.js';
import type { Incident, IncidentStatus } from '../dynamo/incident.js';

export interface ListIncidentsInput extends PaginationInput {
  readonly status?: IncidentStatus;
  readonly serviceId?: string;
  readonly from?: string;
  readonly to?: string;
}

export type ListIncidentsOutput = PaginatedResult<Incident>;

export interface GetIncidentInput {
  readonly incidentId: IncidentId;
}

export interface GetIncidentOutput {
  readonly incident: Incident;
  readonly rcaMarkdown?: string;
}

export interface ResolveIncidentInput {
  readonly incidentId: IncidentId;
  readonly resolution: string;
}
