import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { imApi } from '@/lib/im-api-client';
import { cn } from '@/lib/utils';
import { Play, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';

interface RemediationAction {
  readonly actionId: string;
  readonly incidentId: string;
  readonly incidentTitle: string;
  readonly description: string;
  readonly actionType: string;
  readonly targetResource: string;
  readonly riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly estimatedMinutes: number;
  readonly status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  readonly executedAt?: string;
  readonly result?: string;
}

const RISK_COLORS: Record<string, string> = {
  LOW: 'bg-green-500/10 text-green-400',
  MEDIUM: 'bg-yellow-500/10 text-yellow-400',
  HIGH: 'bg-red-500/10 text-red-400',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-gray-500/10 text-gray-400',
  RUNNING: 'bg-blue-500/10 text-blue-400',
  COMPLETED: 'bg-green-500/10 text-green-400',
  FAILED: 'bg-red-500/10 text-red-400',
  SKIPPED: 'bg-gray-500/10 text-gray-500',
};

function ActionGroup({ incidentId, incidentTitle, actions }: {
  incidentId: string;
  incidentTitle: string;
  actions: RemediationAction[];
}) {
  const [expanded, setExpanded] = useState(true);
  const qc = useQueryClient();

  const executeAction = useMutation({
    mutationFn: (actionId: string) => imApi.post(`/remediations/${actionId}/execute`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['im-remediations'] }),
  });

  const pendingActions = actions.filter((a) => a.status === 'PENDING');

  return (
    <div className="card overflow-hidden mb-3">
      <button
        className="w-full flex items-center gap-2 px-4 py-3 border-b border-term/50 hover:bg-white/3 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-term-secondary" /> : <ChevronRight className="w-3.5 h-3.5 text-term-secondary" />}
        <span className="font-mono text-xs font-bold text-term flex-1 text-left">{incidentTitle}</span>
        <span className="font-mono text-[10px] text-term-secondary">{incidentId}</span>
        {pendingActions.length > 0 && (
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {pendingActions.length} 대기
          </span>
        )}
      </button>

      {expanded && (
        <table className="w-full">
          <thead>
            <tr className="border-b border-term/30 bg-canvas/30">
              {['조치 내용', '대상 리소스', '위험도', '예상 시간', '상태', ''].map((h) => (
                <th key={h} className="text-left font-mono text-[10px] text-term-secondary uppercase tracking-wider px-4 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {actions.map((action) => (
              <tr key={action.actionId} className="border-b border-term/20 hover:bg-white/3 transition-colors">
                <td className="px-4 py-2.5 font-mono text-xs text-term max-w-[220px]">
                  <p>{action.description}</p>
                  <p className="text-[10px] text-term-secondary mt-0.5">{action.actionType}</p>
                </td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-accent">{action.targetResource}</td>
                <td className="px-4 py-2.5">
                  <span className={cn('font-mono text-[10px] px-1.5 py-0.5 rounded', RISK_COLORS[action.riskLevel])}>
                    {action.riskLevel}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-term-secondary">~{action.estimatedMinutes}분</td>
                <td className="px-4 py-2.5">
                  <span className={cn('font-mono text-[10px] px-1.5 py-0.5 rounded', STATUS_COLORS[action.status])}>
                    {action.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  {action.status === 'PENDING' && (
                    <button
                      onClick={() => executeAction.mutate(action.actionId)}
                      disabled={executeAction.isPending}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-accent border border-accent/40 rounded hover:bg-accent/10 disabled:opacity-50 ml-auto"
                    >
                      <Play className="w-3 h-3" />
                      실행
                    </button>
                  )}
                  {action.status === 'HIGH' && (
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400 ml-auto" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function IMRemediationPage() {
  const { data: remediations, isLoading } = useQuery<RemediationAction[]>({
    queryKey: ['im-remediations'],
    queryFn: () => imApi.get<{ items: RemediationAction[] }>('/remediations').then((r) => r.items),
    refetchInterval: 15_000,
  });

  // Group by incident
  const grouped = (remediations ?? []).reduce<Record<string, { title: string; actions: RemediationAction[] }>>((acc, a) => {
    if (!acc[a.incidentId]) acc[a.incidentId] = { title: a.incidentTitle, actions: [] };
    acc[a.incidentId]!.actions.push(a);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-mono text-base font-bold text-term flex items-center gap-2">
          <span className="text-accent">›</span> 조치 현황
        </h1>
        <p className="font-mono text-[10px] text-term-secondary mt-0.5">$ im remediation --list --pending</p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 font-mono text-xs text-term-secondary py-8">
          <span className="animate-pulse text-yellow-400">⟳</span>
          <span>$ fetching remediations...</span>
        </div>
      )}

      {!isLoading && Object.keys(grouped).length === 0 && (
        <div className="card p-8 text-center font-mono text-xs text-term-secondary">
          조치 방안이 없습니다. 인시던트 조사 탭에서 Mitigation Plan을 생성하세요.
        </div>
      )}

      {Object.entries(grouped).map(([incidentId, { title, actions }]) => (
        <ActionGroup
          key={incidentId}
          incidentId={incidentId}
          incidentTitle={title}
          actions={actions}
        />
      ))}
    </div>
  );
}
