import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '@/lib/api-client';
import { formatDate, riskLevelBadge } from '@/lib/utils';

interface Report {
  readonly reportId: string;
  readonly repoId: string;
  readonly riskLevel: string;
  readonly mergeRecommendation: string;
  readonly approvalStatus: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly findingsBySeverity: Record<string, number>;
}

export function ReportsPage() {
  const { data: reports, isLoading } = useQuery<Report[]>({
    queryKey: ['reports'],
    queryFn: () => api.get<Report[]>('/reports'),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">분석 리포트</h1>

      {isLoading && <div className="text-center py-12 text-gray-500">로딩 중...</div>}

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">리포지토리</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">리스크</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">권고사항</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">승인 상태</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Critical/High</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">생성 시간</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {(reports ?? []).map((report) => (
              <tr key={report.reportId} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                <td className="px-6 py-4">
                  <Link
                    to="/reports/$reportId"
                    params={{ reportId: report.reportId }}
                    className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
                  >
                    {report.repoId}
                  </Link>
                </td>
                <td className="px-6 py-4"><span className={riskLevelBadge(report.riskLevel)}>{report.riskLevel}</span></td>
                <td className="px-6 py-4">
                  <span className={riskLevelBadge(
                    report.mergeRecommendation === 'APPROVE' ? 'LOW'
                    : report.mergeRecommendation === 'BLOCK' ? 'CRITICAL'
                    : 'MEDIUM'
                  )}>{report.mergeRecommendation}</span>
                </td>
                <td className="px-6 py-4">
                  <span className={riskLevelBadge(
                    report.approvalStatus === 'APPROVED' ? 'LOW'
                    : report.approvalStatus === 'REJECTED' ? 'CRITICAL'
                    : 'MEDIUM'
                  )}>{report.approvalStatus}</span>
                </td>
                <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                  {(report.findingsBySeverity['CRITICAL'] ?? 0) + (report.findingsBySeverity['HIGH'] ?? 0)}
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">{formatDate(report.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(reports ?? []).length === 0 && !isLoading && (
          <p className="text-center py-12 text-gray-500">리포트가 없습니다.</p>
        )}
      </div>
    </div>
  );
}
