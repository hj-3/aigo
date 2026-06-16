import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from '@tanstack/react-router';
import { api } from '@/lib/api-client';
import { formatDate, riskLevelBadge } from '@/lib/utils';
import { AgentPipeline, buildPipelineNodes } from '@/components/AgentPipeline';

interface JobDetail {
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
    readonly commitSha: string;
    readonly baseBranch: string;
    readonly headBranch: string;
    readonly authorLogin: string;
  };
}

interface AgentRun {
  readonly runId: string;
  readonly agentType: string;
  readonly status: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly errorMessage?: string;
}

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: 'text-green-400',
  FAILED: 'text-red-400',
  RUNNING: 'text-yellow-400',
  PENDING: 'text-term-secondary',
};

export function JobDetailPage() {
  const { jobId } = useParams({ from: '/protected/jobs/$jobId' });

  const { data: job, isLoading: jobLoading } = useQuery<JobDetail>({
    queryKey: ['job', jobId],
    queryFn: () => api.get<JobDetail>(`/jobs/${jobId}`),
    refetchInterval: (q) => (q.state.data?.status === 'RUNNING' ? 3000 : false),
  });

  const { data: agentRuns = [], isLoading: runsLoading } = useQuery<AgentRun[]>({
    queryKey: ['agent-runs', jobId],
    queryFn: () => api.get<AgentRun[]>(`/jobs/agent-runs?jobId=${jobId}`),
    enabled: !!job,
    refetchInterval: (q) => {
      const data = q.state.data;
      const hasRunning = Array.isArray(data) && data.some((r) => r.status === 'RUNNING');
      return hasRunning || job?.status === 'RUNNING' ? 3000 : false;
    },
  });

  if (jobLoading || !job) {
    return (
      <div className="flex items-center gap-2 font-mono text-xs text-term-secondary py-12">
        <span className="animate-pulse text-yellow-400">⟳</span>
        <span>$ loading job {jobId?.slice(0, 8)}...</span>
      </div>
    );
  }

  const pipelineNodes = buildPipelineNodes(agentRuns, job.status);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-base font-bold text-term flex items-center gap-2">
            <span className="text-accent">›</span> 작업 상세
          </h1>
          <p className="font-mono text-[10px] text-term-secondary mt-0.5">{job.jobId}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={riskLevelBadge(
            job.status === 'COMPLETED' ? 'LOW' :
            job.status === 'FAILED' ? 'CRITICAL' :
            job.status === 'RUNNING' ? 'MEDIUM' : 'INFO'
          )}>{job.status}</span>
          {job.status === 'RUNNING' && (
            <span className="font-mono text-[10px] text-yellow-400 animate-pulse">실행 중...</span>
          )}
        </div>
      </div>

      {/* Agent Pipeline Visualization */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-mono text-xs font-semibold text-term flex items-center gap-1.5">
            <span className="text-accent">›</span> 에이전트 파이프라인
          </h2>
          {runsLoading && (
            <span className="font-mono text-[10px] text-term-secondary animate-pulse">로딩 중...</span>
          )}
        </div>
        <AgentPipeline nodes={pipelineNodes} />
      </div>

      {/* Job metadata */}
      <div className="card p-5">
        <h2 className="font-mono text-xs font-semibold text-term flex items-center gap-1.5 mb-4">
          <span className="text-accent">›</span> 작업 정보
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3 font-mono text-xs">
          {[
            { k: 'TYPE', v: job.type },
            { k: 'REPO', v: job.repoId },
            { k: 'RETRIES', v: String(job.retryCount) },
            { k: 'CREATED', v: formatDate(job.createdAt) },
          ].map(({ k, v }) => (
            <div key={k}>
              <p className="text-[10px] text-term-secondary uppercase tracking-wider">{k}</p>
              <p className="text-term mt-0.5 truncate">{v}</p>
            </div>
          ))}
        </div>
      </div>

      {/* PR context */}
      {job.prContext && (
        <div className="card p-5">
          <h2 className="font-mono text-xs font-semibold text-term flex items-center gap-1.5 mb-4">
            <span className="text-accent">›</span> Pull Request
          </h2>
          <div className="space-y-2.5 font-mono text-xs">
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] text-term-secondary w-16">TITLE</span>
              <a
                href={job.prContext.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                #{job.prContext.prNumber} {job.prContext.prTitle}
              </a>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] text-term-secondary w-16">BRANCH</span>
              <code className="text-xs bg-canvas px-1.5 py-0.5 rounded border border-term text-term">
                {job.prContext.headBranch} → {job.prContext.baseBranch}
              </code>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] text-term-secondary w-16">COMMIT</span>
              <code className="text-xs text-term-secondary">{job.prContext.commitSha.slice(0, 8)}</code>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] text-term-secondary w-16">AUTHOR</span>
              <span className="text-term">@{job.prContext.authorLogin}</span>
            </div>
          </div>
        </div>
      )}

      {/* Agent run log */}
      <div className="card">
        <div className="px-5 py-3 border-b border-term flex items-center justify-between">
          <h2 className="font-mono text-xs font-semibold text-term flex items-center gap-1.5">
            <span className="text-accent">›</span> 에이전트 실행 로그
          </h2>
          <span className="font-mono text-[10px] text-term-secondary">{agentRuns.length} runs</span>
        </div>

        {agentRuns.length === 0 && !runsLoading ? (
          <p className="font-mono text-xs text-term-secondary px-5 py-8 text-center">
            에이전트 실행 기록이 없습니다.
          </p>
        ) : (
          <div className="divide-y divide-[var(--border)] font-mono text-xs">
            {agentRuns.map((run, i) => (
              <div key={run.runId} className="px-5 py-3 hover:bg-[var(--accent)]/3 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-term-secondary/40">{String(i + 1).padStart(2, '0')}</span>
                      <span className="text-term font-medium">{run.agentType}</span>
                      <span className={STATUS_COLOR[run.status] ?? 'text-term-secondary'}>
                        {run.status}
                      </span>
                    </div>
                    {run.errorMessage && (
                      <p className="mt-1 text-red-400 text-[11px] font-mono truncate pl-6">
                        ✗ {run.errorMessage}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-term-secondary pl-6">
                      <span>started {formatDate(run.startedAt)}</span>
                      {run.completedAt && <span>done {formatDate(run.completedAt)}</span>}
                      {run.durationMs != null && (
                        <span className="text-green-400/70">{(run.durationMs / 1000).toFixed(2)}s</span>
                      )}
                      {run.inputTokens != null && (
                        <span>↑{run.inputTokens.toLocaleString()} tok</span>
                      )}
                      {run.outputTokens != null && (
                        <span>↓{run.outputTokens.toLocaleString()} tok</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Link to="/" className="inline-block font-mono text-xs text-accent hover:underline">
        ← 대시보드로 돌아가기
      </Link>
    </div>
  );
}
