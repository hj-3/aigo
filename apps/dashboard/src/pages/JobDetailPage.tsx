import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from '@tanstack/react-router';
import { api } from '@/lib/api-client';
import { formatDate, riskLevelBadge } from '@/lib/utils';

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

function jobStatusClass(status: string): string {
  switch (status) {
    case 'COMPLETED': return 'badge-low';
    case 'FAILED':    return 'badge-critical';
    case 'RUNNING':   return 'badge-medium';
    default:          return 'badge-info';
  }
}

function agentStatusClass(status: string): string {
  switch (status) {
    case 'COMPLETED': return 'text-green-600 dark:text-green-400';
    case 'FAILED':    return 'text-red-600 dark:text-red-400';
    case 'RUNNING':   return 'text-yellow-600 dark:text-yellow-400';
    default:          return 'text-gray-500';
  }
}

export function JobDetailPage() {
  const { jobId } = useParams({ from: '/jobs/$jobId' });

  const { data: job, isLoading: jobLoading } = useQuery<JobDetail>({
    queryKey: ['job', jobId],
    queryFn: () => api.get<JobDetail>(`/jobs/${jobId}`),
  });

  const { data: agentRuns, isLoading: runsLoading } = useQuery<AgentRun[]>({
    queryKey: ['agent-runs', jobId],
    queryFn: () => api.get<AgentRun[]>(`/jobs/agent-runs?jobId=${jobId}`),
    enabled: !!job,
  });

  if (jobLoading || !job) {
    return <div className="text-center py-12 text-gray-500">로딩 중...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">작업 상세</h1>
          <p className="text-gray-500 text-sm mt-1 font-mono">{job.jobId}</p>
        </div>
        <span className={riskLevelBadge(jobStatusClass(job.status))}>{job.status}</span>
      </div>

      {/* Job metadata */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-4">작업 정보</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-500">타입</p>
            <p className="font-medium mt-1">{job.type}</p>
          </div>
          <div>
            <p className="text-gray-500">리포지토리</p>
            <p className="font-medium mt-1">{job.repoId}</p>
          </div>
          <div>
            <p className="text-gray-500">재시도</p>
            <p className="font-medium mt-1">{job.retryCount}</p>
          </div>
          <div>
            <p className="text-gray-500">생성</p>
            <p className="font-medium mt-1">{formatDate(job.createdAt)}</p>
          </div>
        </div>
      </div>

      {/* PR context */}
      {job.prContext && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4">PR 정보</h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-24">제목</span>
              <a
                href={job.prContext.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
              >
                #{job.prContext.prNumber} {job.prContext.prTitle}
              </a>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-24">브랜치</span>
              <span className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                {job.prContext.headBranch} → {job.prContext.baseBranch}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-24">커밋</span>
              <span className="font-mono text-xs">{job.prContext.commitSha.slice(0, 8)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-24">작성자</span>
              <span>{job.prContext.authorLogin}</span>
            </div>
          </div>
        </div>
      )}

      {/* Agent runs timeline */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-4">
          에이전트 실행 기록
          {runsLoading && <span className="text-sm font-normal text-gray-400 ml-2">로딩 중...</span>}
        </h2>

        {(agentRuns ?? []).length === 0 && !runsLoading && (
          <p className="text-sm text-gray-500">에이전트 실행 기록이 없습니다.</p>
        )}

        <div className="space-y-3">
          {(agentRuns ?? []).map((run) => (
            <div
              key={run.runId}
              className="flex items-start gap-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {run.agentType}
                  </span>
                  <span className={`text-xs font-medium ${agentStatusClass(run.status)}`}>
                    {run.status}
                  </span>
                </div>
                {run.errorMessage && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400 font-mono truncate">
                    {run.errorMessage}
                  </p>
                )}
                <div className="mt-1 flex gap-4 text-xs text-gray-500">
                  <span>시작: {formatDate(run.startedAt)}</span>
                  {run.completedAt && <span>완료: {formatDate(run.completedAt)}</span>}
                  {run.durationMs && <span>소요: {(run.durationMs / 1000).toFixed(1)}s</span>}
                  {run.inputTokens && <span>입력 토큰: {run.inputTokens.toLocaleString()}</span>}
                  {run.outputTokens && <span>출력 토큰: {run.outputTokens.toLocaleString()}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Link to="/" className="text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400">
          ← 대시보드로 돌아가기
        </Link>
      </div>
    </div>
  );
}
