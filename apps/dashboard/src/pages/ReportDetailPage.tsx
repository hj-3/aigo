import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from '@tanstack/react-router';
import { CheckCircle, XCircle, Wrench, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api-client';
import { formatDate, riskLevelBadge, cn } from '@/lib/utils';
import { AgentPipeline, buildPipelineNodes, type AgentStatus } from '@/components/AgentPipeline';

interface Finding {
  readonly findingId: string;
  readonly agentName: string;
  readonly severity: string;
  readonly category: string;
  readonly description: string;
  readonly fixable: boolean;
  readonly location: { file?: string; line?: number };
}

interface ReportDetail {
  readonly reportId: string;
  readonly repoId: string;
  readonly riskLevel: string;
  readonly riskScore: number;
  readonly mergeRecommendation: string;
  readonly approvalStatus: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly findingsBySeverity: Record<string, number>;
  readonly findings: Finding[];
  readonly jobId: string;
  readonly prContext: {
    readonly prNumber: number;
    readonly prUrl: string;
    readonly prTitle: string;
    readonly commitSha: string;
    readonly authorLogin: string;
  };
}

const AGENT_META: Record<string, { icon: string; label: string; sublabel: string }> = {
  code:        { icon: '📝', label: 'Code',     sublabel: '코드 품질' },
  security:    { icon: '🔒', label: 'Security', sublabel: '보안 취약점' },
  infra:       { icon: '⚙️',  label: 'Infra',    sublabel: '인프라 변경' },
  docs:        { icon: '📚', label: 'Docs',     sublabel: '문서 변경' },
  test:        { icon: '🧪', label: 'Test',     sublabel: '테스트 커버리지' },
  performance: { icon: '⚡', label: 'Perf',     sublabel: '성능 분석' },
};

/** Infer pipeline nodes from completed report findings (no job run data needed) */
function buildFromFindings(findings: Finding[], approvalStatus: string): Parameters<typeof AgentPipeline>[0]['nodes'] {
  const calledAgents = new Set(
    findings.map((f) => {
      const name = f.agentName.toLowerCase();
      for (const key of Object.keys(AGENT_META)) {
        if (name.includes(key)) return key;
      }
      return null;
    }).filter(Boolean) as string[]
  );

  const subNodes = Object.entries(AGENT_META).map(([key, meta]) => ({
    id: key,
    ...meta,
    status: (calledAgents.has(key) ? 'done' : calledAgents.size > 0 ? 'pending' : 'done') as AgentStatus,
    durationMs: undefined,
  }));

  const outputStatus: AgentStatus =
    approvalStatus === 'APPROVED' || approvalStatus === 'REJECTED' || approvalStatus === 'PENDING'
      ? 'done' : 'pending';

  return [
    { id: 'github',       label: 'GitHub PR',    sublabel: 'webhook trigger',  icon: '🔔', status: 'done' as AgentStatus },
    { id: 'orchestrator', label: 'Orchestrator', sublabel: 'Strands agent',    icon: '🧠', status: 'done' as AgentStatus },
    ...subNodes,
    { id: 'output',       label: 'PR+Slack',     sublabel: '결과 전달',         icon: '📣', status: outputStatus },
  ];
}

export function ReportDetailPage() {
  const { reportId } = useParams({ from: '/protected/reports/$reportId' });
  const qc = useQueryClient();

  const { data: report, isLoading } = useQuery<ReportDetail>({
    queryKey: ['report', reportId],
    queryFn: () => api.get<ReportDetail>(`/reports/${reportId}`),
  });

  const approveMutation = useMutation({
    mutationFn: (comment: string) =>
      api.post(`/reports/${reportId}/approve`, { decision: 'APPROVED', comment }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['report', reportId] }),
  });

  const rejectMutation = useMutation({
    mutationFn: (comment: string) =>
      api.post(`/reports/${reportId}/approve`, { decision: 'REJECTED', comment }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['report', reportId] }),
  });

  const fixMutation = useMutation({
    mutationFn: () => api.post('/fix', { reportId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['report', reportId] }),
  });

  if (isLoading || !report) {
    return (
      <div className="flex items-center gap-2 font-mono text-xs text-term-secondary py-12">
        <span className="animate-pulse text-yellow-400">⟳</span>
        <span>$ loading report...</span>
      </div>
    );
  }

  const isPending = report.approvalStatus === 'PENDING';
  const pipelineNodes = buildFromFindings(report.findings, report.approvalStatus);

  const riskColor =
    report.riskLevel === 'CRITICAL' ? 'text-red-400' :
    report.riskLevel === 'HIGH' ? 'text-orange-400' :
    report.riskLevel === 'MEDIUM' ? 'text-yellow-400' :
    'text-green-400';

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-base font-bold text-term flex items-center gap-2">
            <span className="text-accent">›</span> 분석 리포트
          </h1>
          <p className="font-mono text-[10px] text-term-secondary mt-0.5">{report.reportId}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={riskLevelBadge(report.riskLevel)}>
            {report.riskLevel}
            {report.riskScore != null && (
              <span className="ml-1 opacity-70">{report.riskScore}/100</span>
            )}
          </span>
          <span className={riskLevelBadge(
            report.approvalStatus === 'APPROVED' ? 'LOW' :
            report.approvalStatus === 'REJECTED' ? 'CRITICAL' : 'MEDIUM'
          )}>{report.approvalStatus}</span>
        </div>
      </div>

      {/* Agent Pipeline */}
      <div className="card p-5">
        <h2 className="font-mono text-xs font-semibold text-term flex items-center gap-1.5 mb-4">
          <span className="text-accent">›</span> 에이전트 파이프라인
          <span className="ml-auto font-normal text-[10px] text-term-secondary">
            GitHub → Orchestrator → Sub-Agents → PR Comment + Slack
          </span>
        </h2>
        <AgentPipeline nodes={pipelineNodes} />
      </div>

      {/* PR Context */}
      <div className="card p-5">
        <h2 className="font-mono text-xs font-semibold text-term flex items-center gap-1.5 mb-4">
          <span className="text-accent">›</span> Pull Request
        </h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 font-mono text-xs">
          <div>
            <p className="text-[10px] text-term-secondary uppercase tracking-wider">PR</p>
            <a
              href={report.prContext.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-accent hover:underline mt-0.5"
            >
              #{report.prContext.prNumber} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div>
            <p className="text-[10px] text-term-secondary uppercase tracking-wider">AUTHOR</p>
            <p className="text-term mt-0.5">@{report.prContext.authorLogin}</p>
          </div>
          <div className="col-span-2">
            <p className="text-[10px] text-term-secondary uppercase tracking-wider">TITLE</p>
            <p className="text-term mt-0.5">{report.prContext.prTitle}</p>
          </div>
          <div>
            <p className="text-[10px] text-term-secondary uppercase tracking-wider">COMMIT</p>
            <code className="text-term-secondary mt-0.5 block">{report.prContext.commitSha.slice(0, 8)}</code>
          </div>
          <div>
            <p className="text-[10px] text-term-secondary uppercase tracking-wider">CREATED</p>
            <p className="text-term mt-0.5">{formatDate(report.createdAt)}</p>
          </div>
        </div>
        {report.jobId && (
          <div className="mt-3 pt-3 border-t border-term">
            <Link
              to="/jobs/$jobId"
              params={{ jobId: report.jobId }}
              className="font-mono text-[10px] text-accent hover:underline"
            >
              $ view job logs → {report.jobId.slice(0, 12)}...
            </Link>
          </div>
        )}
      </div>

      {/* Risk summary */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-mono text-xs font-semibold text-term flex items-center gap-1.5">
            <span className="text-accent">›</span> 리스크 분석 요약
          </h2>
          <div className={cn('font-mono text-xl font-bold', riskColor)}>
            {report.riskScore}/100
          </div>
        </div>

        {/* Score bar */}
        <div className="w-full h-1.5 bg-canvas rounded-full overflow-hidden mb-4">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              report.riskLevel === 'CRITICAL' ? 'bg-red-500' :
              report.riskLevel === 'HIGH' ? 'bg-orange-500' :
              report.riskLevel === 'MEDIUM' ? 'bg-yellow-500' : 'bg-green-500'
            )}
            style={{ width: `${report.riskScore}%` }}
          />
        </div>

        {/* Findings by severity */}
        <div className="flex gap-3 flex-wrap mb-4">
          {Object.entries(report.findingsBySeverity)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => (
              <span key={k} className={riskLevelBadge(k)}>
                {k}: {v}
              </span>
            ))}
        </div>

        <p className="font-mono text-xs text-term leading-relaxed">{report.summary}</p>
      </div>

      {/* Actions */}
      {isPending && (
        <div className="card p-5">
          <h2 className="font-mono text-xs font-semibold text-term flex items-center gap-1.5 mb-4">
            <span className="text-accent">›</span> 검토 액션
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => approveMutation.mutate('')}
              disabled={approveMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-green-500/40 bg-green-500/10 text-green-400 font-mono text-xs hover:bg-green-500/20 disabled:opacity-50 transition-colors"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              {approveMutation.isPending ? '처리 중...' : '$ approve'}
            </button>
            <button
              onClick={() => rejectMutation.mutate('변경 사항이 필요합니다.')}
              disabled={rejectMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-red-500/40 bg-red-500/10 text-red-400 font-mono text-xs hover:bg-red-500/20 disabled:opacity-50 transition-colors"
            >
              <XCircle className="w-3.5 h-3.5" />
              {rejectMutation.isPending ? '처리 중...' : '$ reject'}
            </button>
            <button
              onClick={() => fixMutation.mutate()}
              disabled={fixMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--accent)]/40 bg-[var(--accent)]/10 text-accent font-mono text-xs hover:bg-[var(--accent)]/20 disabled:opacity-50 transition-colors"
            >
              <Wrench className="w-3.5 h-3.5" />
              {fixMutation.isPending ? '처리 중...' : '$ auto-fix'}
            </button>
          </div>
          {(approveMutation.isSuccess || rejectMutation.isSuccess) && (
            <p className="font-mono text-[11px] text-green-400 mt-3">
              ✓ 검토 결과가 GitHub PR 코멘트와 Slack으로 전달되었습니다.
            </p>
          )}
        </div>
      )}

      {/* Findings */}
      <div className="card">
        <div className="px-5 py-3 border-b border-term flex items-center justify-between">
          <h2 className="font-mono text-xs font-semibold text-term flex items-center gap-1.5">
            <span className="text-accent">›</span> 발견된 문제
          </h2>
          <span className="font-mono text-[10px] text-term-secondary">{report.findings.length} findings</span>
        </div>

        {report.findings.length === 0 ? (
          <p className="font-mono text-xs text-term-secondary px-5 py-8 text-center">
            ✓ 발견된 문제가 없습니다.
          </p>
        ) : (
          <div className="divide-y divide-[var(--border)] font-mono text-xs">
            {report.findings.map((finding, i) => (
              <div key={finding.findingId} className="px-5 py-3 hover:bg-[var(--accent)]/3 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-term-secondary/40">{String(i + 1).padStart(2, '0')}</span>
                      <span className={riskLevelBadge(finding.severity)}>{finding.severity}</span>
                      <span className="text-term-secondary">{finding.category}</span>
                      <span className="text-term-secondary/50">by {finding.agentName}</span>
                    </div>
                    <p className="text-term mt-1.5 leading-relaxed">{finding.description}</p>
                    {finding.location.file && (
                      <p className="text-term-secondary mt-1">
                        📄 {finding.location.file}
                        {finding.location.line ? `:${finding.location.line}` : ''}
                      </p>
                    )}
                  </div>
                  {finding.fixable && (
                    <span className="badge-info flex-shrink-0">auto-fix</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Link to="/reports" className="inline-block font-mono text-xs text-accent hover:underline">
        ← 리포트 목록으로
      </Link>
    </div>
  );
}
