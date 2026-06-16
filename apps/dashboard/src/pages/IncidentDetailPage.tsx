import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from '@tanstack/react-router';
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
    return (
      <div className="flex items-center gap-2 font-mono text-xs text-term-secondary py-12">
        <span className="animate-pulse text-yellow-400">⟳</span>
        <span>$ loading incident...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-base font-bold text-term flex items-center gap-2">
            <span className="text-accent">›</span> {incident.title}
          </h1>
          <p className="font-mono text-[10px] text-term-secondary mt-0.5">{incident.incidentId}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={riskLevelBadge(incident.severity)}>{incident.severity}</span>
          <span className={riskLevelBadge(
            incident.status === 'RESOLVED' ? 'LOW' :
            incident.status === 'OPEN' ? 'CRITICAL' : 'MEDIUM'
          )}>{incident.status}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5 space-y-4">
          <h2 className="font-mono text-xs font-semibold text-term flex items-center gap-1.5">
            <span className="text-accent">›</span> 개요
          </h2>
          <p className="font-mono text-xs text-term leading-relaxed">{incident.description}</p>
          <div className="grid grid-cols-2 gap-3 font-mono text-xs">
            {[
              { k: 'SERVICE', v: incident.serviceId },
              { k: 'SOURCE', v: incident.source },
              { k: 'CREATED', v: formatDate(incident.createdAt) },
              { k: 'UPDATED', v: formatDate(incident.updatedAt) },
            ].map(({ k, v }) => (
              <div key={k}>
                <p className="text-[10px] text-term-secondary uppercase tracking-wider">{k}</p>
                <p className="text-term mt-0.5">{v}</p>
              </div>
            ))}
          </div>
        </div>

        {(incident.rootCause || incident.mitigation) && (
          <div className="card p-5 space-y-4">
            <h2 className="font-mono text-xs font-semibold text-term flex items-center gap-1.5">
              <span className="text-accent">›</span> 조사 결과
            </h2>
            {incident.rootCause && (
              <div>
                <p className="font-mono text-[10px] text-term-secondary uppercase tracking-wider mb-1">ROOT CAUSE</p>
                <p className="font-mono text-xs text-term leading-relaxed">{incident.rootCause}</p>
              </div>
            )}
            {incident.mitigation && (
              <div>
                <p className="font-mono text-[10px] text-term-secondary uppercase tracking-wider mb-1">MITIGATION</p>
                <p className="font-mono text-xs text-term leading-relaxed">{incident.mitigation}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {incident.investigationNotes && (
        <div className="card p-5">
          <h2 className="font-mono text-xs font-semibold text-term flex items-center gap-1.5 mb-3">
            <span className="text-accent">›</span> 조사 노트
          </h2>
          <pre className="font-mono text-xs text-term leading-relaxed whitespace-pre-wrap bg-canvas p-4 rounded border border-term overflow-auto">
            {incident.investigationNotes}
          </pre>
        </div>
      )}

      {incident.affectedResources?.length > 0 && (
        <div className="card p-5">
          <h2 className="font-mono text-xs font-semibold text-term flex items-center gap-1.5 mb-3">
            <span className="text-accent">›</span> 영향받은 리소스
          </h2>
          <div className="flex flex-wrap gap-2">
            {incident.affectedResources.map((r) => (
              <code key={r} className="font-mono text-xs px-2 py-1 rounded bg-canvas border border-term text-term-secondary">
                {r}
              </code>
            ))}
          </div>
        </div>
      )}

      <Link to="/incidents" className="inline-block font-mono text-xs text-accent hover:underline">
        ← 인시던트 목록으로
      </Link>
    </div>
  );
}
