import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { imApi } from '@/lib/im-api-client';
import { cn } from '@/lib/utils';
import { Shield, ChevronRight, X } from 'lucide-react';

interface SecurityEvent {
  readonly eventId: string;
  readonly accountId: string;
  readonly findingType: string;
  readonly severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  readonly resource: string;
  readonly description: string;
  readonly status: string;
  readonly playbook?: PlaybookStep[];
  readonly detectedAt: string;
}

interface PlaybookStep {
  readonly step: number;
  readonly title: string;
  readonly action: string;
  readonly command?: string;
  readonly risk: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-500/15 text-red-400 border-red-500/30',
  HIGH: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  MEDIUM: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  LOW: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

function SecurityDetailDrawer({ event, onClose }: { event: SecurityEvent; onClose: () => void }) {
  const { data: detail } = useQuery<SecurityEvent>({
    queryKey: ['im-security-detail', event.eventId],
    queryFn: () => imApi.get<SecurityEvent>(`/security/${event.eventId}`),
  });

  const ev = detail ?? event;

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-[560px] bg-surface border-l border-term flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-term flex-shrink-0">
          <div>
            <p className="font-mono text-xs font-bold text-term flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-red-400" />
              {ev.findingType}
            </p>
            <p className="font-mono text-[10px] text-term-secondary mt-0.5">{ev.eventId}</p>
          </div>
          <button onClick={onClose} className="text-term-secondary hover:text-term">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: '심각도', value: ev.severity },
              { label: '계정', value: ev.accountId },
              { label: '영향 리소스', value: ev.resource },
              { label: '탐지 시각', value: new Date(ev.detectedAt).toLocaleString('ko-KR') },
            ].map(({ label, value }) => (
              <div key={label} className="bg-canvas rounded p-2.5">
                <p className="font-mono text-[9px] text-term-secondary uppercase tracking-wider mb-1">{label}</p>
                <p className="font-mono text-xs text-term">{value}</p>
              </div>
            ))}
          </div>

          {/* Description */}
          <div>
            <p className="font-mono text-[10px] text-term-secondary uppercase tracking-wider mb-2">발견 내용</p>
            <div className="bg-canvas rounded p-3 font-mono text-xs text-term leading-relaxed">
              {ev.description}
            </div>
          </div>

          {/* Playbook */}
          {(ev.playbook ?? []).length > 0 && (
            <div>
              <p className="font-mono text-[10px] text-term-secondary uppercase tracking-wider mb-3">대응 플레이북</p>
              <div className="space-y-3">
                {(ev.playbook ?? []).map((step) => (
                  <div key={step.step} className="bg-canvas rounded p-3 border border-term/30">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-5 h-5 rounded-full bg-accent/20 text-accent font-mono text-[10px] flex items-center justify-center font-bold">
                        {step.step}
                      </span>
                      <p className="font-mono text-xs font-bold text-term">{step.title}</p>
                      <span className={cn(
                        'ml-auto font-mono text-[9px] px-1.5 py-0.5 rounded',
                        step.risk === 'HIGH' ? 'bg-red-500/10 text-red-400' :
                        step.risk === 'MEDIUM' ? 'bg-yellow-500/10 text-yellow-400' :
                        'bg-green-500/10 text-green-400',
                      )}>
                        {step.risk}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-term-secondary mb-2">{step.action}</p>
                    {step.command && (
                      <pre className="bg-black/30 rounded px-2.5 py-1.5 font-mono text-[10px] text-green-400 overflow-x-auto">
                        {step.command}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!(ev.playbook ?? []).length && (
            <div className="flex items-center gap-2 font-mono text-xs text-term-secondary py-4">
              <span className="animate-pulse">⟳</span>
              <span>플레이북 생성 중...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function IMSecurityPage() {
  const [selected, setSelected] = useState<SecurityEvent | null>(null);

  const { data: events, isLoading } = useQuery<SecurityEvent[]>({
    queryKey: ['im-security-events'],
    queryFn: () => imApi.get<{ items: SecurityEvent[] }>('/security').then((r) => r.items),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-base font-bold text-term flex items-center gap-2">
            <span className="text-accent">›</span> 보안 이벤트
          </h1>
          <p className="font-mono text-[10px] text-term-secondary mt-0.5">$ im security --source=guardduty --status=active</p>
        </div>
        {!isLoading && (
          <span className="font-mono text-[10px] text-term-secondary">{events?.length ?? 0} events</span>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 font-mono text-xs text-term-secondary py-8">
          <span className="animate-pulse text-yellow-400">⟳</span>
          <span>$ fetching security events...</span>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-term bg-canvas/50">
              {['심각도', '계정', '유형', '영향 리소스', '탐지 시각', '상태', ''].map((h) => (
                <th key={h} className="text-left font-mono text-[10px] text-term-secondary uppercase tracking-wider px-4 py-2.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(events ?? []).length === 0 && !isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-xs text-term-secondary">
                  탐지된 보안 이벤트가 없습니다.
                </td>
              </tr>
            )}
            {(events ?? []).map((ev) => (
              <tr
                key={ev.eventId}
                onClick={() => setSelected(ev)}
                className="border-b border-term/30 hover:bg-white/3 transition-colors cursor-pointer"
              >
                <td className="px-4 py-2.5">
                  <span className={cn('font-mono text-[10px] px-1.5 py-0.5 rounded border', SEVERITY_COLORS[ev.severity])}>
                    {ev.severity}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-term-secondary">{ev.accountId}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-term">{ev.findingType}</td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-accent max-w-[180px] truncate">{ev.resource}</td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-term-secondary whitespace-nowrap">
                  {new Date(ev.detectedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {ev.status}
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

      {selected && <SecurityDetailDrawer event={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
