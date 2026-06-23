import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { imApi } from '@/lib/im-api-client';
import { cn } from '@/lib/utils';
import { ChevronRight, FileText, Wrench, X } from 'lucide-react';

interface Incident {
  readonly incidentId: string;
  readonly title: string;
  readonly linkedAccountId?: string;
  readonly affectedServices: string[];
  readonly severity: string;
  readonly status: string;
  readonly description?: string;
  readonly source: string;
  readonly createdAt: string;
}

interface InvestigationResult {
  readonly rootCause: string;
  readonly blastRadius: string[];
  readonly timeline: Array<{ time: string; event: string }>;
  readonly recoveryOptions: Array<{ id: string; description: string; risk: string; estimatedMinutes: number }>;
}

interface Report {
  readonly reportId: string;
  readonly incidentId: string;
  readonly s3Key: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly presignedUrl?: string;
}

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-yellow-500/10 text-yellow-400',
  INVESTIGATING: 'bg-blue-500/10 text-blue-400',
  REPORTED: 'bg-green-500/10 text-green-400',
  INVESTIGATION_FAILED: 'bg-red-500/10 text-red-400',
  CLOSED: 'bg-gray-500/10 text-gray-400',
};

const SEVERITY_COLORS: Record<string, string> = {
  P1: 'text-red-400',
  P2: 'text-orange-400',
  P3: 'text-yellow-400',
  P4: 'text-term-secondary',
};

