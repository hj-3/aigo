import { useQuery } from '@tanstack/react-query';
import { Activity, FileText, AlertTriangle, CheckCircle, Link as LinkIcon } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { api } from '@/lib/api-client';
import { formatDate, riskLevelBadge } from '@/lib/utils';
import { AgentPipeline, buildPipelineNodes } from '@/components/AgentPipeline';

interface DashboardStats {
  readonly totalJobs: number;
  readonly pendingJobs: number;
  readonly openIncidents: number;
  readonly approvedToday: number;
  readonly recentReports: Array<{
    readonly reportId: string;
    readonly repoName: string;
    readonly riskLevel: string;
    readonly mergeRecommendation: string;
    readonly approvalStatus?: string;
    readonly createdAt: string;
  }>;
}

interface ActiveJob {
  readonly jobId: string;
  readonly orgId: string;
  readonly repoId: string;
  readonly type: string;
  readonly status: string;
  readonly retryCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly prContext?: {
    readonly prNumber: number;
    readonly prTitle: string;
    readonly prUrl: string;
    readonly headBranch: string;
    readonly baseBranch: string;
    readonly authorLogin: string;
  };
}

interface AgentRun {
  readonly runId: string;
  readonly agentType: string;
  readonly status: string;
  readonly durationMs?: number;
  readonly errorMessage?: string;
}

const STATUS_DOT: Record<string, string> = {
  PENDING:     'bg-yellow-400/60',
  IN_PROGRESS: 'bg-yellow-400 animate-pulse',
  RUNNING:     'bg-yellow-400 animate-pulse',
  COMPLETED:   'bg-green-400',
  FAILED:      'bg-red-400',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING:     '대기 중',
  IN_PROGRESS: '처리 중',
  RUNNING:     '실행 중',
  COMPLETED:   '완료',
  FAILED:      '실패',
};

function StatCard({
  label, value, icon: Icon, color, hint,
}: {
  label: string; value: number; icon: typeof Activity; color: string; hint: string;
}) {
  return (
    <div className="card p-5 hover:border-[var(--accent)]/30 transition-colors">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-[10px] text-term-secondary uppercase tracking-wider">{hint}</p>
          <p className="font-mono text-3xl font-bold text-term mt-1">{value}</p>
          <p className="font-mono text-xs text-term-secondary mt-0.5">{label}</p>
        </div>
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
    </div>
  );
}

