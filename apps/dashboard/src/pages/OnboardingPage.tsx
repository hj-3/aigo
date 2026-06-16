import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { CheckCircle, Circle, ArrowRight, Github, Slack, Plus, ExternalLink } from 'lucide-react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { api } from '../lib/api-client.js';

type Step = 1 | 2 | 3 | 4;

interface OrgSetupResult {
  orgId: string;
  orgName: string;
  githubAppInstallUrl: string;
}

const GITHUB_INSTALL_FALLBACK = 'https://github.com/apps/aigoagent-bot/installations/new';

export function OnboardingPage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [orgName, setOrgName] = useState('');
  const [githubLogin, setGithubLogin] = useState('');
  const [orgSetup, setOrgSetup] = useState<OrgSetupResult | null>(null);

  const [repoFullName, setRepoFullName] = useState('');
  const [repoRegistered, setRepoRegistered] = useState(false);

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await api.post<OrgSetupResult>('/onboarding/setup-org', {
        orgName,
        githubLogin: githubLogin || undefined,
        plan: 'STARTER',
      });
      // Refresh token so custom:orgId is included in all subsequent API calls.
      await fetchAuthSession({ forceRefresh: true });
      setOrgSetup(data);
      setCurrentStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleInstallGitHub = async () => {
    // Open window immediately (synchronous) to avoid popup blockers.
    const win = window.open('', '_blank');
    let url = orgSetup?.githubAppInstallUrl || '';
    if (!url) {
      try {
        const data = await api.get<{ github?: { installUrl?: string } }>('/integrations');
        url = data?.github?.installUrl ?? '';
      } catch {
        // ignore — fall through to hardcoded fallback
      }
    }
    const finalUrl = url || GITHUB_INSTALL_FALLBACK;
    if (win) {
      win.location.href = finalUrl;
    } else {
      window.open(finalUrl, '_blank');
    }
  };

  const handleConnectSlack = async () => {
    // Open window immediately (synchronous) to avoid popup blockers.
    const win = window.open('', '_blank');
    setLoading(true);
    setError(null);
    try {
      // Force-refresh the token so custom:orgId attribute is included after org creation.
      await fetchAuthSession({ forceRefresh: true });

      const data = await api.get<{ slack?: { connectUrl?: string } }>('/integrations');
      const connectUrl = data?.slack?.connectUrl;

      if (connectUrl) {
        if (win) {
          win.location.href = connectUrl;
        } else {
          window.open(connectUrl, '_blank');
        }
      } else {
        if (win) win.close();
        setError('Slack 연결 URL을 가져올 수 없습니다. Slack App 설정을 확인하세요.');
      }
    } catch (err) {
      if (win) win.close();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post('/repositories', { fullName: repoFullName });
      setRepoRegistered(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.post('/onboarding/complete', {});
      // Force-refresh token so custom:onboardingCompleted is in the new session.
      await fetchAuthSession({ forceRefresh: true });
      navigate({ to: '/' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const steps = [
    { num: 1, label: '조직 생성' },
    { num: 2, label: 'GitHub 연결' },
    { num: 3, label: 'Slack 연결' },
    { num: 4, label: '저장소 등록' },
  ];

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center py-16 px-4">
      <div className="w-full max-w-2xl">

        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-2xl font-bold text-term">AIGO 시작하기</h1>
          <p className="mt-2 text-term-secondary text-sm">몇 가지 설정을 완료하면 바로 사용할 수 있습니다</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center mb-10">
          {steps.map((s, idx) => (
            <div key={s.num} className="flex items-center">
              <div className="flex items-center gap-2">
                {currentStep > s.num ? (
                  <CheckCircle className="w-7 h-7 text-accent" />
                ) : currentStep === s.num ? (
                  <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-white text-xs font-bold">
                    {s.num}
                  </div>
                ) : (
                  <Circle className="w-7 h-7 text-term-secondary opacity-40" />
                )}
                <span className={`text-xs font-medium hidden sm:block ${
                  currentStep === s.num
                    ? 'text-accent'
                    : currentStep > s.num
                      ? 'text-term'
                      : 'text-term-secondary opacity-50'
                }`}>
                  {s.label}
                </span>
              </div>
              {idx < steps.length - 1 && (
                <div className={`w-10 sm:w-14 h-px mx-2 ${
                  currentStep > s.num ? 'bg-accent' : 'bg-border'
                }`} />
              )}
            </div>
          ))}
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 font-mono">
            ✗ {error}
          </div>
        )}

        {/* Card */}
        <div className="card p-8">

          {/* Step 1: Create Org */}
          {currentStep === 1 && (
            <form onSubmit={handleCreateOrg} className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-term mb-1">조직을 생성하세요</h2>
                <p className="text-xs text-term-secondary">팀과 함께 사용할 조직을 만듭니다</p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-term-secondary mb-1.5">조직 이름 *</label>
                  <input
                    type="text"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    required
                    className="input-term"
                    placeholder="Acme Corp"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-term-secondary mb-1.5">GitHub 계정/조직명 (선택)</label>
                  <input
                    type="text"
                    value={githubLogin}
                    onChange={(e) => setGithubLogin(e.target.value)}
                    className="input-term"
                    placeholder="your-github-org"
                  />
                  <p className="mt-1 text-xs text-term-secondary opacity-60">GitHub App 설치 시 자동으로 연결됩니다</p>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {loading ? '생성 중...' : (<><span>조직 생성</span><ArrowRight className="w-3.5 h-3.5" /></>)}
              </button>
            </form>
          )}

          {/* Step 2: Install GitHub App */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-term mb-1">GitHub App 설치</h2>
                <p className="text-xs text-term-secondary">PR 이벤트를 수신하기 위해 GitHub App을 설치합니다</p>
              </div>
              <div className="rounded-lg border border-term bg-canvas p-4 flex items-start gap-3">
                <Github className="w-4 h-4 text-term mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-term">GitHub App 설치 후 이 페이지로 돌아오세요</p>
                  <p className="text-xs text-term-secondary mt-1">설치가 완료되면 Webhook이 자동으로 연결됩니다</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleInstallGitHub}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  <Github className="w-3.5 h-3.5" />
                  GitHub App 설치하기
                  <ExternalLink className="w-3 h-3 opacity-60" />
                </button>
                <button
                  onClick={() => setCurrentStep(3)}
                  className="btn-ghost flex-1 flex items-center justify-center gap-2"
                >
                  나중에 하기 <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Connect Slack */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-term mb-1">Slack 연결</h2>
                <p className="text-xs text-term-secondary">분석 완료 알림을 Slack으로 받습니다</p>
              </div>
              <div className="rounded-lg border border-term bg-canvas p-4 flex items-start gap-3">
                <Slack className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-term">Slack 워크스페이스에 AIGO Bot을 추가합니다</p>
                  <p className="text-xs text-term-secondary mt-1">PR 분석 결과, 승인 요청, 인시던트 알림을 전송합니다</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleConnectSlack}
                  disabled={loading}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  <Slack className="w-3.5 h-3.5" />
                  {loading ? '연결 중...' : 'Slack 연결하기'}
                </button>
                <button
                  onClick={() => setCurrentStep(4)}
                  className="btn-ghost flex-1 flex items-center justify-center gap-2"
                >
                  나중에 하기 <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Register first repo */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-term mb-1">첫 번째 저장소 등록</h2>
                <p className="text-xs text-term-secondary">분석할 GitHub 저장소를 등록합니다</p>
              </div>
              {!repoRegistered ? (
                <form onSubmit={handleRegisterRepo} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-term-secondary mb-1.5">저장소 이름</label>
                    <input
                      type="text"
                      value={repoFullName}
                      onChange={(e) => setRepoFullName(e.target.value)}
                      required
                      pattern="[\w.\-]+/[\w.\-]+"
                      className="input-term"
                      placeholder="your-org/your-repo"
                    />
                    <p className="mt-1 text-xs text-term-secondary opacity-60">owner/repository 형식으로 입력하세요</p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={loading}
                      className="btn-primary flex-1 flex items-center justify-center gap-2"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {loading ? '등록 중...' : '저장소 등록'}
                    </button>
                    <button
                      type="button"
                      onClick={handleComplete}
                      disabled={loading}
                      className="btn-ghost flex-1"
                    >
                      나중에 하기
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 flex items-center gap-3">
                    <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                    <p className="text-sm font-medium text-term">{repoFullName} 등록 완료!</p>
                  </div>
                  <button
                    onClick={handleComplete}
                    disabled={loading}
                    className="btn-primary w-full flex items-center justify-center gap-2"
                  >
                    {loading ? '설정 완료 중...' : (<><span>시작하기</span><ArrowRight className="w-3.5 h-3.5" /></>)}
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
