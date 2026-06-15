import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { CheckCircle, Circle, ArrowRight, Github, Slack, Plus } from 'lucide-react';
import { api } from '../lib/api-client.js';

type Step = 1 | 2 | 3 | 4;

interface OrgSetupResult {
  orgId: string;
  orgName: string;
  githubAppInstallUrl: string;
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — Org setup
  const [orgName, setOrgName] = useState('');
  const [githubLogin, setGithubLogin] = useState('');
  const [orgSetup, setOrgSetup] = useState<OrgSetupResult | null>(null);

  // Step 4 — First repo
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
      setOrgSetup(data);
      setCurrentStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleInstallGitHub = () => {
    if (orgSetup?.githubAppInstallUrl) {
      window.open(orgSetup.githubAppInstallUrl, '_blank');
    }
  };

  const handleConnectSlack = async () => {
    setLoading(true);
    try {
      const data = await api.get<{ slack: { connectUrl: string } }>('/integrations');
      if (data.slack.connectUrl) {
        window.location.href = data.slack.connectUrl;
      }
    } catch (err) {
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
    try {
      await api.post('/onboarding/complete', {});
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
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-16 px-4">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900">AIGO 시작하기</h1>
          <p className="mt-2 text-gray-500">몇 가지 설정을 완료하면 바로 사용할 수 있습니다</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center mb-10">
          {steps.map((s, idx) => (
            <div key={s.num} className="flex items-center">
              <div className="flex items-center gap-2">
                {currentStep > s.num ? (
                  <CheckCircle className="w-8 h-8 text-indigo-600" />
                ) : currentStep === s.num ? (
                  <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-bold">
                    {s.num}
                  </div>
                ) : (
                  <Circle className="w-8 h-8 text-gray-300" />
                )}
                <span className={`text-sm font-medium hidden sm:block ${currentStep === s.num ? 'text-indigo-600' : currentStep > s.num ? 'text-gray-700' : 'text-gray-400'}`}>
                  {s.label}
                </span>
              </div>
              {idx < steps.length - 1 && (
                <div className={`w-12 sm:w-16 h-0.5 mx-2 ${currentStep > s.num ? 'bg-indigo-600' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          {/* Step 1: Create Org */}
          {currentStep === 1 && (
            <form onSubmit={handleCreateOrg} className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">조직을 생성하세요</h2>
                <p className="text-sm text-gray-500">팀과 함께 사용할 조직을 만듭니다</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">조직 이름 *</label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Acme Corp"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">GitHub 계정/조직명 (선택)</label>
                <input
                  type="text"
                  value={githubLogin}
                  onChange={(e) => setGithubLogin(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="your-github-org"
                />
                <p className="mt-1 text-xs text-gray-400">GitHub App 설치 시 자동으로 연결됩니다</p>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? '생성 중...' : (<><span>조직 생성</span><ArrowRight className="w-4 h-4" /></>)}
              </button>
            </form>
          )}

          {/* Step 2: Install GitHub App */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">GitHub App 설치</h2>
                <p className="text-sm text-gray-500">PR 이벤트를 수신하기 위해 GitHub App을 설치합니다</p>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 flex items-start gap-3">
                <Github className="w-5 h-5 text-gray-700 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-900">GitHub App 설치 후 이 페이지로 돌아오세요</p>
                  <p className="text-xs text-gray-500 mt-1">설치가 완료되면 자동으로 연결됩니다</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleInstallGitHub}
                  className="flex-1 rounded-lg bg-gray-900 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 flex items-center justify-center gap-2"
                >
                  <Github className="w-4 h-4" />
                  GitHub App 설치하기
                </button>
                <button
                  onClick={() => setCurrentStep(3)}
                  className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-2"
                >
                  나중에 하기 <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Connect Slack */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Slack 연결</h2>
                <p className="text-sm text-gray-500">분석 완료 알림을 Slack으로 받습니다</p>
              </div>
              <div className="rounded-lg bg-purple-50 border border-purple-200 p-4 flex items-start gap-3">
                <Slack className="w-5 h-5 text-purple-700 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-purple-900">Slack 워크스페이스에 AIGO Bot을 추가합니다</p>
                  <p className="text-xs text-purple-600 mt-1">PR 분석 결과, 승인 요청, 인시던트 알림을 전송합니다</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleConnectSlack}
                  disabled={loading}
                  className="flex-1 rounded-lg bg-purple-600 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Slack className="w-4 h-4" />
                  {loading ? '연결 중...' : 'Slack 연결하기'}
                </button>
                <button
                  onClick={() => setCurrentStep(4)}
                  className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-2"
                >
                  나중에 하기 <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Register first repo */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">첫 번째 저장소 등록</h2>
                <p className="text-sm text-gray-500">분석할 GitHub 저장소를 등록합니다</p>
              </div>
              {!repoRegistered ? (
                <form onSubmit={handleRegisterRepo} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">저장소 이름</label>
                    <input
                      type="text"
                      value={repoFullName}
                      onChange={(e) => setRepoFullName(e.target.value)}
                      required
                      pattern="[\w.-]+/[\w.-]+"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="your-org/your-repo"
                    />
                    <p className="mt-1 text-xs text-gray-400">owner/repository 형식으로 입력하세요</p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      {loading ? '등록 중...' : '저장소 등록'}
                    </button>
                    <button
                      type="button"
                      onClick={handleComplete}
                      disabled={loading}
                      className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      나중에 하기
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg bg-green-50 border border-green-200 p-4 flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                    <p className="text-sm font-medium text-green-900">{repoFullName} 등록 완료!</p>
                  </div>
                  <button
                    onClick={handleComplete}
                    disabled={loading}
                    className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading ? '설정 완료 중...' : (<><span>시작하기</span><ArrowRight className="w-4 h-4" /></>)}
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
