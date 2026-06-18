import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAuthSession } from 'aws-amplify/auth';
import { UserPlus, Trash2, Users, RefreshCw } from 'lucide-react';
import { api } from '../lib/api-client.js';

type Role = 'OWNER' | 'ADMIN' | 'REVIEWER' | 'VIEWER';

interface Member {
  userId: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  createdAt: string;
}

const ROLE_LABELS: Record<Role, string> = {
  OWNER: '소유자',
  ADMIN: '관리자',
  REVIEWER: '리뷰어',
  VIEWER: '뷰어',
};

const ROLE_COLORS: Record<Role, string> = {
  OWNER: 'bg-purple-500/15 text-purple-500 border border-purple-500/30',
  ADMIN: 'bg-blue-500/15 text-blue-500 border border-blue-500/30',
  REVIEWER: 'bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/30',
  VIEWER: 'bg-canvas text-term-secondary border border-term',
};

export function TeamPage() {
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<Role, 'OWNER'>>('REVIEWER');
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<Role | null>(null);

  useEffect(() => {
    fetchAuthSession({ forceRefresh: false }).then((session) => {
      const payload = session.tokens?.idToken?.payload as Record<string, unknown> | undefined;
      setCurrentUserId((payload?.['sub'] as string) ?? null);
      setCurrentRole(((payload?.['custom:role'] as string) ?? null) as Role | null);
    }).catch(() => {});
  }, []);

  const isOwner = currentRole === 'OWNER';

  const { data: members = [], isLoading, isError, error: queryError, refetch } = useQuery<Member[]>({
    queryKey: ['team'],
    queryFn: () => api.get<Member[]>('/team/members'),
    retry: 1,
  });

  const visibleMembers = members.filter((m) => m.status !== 'REMOVED');

  const inviteMutation = useMutation({
    mutationFn: (body: { email: string; role: string }) =>
      api.post('/team/invite', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team'] });
      setShowInvite(false);
      setInviteEmail('');
      setError(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/team/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
    onError: (err: Error) => setError(err.message),
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.patch(`/team/members/${userId}/role`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-term">팀 관리</h1>
          <p className="mt-1 text-sm text-term-secondary">팀원을 초대하고 역할을 관리합니다</p>
        </div>
        {isOwner && (
          <button
            onClick={() => setShowInvite(true)}
            className="btn-primary flex items-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            팀원 초대
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {showInvite && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="card p-6 w-full max-w-md shadow-xl">
            <h2 className="text-base font-semibold text-term mb-4">팀원 초대</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                inviteMutation.mutate({ email: inviteEmail, role: inviteRole });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-term-secondary mb-1.5">이메일</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  className="input-term"
                  placeholder="colleague@company.com"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-term-secondary mb-1.5">역할</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as Exclude<Role, 'OWNER'>)}
                  className="input-term"
                >
                  <option value="ADMIN">관리자 — 설정 변경, 분석 실행</option>
                  <option value="REVIEWER">리뷰어 — 리포트 조회, 승인/반려</option>
                  <option value="VIEWER">뷰어 — 읽기 전용</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={inviteMutation.isPending}
                  className="btn-primary flex-1"
                >
                  {inviteMutation.isPending ? '전송 중...' : '초대 보내기'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowInvite(false); setError(null); }}
                  className="btn-ghost flex-1"
                >
                  취소
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-sm text-term-secondary">불러오는 중...</div>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-sm text-red-400">
              팀원 목록을 불러오지 못했습니다.{' '}
              {queryError instanceof Error ? queryError.message : ''}
            </p>
            <button
              onClick={() => refetch()}
              className="btn-ghost flex items-center gap-2 text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" /> 다시 시도
            </button>
          </div>
        ) : visibleMembers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Users className="w-12 h-12 text-term-secondary opacity-30" />
            <p className="text-sm text-term-secondary">아직 팀원이 없습니다. 팀원을 초대하세요.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b bg-canvas">
                <th className="text-left px-6 py-3 text-xs font-medium text-term-secondary uppercase tracking-wider">이름</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-term-secondary uppercase tracking-wider">이메일</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-term-secondary uppercase tracking-wider">역할</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-term-secondary uppercase tracking-wider">상태</th>
                {isOwner && <th className="px-6 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {visibleMembers.map((member) => (
                <tr key={member.userId} className="hover:bg-canvas transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-accent/15 flex items-center justify-center text-sm font-medium text-accent">
                        {(member.name ?? member.email)?.[0]?.toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-term">
                        {member.name ?? member.email}
                        {member.userId === currentUserId && (
                          <span className="ml-2 text-xs text-term-secondary">(나)</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-term-secondary">{member.email}</td>
                  <td className="px-6 py-4">
                    {isOwner && member.role !== 'OWNER' && member.userId !== currentUserId ? (
                      <select
                        value={member.role}
                        onChange={(e) =>
                          updateRoleMutation.mutate({ userId: member.userId, role: e.target.value })
                        }
                        className="text-xs rounded-md border border-border bg-surface px-2 py-1 cursor-pointer text-term focus:ring-1 focus:ring-accent focus:outline-none"
                      >
                        {(['ADMIN', 'REVIEWER', 'VIEWER'] as const).map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_COLORS[member.role]}`}>
                        {ROLE_LABELS[member.role]}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      member.status === 'ACTIVE'
                        ? 'bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/30'
                        : 'bg-canvas text-term-secondary border border-term'
                    }`}>
                      {member.status === 'ACTIVE' ? '활성' : member.status}
                    </span>
                  </td>
                  {isOwner && (
                    <td className="px-6 py-4 text-right">
                      {member.role !== 'OWNER' && member.userId !== currentUserId && (
                        <button
                          onClick={() => {
                            if (confirm(`${member.name ?? member.email}을(를) 팀에서 제거할까요?`)) {
                              removeMutation.mutate(member.userId);
                            }
                          }}
                          className="text-red-400 hover:text-red-500 transition-colors"
                          title="팀에서 제거"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
