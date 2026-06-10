import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { api } from '@/lib/api-client';
import { formatDate, riskLevelBadge } from '@/lib/utils';

interface IncidentDetail {
  readonly incidentId: string;
  readonly title: string;
  readonly description: string;
  readonly severity: string;
  readonly status: string;
  readonly serviceId: string;
  readonly source: string;
  readonly rootCause?: string;
  readonly mitigation?: string;
  readonly investigationNotes?: string;
  readonly affectedResources: string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function IncidentDetailPage() {
  const { incidentId } = useParams({ from: '/protected/incidents/$incidentId' });

  const { data: incident, isLoading } = useQuery<IncidentDetail>({
    queryKey: ['incident', incidentId],
    queryFn: () => api.get<IncidentDetail>(`/incidents/${incidentId}`),
  });

  if (isLoading || !incident) {
    return <div className="text-center py-12 text-gray-500">로딩 중...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{incident.title}</h1>
          <p className="text-gray-500 text-sm mt-1 font-mono">{incident.incidentId}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={riskLevelBadge(incident.severity)}>{incident.severity}</span>
          <span className={riskLevelBadge(
            incident.status === 'RESOLVED' ? 'LOW'
            : incident.status === 'OPEN' ? 'CRITICAL'
            : 'MEDIUM'
          )}>{incident.status}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-white">개요</h2>
          <p className="text-sm text-gray-700 dark:text-gray-300">{incident.description}</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-500">서비스</span><p className="font-medium mt-1">{incident.serviceId}</p></div>
            <div><span className="text-gray-500">소스</span><p className="font-medium mt-1">{incident.source}</p></div>
            <div><span className="text-gray-500">발생</span><p className="font-medium mt-1">{formatDate(incident.createdAt)}</p></div>
            <div><span className="text-gray-500">업데이트</span><p className="font-medium mt-1">{formatDate(incident.updatedAt)}</p></div>
          </div>
        </div>

        {(incident.rootCause || incident.mitigation) && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
            <h2 className="font-semibold text-gray-900 dark:text-white">조사 결과</h2>
            {incident.rootCause && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-1">근본 원인</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">{incident.rootCause}</p>
              </div>
            )}
            {incident.mitigation && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-1">조치 사항</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">{incident.mitigation}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {incident.investigationNotes && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-3">조사 노트</h2>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">{incident.investigationNotes}</p>
        </div>
      )}
    </div>
  );
}
