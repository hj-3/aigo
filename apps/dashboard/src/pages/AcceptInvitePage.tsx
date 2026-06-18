import { useEffect, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { CheckCircle, XCircle, Loader } from 'lucide-react';
import { api } from '../lib/api-client.js';

interface InviteInfo {
  invitationId: string;
  orgName: string;
  email: string;
  role: string;
}

const ROLE_KO: Record<string, string> = {
  ADMIN: '관리자',
  REVIEWER: '리뷰어',
  VIEWER: '뷰어',
};

export function AcceptInvitePage() {
  const navigate = useNavigate();
  const search = useSearch({ from: '/invite' }) as { token?: string };
  const token = search.token ?? '';

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('유효하지 않은 초대 링크입니다.');
      setLoading(false);
      return;
    }
    api.get<InviteInfo>(`/team/invite/${token}`)
      .then((data) => setInvite(data))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('INVITATION_EXPIRED')) setError('초대 링크가 만료되었습니다 (7일 유효).');
        else if (msg.includes('INVITATION_ALREADY_USED')) setError('이미 수락된 초대입니다.');
        else setError('초대를 불러올 수 없습니다.');
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleAccept = async () => {
    setAccepting(true);
    setError(null);
    try {
      // Check if already logged in
      let isLoggedIn = false;
      try {
        await getCurrentUser();
        isLoggedIn = true;
      } catch {
        isLoggedIn = false;
      }

      if (!isLoggedIn) {
        navigate({ to: '/login', search: { from: `/invite?token=${token}` } });
        return;
      }

      await api.post('/team/accept-invite', { invitationId: token });
      await fetchAuthSession({ forceRefresh: true });
      setDone(true);
      setTimeout(() => navigate({ to: '/' }), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('EMAIL_MISMATCH')) {
        setError(`초대받은 이메일(${invite?.email})과 로그인 계정이 다릅니다. 올바른 계정으로 로그인하세요.`);
      } else {
        setError(msg);
      }
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <Loader className="w-6 h-6 text-accent animate-spin" />
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-3">
        <CheckCircle className="w-10 h-10 text-green-400" />
        <p className="text-term font-medium">초대를 수락했습니다. 대시보드로 이동합니다...</p>
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-3 px-4">
        <XCircle className="w-10 h-10 text-red-400" />
        <p className="text-red-400 font-medium text-center">{error}</p>
        <button onClick={() => navigate({ to: '/login' })} className="btn-primary mt-4">
          로그인으로 이동
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm card p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-term">팀 초대</h1>
          <p className="text-sm text-term-secondary mt-1">AgentOps Platform</p>
        </div>

        {invite && (
          <div className="rounded-lg border border-border bg-surface p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-term-secondary">조직</span>
              <span className="text-term font-medium">{invite.orgName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-term-secondary">역할</span>
              <span className="text-term font-medium">{ROLE_KO[invite.role] ?? invite.role}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-term-secondary">초대 이메일</span>
              <span className="text-term font-medium">{invite.email}</span>
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-400 text-center">{error}</p>
        )}

        <button
          onClick={handleAccept}
          disabled={accepting}
          className="btn-primary w-full"
        >
          {accepting ? '처리 중...' : '초대 수락하기'}
        </button>

        <p className="text-xs text-term-secondary text-center">
          초대받은 이메일과 동일한 계정으로 로그인해야 합니다
        </p>
      </div>
    </div>
  );
}