function ActiveJobCard({ job }: { job: ActiveJob }) {
  const { data: agentRuns = [] } = useQuery<AgentRun[]>({
    queryKey: ['agent-runs', job.jobId],
    queryFn: () => api.get<AgentRun[]>(`/jobs/agent-runs?jobId=${job.jobId}`),
    refetchInterval: (job.status === 'IN_PROGRESS' || job.status === 'RUNNING' || job.status === 'PENDING') ? 3000 : false,
  });

  const pipelineNodes = buildPipelineNodes(agentRuns, job.status);
  const isRunning = job.status === 'IN_PROGRESS' || job.status === 'RUNNING';
  const isFailed = job.status === 'FAILED';

  return (
    <Link
      to="/jobs/$jobId"
      params={{ jobId: job.jobId }}
      className="block card p-4 hover:border-[var(--accent)]/40 transition-all"
    >
      {/* Job header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[job.status] ?? 'bg-gray-400'}`} />
            <span className="text-term font-medium truncate">
              {job.prContext
                ? `#${job.prContext.prNumber} ${job.prContext.prTitle}`
                : job.jobId.slice(0, 12)}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 pl-4 font-mono text-[10px] text-term-secondary">
            <span>{STATUS_LABEL[job.status] ?? job.status}</span>
            {job.prContext && (
              <span className="truncate">
                {job.prContext.headBranch} → {job.prContext.baseBranch}
              </span>
            )}
            <span>{formatDate(job.createdAt)}</span>
          </div>
        </div>
        <span className="font-mono text-[10px] text-term-secondary flex-shrink-0">
          {isRunning && <span className="text-yellow-400 animate-pulse">⚡ 실행 중</span>}
          {isFailed && <span className="text-red-400">✗ 실패</span>}
          {job.status === 'PENDING' && <span className="text-yellow-400/60">⏳ 대기</span>}
        </span>
      </div>

      {/* Compact pipeline */}
      <div className="mt-2" onClick={(e) => e.preventDefault()}>
        <AgentPipeline nodes={pipelineNodes} compact />
      </div>

      {/* Error hint */}
      {isFailed && agentRuns.some((r) => r.errorMessage) && (
        <div className="mt-2 px-2 py-1.5 rounded bg-red-500/10 border border-red-500/20 font-mono text-[10px] text-red-400 truncate">
          ✗ {agentRuns.find((r) => r.errorMessage)?.errorMessage}
        </div>
      )}

      {/* Agent breakdown when running */}
      {isRunning && agentRuns.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {agentRuns.map((run) => (
            <span
              key={run.runId}
              className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${
                run.status === 'RUNNING'
                  ? 'border-yellow-400/40 text-yellow-400 bg-yellow-400/5'
                  : run.status === 'COMPLETED'
                  ? 'border-green-500/30 text-green-400 bg-green-400/5'
                  : run.status === 'FAILED'
                  ? 'border-red-500/30 text-red-400 bg-red-400/5'
                  : 'border-gray-600/30 text-term-secondary'
              }`}
            >
              {run.agentType}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

export function DashboardPage() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get<DashboardStats>('/dashboard/stats'),
    refetchInterval: 10000,
  });

  const { data: activeJobs = [], isLoading: activeLoading } = useQuery<ActiveJob[]>({
    queryKey: ['active-jobs'],
    queryFn: () => api.get<ActiveJob[]>('/jobs/active'),
    refetchInterval: (q) => {
      const data = q.state.data;
      const hasActive = Array.isArray(data) && data.some(
        (j) => j.status === 'IN_PROGRESS' || j.status === 'RUNNING' || j.status === 'PENDING',
      );
      return hasActive ? 3000 : 5000;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="font-mono text-xs text-term-secondary flex items-center gap-2">
          <span className="animate-pulse text-yellow-400">⟳</span>
          <span>$ loading dashboard stats...</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-28 animate-pulse bg-surface/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-base font-bold text-term flex items-center gap-2">
            <span className="text-accent">›</span> 대시보드
          </h1>
          <p className="font-mono text-[10px] text-term-secondary mt-0.5">
            $ agentops status --org=prod
          </p>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-green-400">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-slow" />
          시스템 정상
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          hint="TOTAL_JOBS"
          label="전체 분석 작업"
          value={stats?.totalJobs ?? 0}
          icon={Activity}
          color="bg-[var(--accent)]/20"
        />
        <StatCard
          hint="PENDING"
          label="대기 중"
          value={stats?.pendingJobs ?? 0}
          icon={FileText}
          color="bg-yellow-500/20"
        />
        <StatCard
          hint="INCIDENTS"
          label="활성 인시던트"
          value={stats?.openIncidents ?? 0}
          icon={AlertTriangle}
          color="bg-red-500/20"
        />
        <StatCard
          hint="APPROVED_TODAY"
          label="오늘 승인된 PR"
          value={stats?.approvedToday ?? 0}
          icon={CheckCircle}
          color="bg-green-500/20"
        />
      </div>

      {/* Active Jobs — pipeline live view */}
      <div className="card">
        <div className="px-5 py-3 border-b border-term flex items-center justify-between">
          <h2 className="font-mono text-xs font-semibold text-term flex items-center gap-1.5">
            <span className="text-accent">›</span> 활성 분석 작업
            {activeJobs.some((j) => j.status === 'IN_PROGRESS' || j.status === 'RUNNING') && (
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse ml-1" />
            )}
          </h2>
          <span className="font-mono text-[10px] text-term-secondary">{activeJobs.length}개</span>
        </div>

        {activeLoading ? (
          <div className="px-5 py-6 font-mono text-xs text-term-secondary flex items-center gap-2">
            <span className="animate-pulse text-yellow-400">⟳</span>
            <span>작업 목록 로딩 중...</span>
          </div>
        ) : activeJobs.length === 0 ? (
          <div className="px-5 py-10 text-center font-mono text-xs text-term-secondary">
            <p className="text-term-secondary/40 mb-2 text-2xl">○</p>
            진행 중인 분석 작업이 없습니다.<br />
            <span className="text-[10px]">PR을 생성하면 자동으로 분석이 시작됩니다.</span>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {activeJobs.map((job) => (
              <div key={job.jobId} className="px-4 py-3">
                <ActiveJobCard job={job} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Reports */}
      <div className="card">
        <div className="px-5 py-3 border-b border-term flex items-center justify-between">
          <h2 className="font-mono text-xs font-semibold text-term flex items-center gap-1.5">
            <span className="text-accent">›</span> 최근 분석 리포트
          </h2>
          <Link to="/reports" className="font-mono text-[10px] text-accent hover:underline">
            전체 보기 →
          </Link>
        </div>

        {(stats?.recentReports ?? []).length === 0 ? (
          <div className="px-5 py-10 text-center font-mono text-xs text-term-secondary">
            <p className="text-term-secondary/40 mb-2 text-2xl">○</p>
            아직 분석 리포트가 없습니다.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {(stats?.recentReports ?? []).map((report) => (
              <div key={report.reportId} className="px-5 py-3 flex items-center justify-between hover:bg-[var(--accent)]/3 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <LinkIcon className="w-3 h-3 text-term-secondary/40 flex-shrink-0" />
                  <div className="min-w-0">
                    <Link
                      to="/reports/$reportId"
                      params={{ reportId: report.reportId }}
                      className="font-mono text-xs font-medium text-accent hover:underline block truncate"
                    >
                      {report.repoName}
                    </Link>
                    <p className="font-mono text-[10px] text-term-secondary mt-0.5">{formatDate(report.createdAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={riskLevelBadge(report.riskLevel)}>{report.riskLevel}</span>
                  <span className={riskLevelBadge(
                    report.mergeRecommendation === 'APPROVE' ? 'LOW'
                    : report.mergeRecommendation === 'BLOCK' ? 'CRITICAL'
                    : 'MEDIUM'
                  )}>
                    추천: {report.mergeRecommendation}
                  </span>
                  {report.approvalStatus && report.approvalStatus !== 'PENDING' && (
                    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${
                      report.approvalStatus === 'APPROVED'
                        ? 'border-green-500/40 bg-green-500/10 text-green-400'
                        : report.approvalStatus === 'REJECTED'
                        ? 'border-red-500/40 bg-red-500/10 text-red-400'
                        : 'border-gray-500/40 bg-gray-500/10 text-term-secondary'
                    }`}>
                      {report.approvalStatus === 'APPROVED' ? '승인됨' : '거절됨'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
