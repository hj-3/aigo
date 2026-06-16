import { useQuery } from '@tanstack/react-query';
import { Activity, FileText, AlertTriangle, CheckCircle, Link as LinkIcon } from 'lucide-react';
import { Link } from '@tanstack/react-router';
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

export function DashboardPage() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get<DashboardStats>('/dashboard/stats'),
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
                    {report.mergeRecommendation}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
