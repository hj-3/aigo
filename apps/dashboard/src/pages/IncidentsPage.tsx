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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-base font-bold text-term flex items-center gap-2">
            <span className="text-accent">›</span> 인시던트
          </h1>
          <p className="font-mono text-[10px] text-term-secondary mt-0.5">$ incidents list --status=open</p>
        </div>
        {!isLoading && (
          <span className="font-mono text-[10px] text-term-secondary">{incidents?.length ?? 0} incidents</span>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 font-mono text-xs text-term-secondary py-8">
          <span className="animate-pulse text-yellow-400">⟳</span>
          <span>$ fetching incidents...</span>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-term bg-canvas/50">
              {['TITLE', 'SEVERITY', 'STATUS', 'SERVICE', 'CREATED'].map((h) => (
                <th key={h} className="text-left font-mono text-[10px] text-term-secondary uppercase tracking-wider px-4 py-2.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {(incidents ?? []).map((incident) => (
              <tr key={incident.incidentId} className="hover:bg-[var(--accent)]/3 transition-colors font-mono text-xs">
                <td className="px-4 py-3">
                  <Link
                    to="/incidents/$incidentId"
                    params={{ incidentId: incident.incidentId }}
                    className="text-accent hover:underline font-medium"
                  >
                    {incident.title}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className={riskLevelBadge(incident.severity)}>{incident.severity}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={riskLevelBadge(
                    incident.status === 'RESOLVED' ? 'LOW' :
                    incident.status === 'OPEN' ? 'CRITICAL' : 'MEDIUM'
                  )}>{incident.status}</span>
                </td>
                <td className="px-4 py-3 text-term-secondary">{incident.serviceId}</td>
                <td className="px-4 py-3 text-term-secondary">{formatDate(incident.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(incidents ?? []).length === 0 && !isLoading && (
          <div className="py-12 text-center font-mono text-xs text-term-secondary">
            <p className="text-2xl mb-2 text-green-400/40">✓</p>
            활성 인시던트가 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}
