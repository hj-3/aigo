import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { CheckCircle, XCircle, Wrench, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api-client';
import { formatDate, riskLevelBadge, cn } from '@/lib/utils';

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
    mutationFn: () =>
      api.post('/fix', { reportId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['report', reportId] }),
  });

  if (isLoading || !report) {
    return <div className="text-center py-12 text-gray-500">로딩 중...</div>;
  }

  const isPending = report.approvalStatus === 'PENDING';

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">분석 리포트</h1>
          <p className="text-gray-500 text-sm mt-1 font-mono">{report.reportId}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={riskLevelBadge(report.riskLevel)}>
            {report.riskLevel}
            {report.riskScore !== undefined && (
              <span className="ml-1 font-mono text-xs opacity-80">({report.riskScore}/100)</span>
            )}
          </span>
          <span className={riskLevelBadge(
            report.approvalStatus === 'APPROVED' ? 'LOW'
            : report.approvalStatus === 'REJECTED' ? 'CRITICAL'
            : 'MEDIUM'
          )}>{report.approvalStatus}</span>
        </div>
      </div>

      {/* PR Context */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Pull Request</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">PR 번호</span>
            <a href={report.prContext.prUrl} target="_blank" rel="noopener noreferrer"
               className="flex items-center gap-1 text-brand-600 hover:text-brand-700 font-medium mt-1">
              #{report.prContext.prNumber}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div>
            <span className="text-gray-500">작성자</span>
            <p className="font-medium text-gray-900 dark:text-white mt-1">@{report.prContext.authorLogin}</p>
          </div>
          <div className="col-span-2">
            <span className="text-gray-500">제목</span>
            <p className="font-medium text-gray-900 dark:text-white mt-1">{report.prContext.prTitle}</p>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-3">분석 요약</h2>
        <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">{report.summary}</p>
      </div>

      {/* Actions */}
      {isPending && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4">액션</h2>
          <div className="flex gap-3">
            <button
              onClick={() => approveMutation.mutate('')}
              disabled={approveMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              <CheckCircle className="w-4 h-4" /> 승인
            </button>
            <button
              onClick={() => rejectMutation.mutate('변경 사항이 필요합니다.')}
              disabled={rejectMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" /> 거절
            </button>
            <button
              onClick={() => fixMutation.mutate()}
              disabled={fixMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              <Wrench className="w-4 h-4" /> 자동 수정 요청
            </button>
          </div>
        </div>
      )}

      {/* Findings */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-white">
            발견된 문제 ({report.findings.length}개)
          </h2>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-800">
          {report.findings.map((finding) => (
            <div key={finding.findingId} className="px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={riskLevelBadge(finding.severity)}>{finding.severity}</span>
                    <span className="text-xs text-gray-500">{finding.category}</span>
                    <span className="text-xs text-gray-400">by {finding.agentName}</span>
                  </div>
                  <p className="text-sm text-gray-900 dark:text-white">{finding.description}</p>
                  {finding.location.file && (
                    <p className="text-xs text-gray-500 font-mono mt-1">
                      {finding.location.file}{finding.location.line ? `:${finding.location.line}` : ''}
                    </p>
                  )}
                </div>
                {finding.fixable && (
                  <span className="badge-info flex-shrink-0">자동수정 가능</span>
                )}
              </div>
            </div>
          ))}
          {report.findings.length === 0 && (
            <p className="text-center py-8 text-gray-500">발견된 문제가 없습니다.</p>
          )}
        </div>
      </div>
    </div>
  );
}
