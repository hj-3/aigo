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
    return <div className="text-center py-12 text-gray-500">로딩 중...</div>;
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">설정</h1>
          <p className="text-sm text-gray-500 mt-1">조직 설정 및 알림 구성</p>
        </div>
        {hasAdminRole && (
          <button
            disabled={!isDirty || mutation.isPending}
            onClick={() => mutation.mutate(draft)}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-brand-700 transition-colors"
          >
            {mutation.isPending ? '저장 중...' : '변경 사항 저장'}
          </button>
        )}
      </div>

      {saveError && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {saveError}
        </div>
      )}

      {mutation.isSuccess && !isDirty && (
        <div className="rounded-md bg-green-50 border border-green-200 p-4 text-sm text-green-700">
          설정이 저장되었습니다.
        </div>
      )}

      {/* Analysis Settings */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-6">
        <h2 className="font-semibold text-gray-900 dark:text-white">분석 설정</h2>

        <label className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">PR 자동 분석</p>
            <p className="text-xs text-gray-500 mt-0.5">새 PR이 열릴 때 자동으로 분석을 시작합니다</p>
          </div>
          <input
            type="checkbox"
            disabled={!hasAdminRole}
            checked={effective.autoAnalyzeOnPR ?? false}
            onChange={(e) => field('autoAnalyzeOnPR', e.target.checked)}
            className="w-5 h-5 rounded accent-brand-600 disabled:opacity-40"
          />
        </label>

        <label className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">승인 필수</p>
            <p className="text-xs text-gray-500 mt-0.5">높은 리스크 항목에 대해 사람의 승인이 필요합니다</p>
          </div>
          <input
            type="checkbox"
            disabled={!hasAdminRole}
            checked={effective.approvalRequired ?? false}
            onChange={(e) => field('approvalRequired', e.target.checked)}
            className="w-5 h-5 rounded accent-brand-600 disabled:opacity-40"
          />
        </label>

        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
            리스크 임계값
          </label>
          <p className="text-xs text-gray-500 mb-2">이 수준 이상의 리스크는 승인 요청을 트리거합니다</p>
          <select
            disabled={!hasAdminRole}
            value={effective.riskThreshold ?? 'HIGH'}
            onChange={(e) => field('riskThreshold', e.target.value)}
            className="w-48 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2 disabled:opacity-40"
          >
            <option value="CRITICAL">CRITICAL만</option>
            <option value="HIGH">HIGH 이상</option>
            <option value="MEDIUM">MEDIUM 이상</option>
          </select>
        </div>
      </div>

      {/* Notification Settings */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-6">
        <h2 className="font-semibold text-gray-900 dark:text-white">알림 설정</h2>

        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
            Slack 기본 채널
          </label>
          <input
            type="text"
            disabled={!hasAdminRole}
            placeholder="#agentops-alerts"
            value={effective.slackChannel ?? ''}
            onChange={(e) => field('slackChannel', e.target.value)}
            className="w-72 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2 disabled:opacity-40"
          />
        </div>
      </div>

      {/* General Settings */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-6">
        <h2 className="font-semibold text-gray-900 dark:text-white">일반 설정</h2>

        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
            시간대
          </label>
          <select
            disabled={!hasAdminRole}
            value={effective.timezone ?? 'Asia/Seoul'}
            onChange={(e) => field('timezone', e.target.value)}
            className="w-72 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2 disabled:opacity-40"
          >
            <option value="Asia/Seoul">Asia/Seoul (KST)</option>
            <option value="UTC">UTC</option>
            <option value="America/New_York">America/New_York (EST)</option>
            <option value="Europe/London">Europe/London (GMT)</option>
          </select>
        </div>

        {settings?.updatedAt && (
          <p className="text-xs text-gray-400">
            마지막 업데이트:{' '}
            {new Intl.DateTimeFormat('ko-KR', {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(settings.updatedAt))}
          </p>
        )}
      </div>

      {/* Integrations Section */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-5">
        <h2 className="font-semibold text-gray-900 dark:text-white">연동</h2>

        {/* GitHub */}
        <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <Github className="w-6 h-6 text-gray-700" />
            <div>
              <p className="text-sm font-medium text-gray-900">GitHub</p>
              {integrations?.github?.connected
                ? <p className="text-xs text-gray-500 mt-0.5">@{integrations.github.accountLogin} 연결됨</p>
                : <p className="text-xs text-gray-500 mt-0.5">GitHub App이 연결되지 않았습니다</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {integrations?.github?.connected
              ? <CheckCircle className="w-5 h-5 text-green-500" />
              : <XCircle className="w-5 h-5 text-gray-300" />}
            {!integrations?.github?.connected && integrations?.github?.installUrl && (
              <a
                href={integrations.github.installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                App 설치
              </a>
            )}
          </div>
        </div>

        {/* Slack */}
        <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <Slack className="w-6 h-6 text-purple-600" />
            <div>
              <p className="text-sm font-medium text-gray-900">Slack</p>
              {integrations?.slack?.connected
                ? <p className="text-xs text-gray-500 mt-0.5">{integrations.slack.teamName} 연결됨</p>
                : <p className="text-xs text-gray-500 mt-0.5">Slack 워크스페이스가 연결되지 않았습니다</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {integrations?.slack?.connected
              ? <CheckCircle className="w-5 h-5 text-green-500" />
              : <XCircle className="w-5 h-5 text-gray-300" />}
            {integrations?.slack?.connected ? (
              <button
                onClick={() => disconnectSlackMutation.mutate()}
                disabled={disconnectSlackMutation.isPending}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                연결 해제
              </button>
            ) : integrations?.slack?.connectUrl ? (
              <a
                href={integrations.slack.connectUrl}
                className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700"
              >
                Slack 연결
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {!hasAdminRole && (
        <p className="text-sm text-gray-400 text-center">
          설정을 변경하려면 관리자 이상의 권한이 필요합니다.
        </p>
      )}
    </div>
  );
}
