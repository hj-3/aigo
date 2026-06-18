import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { formatDate, riskLevelBadge, cn } from '@/lib/utils';

interface Report {
  readonly reportId: string;
  readonly repoId: string;
  readonly riskLevel: string;
  readonly riskScore: number;
  readonly mergeRecommendation: string;
  readonly approvalStatus: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly findingsBySeverity: Record<string, number>;
  readonly prContext?: { readonly prNumber?: number; readonly prTitle?: string };
}

function RiskBar({ score, level }: { score: number; level: string }) {
  const barColor =
    level === 'CRITICAL' ? 'bg-red-500' :
    level === 'HIGH'     ? 'bg-orange-500' :
    level === 'MEDIUM'   ? 'bg-yellow-500' :
                           'bg-green-500';
  const textColor =
    level === 'CRITICAL' ? 'text-red-400' :
    level === 'HIGH'     ? 'text-orange-400' :
    level === 'MEDIUM'   ? 'text-yellow-400' :
                           'text-green-400';
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1 bg-canvas rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', barColor)}
          style={{ width: `${Math.min(score ?? 0, 100)}%` }}
        />
      </div>
      <span className={cn('font-mono text-[10px] font-medium w-8 text-right', textColor)}>
        {score ?? '—'}
      </span>
    </div>
  );
}

export function ReportsPage() {
  const qc = useQueryClient();
  const { data: reports, isLoading } = useQuery<Report[]>({
    queryKey: ['reports'],
    queryFn: () => api.get<Report[]>('/reports'),
  });

  const deleteMutation = useMutation({
    mutationFn: (reportId: string) => api.delete(`/reports/${reportId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['reports'] }),
  });

  function handleDelete(reportId: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm('이 리포트를 삭제하시겠습니까?')) return;
    deleteMutation.mutate(reportId);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-base font-bold text-term flex items-center gap-2">
            <span className="text-accent">›</span> 분석 리포트
          </h1>
          <p className="font-mono text-[10px] text-term-secondary mt-0.5">$ reports list --org=prod</p>
        </div>
        {!isLoading && (
          <span className="font-mono text-[10px] text-term-secondary">{reports?.length ?? 0} reports</span>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 font-mono text-xs text-term-secondary py-8">
          <span className="animate-pulse text-yellow-400">⟳</span>
          <span>$ fetching reports...</span>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-term bg-canvas/50">
              {['REPOSITORY / PR', 'RISK SCORE', 'LEVEL', 'RECOMMENDATION', 'STATUS', 'C / H', 'CREATED', ''].map((h) => (
                <th key={h} className="text-left font-mono text-[10px] text-term-secondary uppercase tracking-wider px-4 py-2.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {(reports ?? []).map((report) => (
              <tr
                key={report.reportId}
                className="hover:bg-[var(--accent)]/3 transition-colors font-mono text-xs"
              >
                <td className="px-4 py-3">
                  <Link
                    to="/reports/$reportId"
                    params={{ reportId: report.reportId }}
                    className="text-accent hover:underline font-medium block"
                  >
                    {report.repoId}
                  </Link>
                  {report.prContext?.prTitle && (
                    <p className="text-term-secondary text-[10px] mt-0.5 truncate max-w-[200px]">
                      #{report.prContext.prNumber} {report.prContext.prTitle}
                    </p>
                  )}
                </td>

                <td className="px-4 py-3">
                  <RiskBar score={report.riskScore} level={report.riskLevel} />
                </td>

                <td className="px-4 py-3">
                  <span className={riskLevelBadge(report.riskLevel)}>{report.riskLevel}</span>
                </td>

                <td className="px-4 py-3">
                  <span className={riskLevelBadge(
                    report.mergeRecommendation === 'APPROVE' ? 'LOW' :
                    report.mergeRecommendation === 'BLOCK'   ? 'CRITICAL' : 'MEDIUM'
                  )}>{report.mergeRecommendation}</span>
                </td>

                <td className="px-4 py-3">
                  <span className={riskLevelBadge(
                    report.approvalStatus === 'APPROVED' ? 'LOW' :
                    report.approvalStatus === 'REJECTED' ? 'CRITICAL' : 'MEDIUM'
                  )}>{report.approvalStatus}</span>
                </td>

                <td className="px-4 py-3 text-term">
                  <span className="text-red-400">{report.findingsBySeverity?.['CRITICAL'] ?? 0}</span>
                  <span className="text-term-secondary mx-1">/</span>
                  <span className="text-orange-400">{report.findingsBySeverity?.['HIGH'] ?? 0}</span>
                </td>

                <td className="px-4 py-3 text-term-secondary">{formatDate(report.createdAt)}</td>

                <td className="px-4 py-3">
                  <button
                    onClick={(e) => handleDelete(report.reportId, e)}
                    disabled={deleteMutation.isPending}
                    className="p-1 rounded text-term-secondary/40 hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-30"
                    title="리포트 삭제"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(reports ?? []).length === 0 && !isLoading && (
          <div className="py-12 text-center font-mono text-xs text-term-secondary">
            <p className="text-2xl mb-2 opacity-20">○</p>
            리포트가 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}
