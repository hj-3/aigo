import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '@/lib/api-client';
import { formatDate, riskLevelBadge } from '@/lib/utils';

interface FixRequest {
  readonly fixId: string;
  readonly reportId: string;
  readonly repoId: string;
  readonly status: string;
  readonly requestedBy: string;
  readonly patchSummary?: string;
  readonly prUrl?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const STATUS_OPTIONS = ['PENDING', 'IN_PROGRESS', 'PATCH_READY', 'PR_CREATED', 'APPLIED', 'FAILED'];

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'APPLIED':      return 'badge-low';
    case 'PR_CREATED':   return 'badge-medium';
    case 'PATCH_READY':  return 'badge-medium';
    case 'IN_PROGRESS':  return 'badge-info';
    case 'PENDING':      return 'badge-info';
    case 'FAILED':       return 'badge-critical';
    default:             return 'badge-info';
  }
}

export function FixCenterPage() {
  const [status, setStatus] = useState('PENDING');

  const { data: fixes, isLoading } = useQuery<FixRequest[]>({
    queryKey: ['fixes', status],
    queryFn: () => api.get<FixRequest[]>(`/fix?status=${status}`),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-term">수정 센터</h1>
        <div className="flex gap-2">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                status === s
                  ? 'bg-accent text-white'
                  : 'bg-canvas text-term-secondary hover:bg-surface hover:text-term'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div className="text-center py-12 text-term-secondary">로딩 중...</div>}

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-canvas">
              <th className="text-left text-xs font-medium text-term-secondary uppercase tracking-wider px-6 py-3">Fix ID</th>
              <th className="text-left text-xs font-medium text-term-secondary uppercase tracking-wider px-6 py-3">리포트</th>
              <th className="text-left text-xs font-medium text-term-secondary uppercase tracking-wider px-6 py-3">상태</th>
              <th className="text-left text-xs font-medium text-term-secondary uppercase tracking-wider px-6 py-3">요청자</th>
              <th className="text-left text-xs font-medium text-term-secondary uppercase tracking-wider px-6 py-3">패치 요약</th>
              <th className="text-left text-xs font-medium text-term-secondary uppercase tracking-wider px-6 py-3">생성 시간</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(fixes ?? []).map((fix) => (
              <tr key={fix.fixId} className="hover:bg-canvas transition-colors">
                <td className="px-6 py-4 font-mono text-xs text-term">
                  {fix.prUrl ? (
                    <a
                      href={fix.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:opacity-80"
                    >
                      {fix.fixId.slice(0, 12)}…
                    </a>
                  ) : (
                    fix.fixId.slice(0, 12) + '…'
                  )}
                </td>
                <td className="px-6 py-4">
                  <Link
                    to="/reports/$reportId"
                    params={{ reportId: fix.reportId }}
                    className="text-sm text-accent hover:opacity-80"
                  >
                    {fix.reportId.slice(0, 12)}…
                  </Link>
                </td>
                <td className="px-6 py-4">
                  <span className={riskLevelBadge(statusBadgeClass(fix.status))}>{fix.status}</span>
                </td>
                <td className="px-6 py-4 text-sm text-term">{fix.requestedBy}</td>
                <td className="px-6 py-4 text-sm text-term-secondary max-w-xs truncate">
                  {fix.patchSummary ?? '—'}
                </td>
                <td className="px-6 py-4 text-sm text-term-secondary">{formatDate(fix.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(fixes ?? []).length === 0 && !isLoading && (
          <p className="text-center py-12 text-term-secondary">{status} 상태의 수정 요청이 없습니다.</p>
        )}
      </div>
    </div>
  );
}
