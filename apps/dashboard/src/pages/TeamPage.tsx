import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Trash2, Edit2, Users } from 'lucide-react';
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
  OWNER: 'bg-purple-100 text-purple-700',
  ADMIN: 'bg-blue-100 text-blue-700',
  REVIEWER: 'bg-green-100 text-green-700',
  VIEWER: 'bg-gray-100 text-gray-600',
};

export function TeamPage() {
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<Role, 'OWNER'>>('REVIEWER');
  const [error, setError] = useState<string | null>(null);

  const { data: members = [], isLoading } = useQuery<Member[]>({
    queryKey: ['team'],
    queryFn: () => api.get<Member[]>('/team/members'),
  });

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
          <h1 className="text-2xl font-bold text-gray-900">팀 관리</h1>
          <p className="mt-1 text-sm text-gray-500">팀원을 초대하고 역할을 관리합니다</p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          <UserPlus className="w-4 h-4" />
          팀원 초대
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">팀원 초대</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                inviteMutation.mutate({ email: inviteEmail, role: inviteRole });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="colleague@company.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">역할</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as Exclude<Role, 'OWNER'>)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                  className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {inviteMutation.isPending ? '전송 중...' : '초대 보내기'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowInvite(false); setError(null); }}
                  className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Members table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-sm text-gray-500">불러오는 중...</div>
          </div>
        ) : members.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Users className="w-12 h-12 text-gray-300" />
            <p className="text-sm text-gray-500">아직 팀원이 없습니다. 팀원을 초대하세요.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">이름</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">이메일</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">역할</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">상태</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map((member) => (
                <tr key={member.userId} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-medium text-indigo-700">
                        {member.name[0]?.toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-gray-900">{member.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{member.email}</td>
                  <td className="px-6 py-4">
                    {member.role === 'OWNER' ? (
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_COLORS[member.role]}`}>
                        {ROLE_LABELS[member.role]}
                      </span>
                    ) : (
                      <select
                        value={member.role}
                        onChange={(e) =>
                          updateRoleMutation.mutate({ userId: member.userId, role: e.target.value })
                        }
                        className="text-xs rounded-full border-0 bg-transparent cursor-pointer focus:ring-2 focus:ring-indigo-500"
                      >
                        {(['ADMIN', 'REVIEWER', 'VIEWER'] as const).map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${member.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {member.status === 'ACTIVE' ? '활성' : member.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {member.role !== 'OWNER' && (
                      <button
                        onClick={() => {
                          if (confirm(`${member.name}을 팀에서 제거할까요?`)) {
                            removeMutation.mutate(member.userId);
                          }
                        }}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        title="팀에서 제거"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
