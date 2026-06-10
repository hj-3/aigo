import { useQuery } from '@tanstack/react-query';
import { Activity, FileText, AlertTriangle, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api-client';
import { formatDate, riskLevelBadge } from '@/lib/utils';

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
    readonly createdAt: string;
  }>;
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: typeof Activity; color: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
        </div>
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get<DashboardStats>('/dashboard/stats'),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">대시보드</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 h-32 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">대시보드</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">AgentOps 플랫폼 현황</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label="전체 분석 작업" value={stats?.totalJobs ?? 0} icon={Activity} color="bg-blue-500" />
        <StatCard label="대기 중" value={stats?.pendingJobs ?? 0} icon={FileText} color="bg-yellow-500" />
        <StatCard label="활성 인시던트" value={stats?.openIncidents ?? 0} icon={AlertTriangle} color="bg-red-500" />
        <StatCard label="오늘 승인된 PR" value={stats?.approvedToday ?? 0} icon={CheckCircle} color="bg-green-500" />
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">최근 분석 리포트</h2>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-800">
          {(stats?.recentReports ?? []).map((report) => (
            <div key={report.reportId} className="px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{report.repoName}</p>
                <p className="text-xs text-gray-500 mt-1">{formatDate(report.createdAt)}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={riskLevelBadge(report.riskLevel)}>{report.riskLevel}</span>
                <span className={riskLevelBadge(
                  report.mergeRecommendation === 'APPROVE' ? 'LOW'
                  : report.mergeRecommendation === 'BLOCK' ? 'CRITICAL'
                  : 'MEDIUM'
                )}>
                  {report.mergeRecommendation}
                </span>
              </div>
            </div>
          ))}
          {(stats?.recentReports ?? []).length === 0 && (
            <p className="px-6 py-8 text-center text-gray-500">아직 분석 리포트가 없습니다.</p>
          )}
        </div>
      </div>
    </div>
  );
}
