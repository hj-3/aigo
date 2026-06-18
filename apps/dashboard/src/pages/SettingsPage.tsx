import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Github, Slack, CheckCircle, XCircle } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth';

interface IntegrationStatus {
  github: {
    connected: boolean;
    accountLogin?: string;
    installedAt?: string;
    installUrl: string;
  };
  slack: {
    connected: boolean;
    teamName?: string;
    teamId?: string;
    connectUrl: string;
  };
}

interface OrgSettings {
  readonly orgId: string;
  readonly name: string;
  readonly autoAnalyzeOnPR: boolean;
  readonly riskThreshold: string;
  readonly approvalRequired: boolean;
  readonly slackChannel?: string;
  readonly timezone: string;
  readonly notificationChannels: string[];
  readonly updatedAt: string;
}

type SettingsDraft = Omit<OrgSettings, 'orgId' | 'name' | 'updatedAt'>;

export function SettingsPage() {
  const queryClient = useQueryClient();
  const hasAdminRole = useAuthStore((s) => s.hasRole('ADMIN'));

  const { data: settings, isLoading } = useQuery<OrgSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get<OrgSettings>('/settings'),
  });

  const { data: integrations } = useQuery<IntegrationStatus>({
    queryKey: ['integrations'],
    queryFn: () => api.get<IntegrationStatus>('/integrations'),
  });

  const disconnectSlackMutation = useMutation({
    mutationFn: () => api.delete('/integrations/slack'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations'] }),
  });

  const [draft, setDraft] = useState<Partial<SettingsDraft>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (updates: Partial<SettingsDraft>) => api.patch('/settings', updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setDraft({});
      setSaveError(null);
    },
    onError: (err: unknown) => {
      setSaveError(String(err instanceof Error ? err.message : err));
    },
  });

  if (isLoading) {
    return <div className="text-center py-12 text-term-secondary">로딩 중...</div>;
  }

  const effective = { ...settings, ...draft } as OrgSettings & Partial<SettingsDraft>;
  const isDirty = Object.keys(draft).length > 0;

  function field<K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-term">설정</h1>
          <p className="text-sm text-term-secondary mt-1">조직 설정 및 알림 구성</p>
        </div>
        {hasAdminRole && (
          <button
            disabled={!isDirty || mutation.isPending}
            onClick={() => mutation.mutate(draft)}
            className="btn-primary"
          >
            {mutation.isPending ? '저장 중...' : '변경 사항 저장'}
          </button>
        )}
      </div>

      {saveError && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4 text-sm text-red-400">
          {saveError}
        </div>
      )}

      {mutation.isSuccess && !isDirty && (
        <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-4 text-sm text-green-500">
          설정이 저장되었습니다.
        </div>
      )}

      {/* Analysis Settings */}
      <div className="card p-6 space-y-6">
        <h2 className="font-semibold text-term">분석 설정</h2>

        <label className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-term">PR 자동 분석</p>
            <p className="text-xs text-term-secondary mt-0.5">새 PR이 열릴 때 자동으로 분석을 시작합니다</p>
          </div>
          <input
            type="checkbox"
            disabled={!hasAdminRole}
            checked={effective.autoAnalyzeOnPR ?? false}
            onChange={(e) => field('autoAnalyzeOnPR', e.target.checked)}
            className="w-5 h-5 rounded accent-accent disabled:opacity-40"
          />
        </label>

        <label className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-term">수동 승인 필수</p>
            <p className="text-xs text-term-secondary mt-0.5">활성화 시 리스크 수준과 무관하게 사람이 직접 승인해야 PR이 머지됩니다</p>
          </div>
          <input
            type="checkbox"
            disabled={!hasAdminRole}
            checked={effective.approvalRequired ?? false}
            onChange={(e) => field('approvalRequired', e.target.checked)}
            className="w-5 h-5 rounded accent-accent disabled:opacity-40"
          />
        </label>

        <div>
          <label className="block text-sm font-medium text-term mb-1">
            자동 머지 임계값
          </label>
          <p className="text-xs text-term-secondary mb-2">
            이 수준 미만의 PR은 APPROVE 권고 시 자동으로 머지됩니다. 수동 승인 필수가 켜져 있으면 무시됩니다.
          </p>
          <select
            disabled={!hasAdminRole}
            value={effective.riskThreshold ?? 'HIGH'}
            onChange={(e) => field('riskThreshold', e.target.value)}
            className="w-48 input-term disabled:opacity-40"
          >
            <option value="NONE">자동 머지 없음</option>
            <option value="LOW">LOW만 (리스크 점수 &lt; 20)</option>
            <option value="MEDIUM">MEDIUM 이하 (리스크 점수 &lt; 40)</option>
            <option value="HIGH">HIGH 이하 (리스크 점수 &lt; 75)</option>
            <option value="CRITICAL">모두 자동 머지</option>
          </select>
        </div>
      </div>

      {/* Notification Settings */}
      <div className="card p-6 space-y-6">
        <h2 className="font-semibold text-term">알림 설정</h2>

        <div>
          <label className="block text-sm font-medium text-term mb-1">
            Slack 기본 채널
          </label>
          <input
            type="text"
            disabled={!hasAdminRole}
            placeholder="#agentops-alerts"
            value={effective.slackChannel ?? ''}
            onChange={(e) => field('slackChannel', e.target.value)}
            className="w-72 input-term disabled:opacity-40"
          />
        </div>
      </div>

      {/* General Settings */}
      <div className="card p-6 space-y-6">
        <h2 className="font-semibold text-term">일반 설정</h2>

        <div>
          <label className="block text-sm font-medium text-term mb-1">
            시간대
          </label>
          <select
            disabled={!hasAdminRole}
            value={effective.timezone ?? 'Asia/Seoul'}
            onChange={(e) => field('timezone', e.target.value)}
            className="w-72 input-term disabled:opacity-40"
          >
            <option value="Asia/Seoul">Asia/Seoul (KST)</option>
            <option value="UTC">UTC</option>
            <option value="America/New_York">America/New_York (EST)</option>
            <option value="Europe/London">Europe/London (GMT)</option>
          </select>
        </div>

        {settings?.updatedAt && (
          <p className="text-xs text-term-secondary">
            마지막 업데이트:{' '}
            {new Intl.DateTimeFormat('ko-KR', {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(settings.updatedAt))}
          </p>
        )}
      </div>

      {/* Integrations Section */}
      <div className="card p-6 space-y-5">
        <h2 className="font-semibold text-term">연동</h2>

        {/* GitHub */}
        <div className="flex items-center justify-between p-4 rounded-lg border">
          <div className="flex items-center gap-3">
            <Github className="w-6 h-6 text-term" />
            <div>
              <p className="text-sm font-medium text-term">GitHub</p>
              {integrations?.github?.connected
                ? <p className="text-xs text-term-secondary mt-0.5">@{integrations.github.accountLogin} 연결됨</p>
                : <p className="text-xs text-term-secondary mt-0.5">GitHub App이 연결되지 않았습니다</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {integrations?.github?.connected
              ? <CheckCircle className="w-5 h-5 text-green-500" />
              : <XCircle className="w-5 h-5 text-term-secondary opacity-30" />}
            {!integrations?.github?.connected && integrations?.github?.installUrl && (
              <a
                href={integrations.github.installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost text-xs py-1.5 px-3"
              >
                App 설치
              </a>
            )}
          </div>
        </div>

        {/* Slack */}
        <div className="flex items-center justify-between p-4 rounded-lg border">
          <div className="flex items-center gap-3">
            <Slack className="w-6 h-6 text-purple-500" />
            <div>
              <p className="text-sm font-medium text-term">Slack</p>
              {integrations?.slack?.connected
                ? <p className="text-xs text-term-secondary mt-0.5">{integrations.slack.teamName} 연결됨</p>
                : <p className="text-xs text-term-secondary mt-0.5">Slack 워크스페이스가 연결되지 않았습니다</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {integrations?.slack?.connected
              ? <CheckCircle className="w-5 h-5 text-green-500" />
              : <XCircle className="w-5 h-5 text-term-secondary opacity-30" />}
            {integrations?.slack?.connected ? (
              <button
                onClick={() => disconnectSlackMutation.mutate()}
                disabled={disconnectSlackMutation.isPending}
                className="btn-danger py-1.5 px-3 text-xs"
              >
                연결 해제
              </button>
            ) : integrations?.slack?.connectUrl ? (
              <a
                href={integrations.slack.connectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 transition-colors"
              >
                Slack 연결
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {!hasAdminRole && (
        <p className="text-sm text-term-secondary text-center">
          설정을 변경하려면 관리자 이상의 권한이 필요합니다.
        </p>
      )}
    </div>
  );
}