function IncidentDetailDrawer({
  incident,
  onClose,
}: {
  incident: Incident;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  const { data: investigation } = useQuery<InvestigationResult>({
    queryKey: ['im-investigation', incident.incidentId],
    queryFn: () => imApi.get<InvestigationResult>(`/incidents/${incident.incidentId}/investigation`),
    enabled: incident.status === 'REPORTED',
  });

  const { data: reports } = useQuery<Report[]>({
    queryKey: ['im-reports', incident.incidentId],
    queryFn: () => imApi.get<{ items: Report[] }>(`/reports?incidentId=${incident.incidentId}`).then((r) => r.items),
  });

  const startInvestigation = useMutation({
    mutationFn: () => imApi.post(`/incidents/${incident.incidentId}/investigate`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['im-incidents'] }),
  });

  const generateMitigation = useMutation({
    mutationFn: () => imApi.post(`/incidents/${incident.incidentId}/mitigation`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['im-remediations'] }),
  });

  const downloadReport = async (reportId: string) => {
    const resp = await imApi.get<{ url: string }>(`/reports/${reportId}/download`);
    window.open(resp.url, '_blank');
  };

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-[580px] bg-surface border-l border-term flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-term flex-shrink-0">
          <div>
            <p className="font-mono text-xs font-bold text-term">
              <span className="text-accent">›</span> {incident.title}
            </p>
            <p className="font-mono text-[10px] text-term-secondary mt-0.5">{incident.incidentId}</p>
          </div>
          <div className="flex items-center gap-2">
            {incident.status === 'OPEN' && (
              <button
                onClick={() => startInvestigation.mutate()}
                disabled={startInvestigation.isPending}
                className="px-2.5 py-1 text-[11px] font-mono text-accent border border-accent rounded hover:bg-accent/10 disabled:opacity-50"
              >
                조사 시작
              </button>
            )}
            <button onClick={onClose} className="text-term-secondary hover:text-term">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: '계정', value: incident.linkedAccountId ?? '-' },
              { label: '영향 서비스', value: incident.affectedServices?.join(', ') ?? '-' },
              { label: '심각도', value: incident.severity },
              { label: '상태', value: incident.status },
              { label: '발생 원인', value: incident.source },
              { label: '발생 시각', value: new Date(incident.createdAt).toLocaleString('ko-KR') },
            ].map(({ label, value }) => (
              <div key={label} className="bg-canvas rounded p-2.5">
                <p className="font-mono text-[9px] text-term-secondary uppercase tracking-wider mb-1">{label}</p>
                <p className="font-mono text-xs text-term">{value}</p>
              </div>
            ))}
          </div>

          {/* Investigation result */}
          {incident.status === 'REPORTED' && investigation && (
            <>
              <div>
                <p className="font-mono text-[10px] text-term-secondary uppercase tracking-wider mb-2">근본 원인</p>
                <div className="bg-canvas rounded p-3 font-mono text-xs text-term leading-relaxed">
                  {investigation.rootCause}
                </div>
              </div>

              <div>
                <p className="font-mono text-[10px] text-term-secondary uppercase tracking-wider mb-2">영향 범위</p>
                <div className="space-y-1">
                  {investigation.blastRadius.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 font-mono text-xs text-term">
                      <span className="text-accent">·</span> {item}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="font-mono text-[10px] text-term-secondary uppercase tracking-wider mb-2">이벤트 타임라인</p>
                <div className="space-y-1.5">
                  {investigation.timeline.map((ev, i) => (
                    <div key={i} className="flex gap-3 font-mono text-xs">
                      <span className="text-term-secondary flex-shrink-0">{ev.time}</span>
                      <span className="text-term">{ev.event}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {incident.status === 'INVESTIGATING' && (
            <div className="flex items-center gap-2 font-mono text-xs text-blue-400 py-4">
              <span className="animate-pulse">⟳</span>
              <span>AI 조사 진행 중...</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 px-5 py-4 border-t border-term flex-shrink-0">
          {incident.status === 'REPORTED' && (
            <>
              <button
                onClick={() => generateMitigation.mutate()}
                disabled={generateMitigation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-yellow-400 border border-yellow-400/40 rounded hover:bg-yellow-400/10 disabled:opacity-50"
              >
                <Wrench className="w-3.5 h-3.5" />
                Mitigation Plan
              </button>
              {(reports ?? []).length > 0 && (
                <button
                  onClick={() => downloadReport(reports![0]!.reportId)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-green-400 border border-green-400/40 rounded hover:bg-green-400/10"
                >
                  <FileText className="w-3.5 h-3.5" />
                  장애보고서
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function IMIncidentsPage() {
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

  const { data: incidents, isLoading } = useQuery<Incident[]>({
    queryKey: ['im-incidents'],
    queryFn: () => imApi.get<{ items: Incident[] }>('/incidents').then((r) => r.items),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-base font-bold text-term flex items-center gap-2">
            <span className="text-accent">›</span> 인시던트 조사
          </h1>
          <p className="font-mono text-[10px] text-term-secondary mt-0.5">$ im incidents --status=all</p>
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
              {['심각도', '발생 시각', '제목', '영향 서비스', '설명', '상태', ''].map((h) => (
                <th key={h} className="text-left font-mono text-[10px] text-term-secondary uppercase tracking-wider px-4 py-2.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(incidents ?? []).length === 0 && !isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-xs text-term-secondary">
                  인시던트가 없습니다.
                </td>
              </tr>
            )}
            {(incidents ?? []).map((inc) => (
              <tr
                key={inc.incidentId}
                className="border-b border-term/30 hover:bg-white/3 transition-colors cursor-pointer"
                onClick={() => setSelectedIncident(inc)}
              >
                <td className="px-4 py-2.5">
                  <span className={cn('font-mono text-[10px] px-1.5 py-0.5 rounded',
                    inc.severity === 'CRITICAL' ? 'bg-red-500/10 text-red-400' :
                    inc.severity === 'HIGH' ? 'bg-orange-500/10 text-orange-400' :
                    inc.severity === 'MEDIUM' ? 'bg-yellow-500/10 text-yellow-400' :
                    'bg-gray-500/10 text-gray-400')}>
                    {inc.severity}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-term-secondary whitespace-nowrap">
                  {new Date(inc.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-accent max-w-[180px] truncate">{inc.title}</td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-term-secondary max-w-[140px] truncate">
                  {inc.affectedServices?.join(', ') ?? '—'}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-term-secondary max-w-[200px] truncate">
                  {inc.description ?? (inc.status === 'INVESTIGATING' ? '조사 중...' : '—')}
                </td>
                <td className="px-4 py-2.5">
                  <span className={cn('font-mono text-[10px] px-1.5 py-0.5 rounded', STATUS_COLORS[inc.status] ?? 'bg-gray-500/10 text-gray-400')}>
                    {inc.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <ChevronRight className="w-3.5 h-3.5 text-term-secondary/40" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedIncident && (
        <IncidentDetailDrawer
          incident={selectedIncident}
          onClose={() => setSelectedIncident(null)}
        />
      )}
    </div>
  );
}
