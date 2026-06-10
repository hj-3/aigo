import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '@/lib/api-client';
import { formatDate, riskLevelBadge } from '@/lib/utils';

interface Incident {
  readonly incidentId: string;
  readonly title: string;
  readonly severity: string;
  readonly status: string;
  readonly serviceId: string;
  readonly createdAt: string;
}

export function IncidentsPage() {
  const { data: incidents, isLoading } = useQuery<Incident[]>({
    queryKey: ['incidents'],
    queryFn: () => api.get<Incident[]>('/incidents'),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">인시던트</h1>

      {isLoading && <div className="text-center py-12 text-gray-500">로딩 중...</div>}

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">제목</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">심각도</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">상태</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">서비스</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">발생 시간</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {(incidents ?? []).map((incident) => (
              <tr key={incident.incidentId} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="px-6 py-4">
                  <Link
                    to="/incidents/$incidentId"
                    params={{ incidentId: incident.incidentId }}
                    className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
                  >
                    {incident.title}
                  </Link>
                </td>
                <td className="px-6 py-4"><span className={riskLevelBadge(incident.severity)}>{incident.severity}</span></td>
                <td className="px-6 py-4"><span className={riskLevelBadge(
                  incident.status === 'RESOLVED' ? 'LOW'
                  : incident.status === 'OPEN' ? 'CRITICAL'
                  : 'MEDIUM'
                )}>{incident.status}</span></td>
                <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{incident.serviceId}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{formatDate(incident.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(incidents ?? []).length === 0 && !isLoading && (
          <p className="text-center py-12 text-gray-500">활성 인시던트가 없습니다.</p>
        )}
      </div>
    </div>
  );
}
