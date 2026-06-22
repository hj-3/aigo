import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { imApi } from '@/lib/im-api-client';
import { cn } from '@/lib/utils';
import { Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';

const TABS = ['계정 관리', '자동 조치 설정'] as const;
type Tab = typeof TABS[number];

// ─── Accounts Tab ─────────────────────────────────────────────────
interface LinkedAccount {
  readonly accountId: string;
  readonly alias: string;
  readonly crossAccountRoleArn: string;
  readonly isActive: boolean;
  readonly addedAt: string;
}

function AddAccountModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ accountId: '', alias: '', crossAccountRoleArn: '' });

  const create = useMutation({
    mutationFn: () => imApi.post('/accounts', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['im-accounts'] }); onClose(); },
  });

  const fields = [
    { key: 'accountId', label: 'AWS Account ID', placeholder: '123456789012' },
    { key: 'alias', label: '계정 별칭', placeholder: 'prod-account' },
    { key: 'crossAccountRoleArn', label: 'Cross-Account Role ARN', placeholder: 'arn:aws:iam::123456789012:role/aigo-im-cross-account' },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface border border-term rounded w-[480px] p-5 font-mono">
        <p className="text-xs font-bold text-term mb-4"><span className="text-accent">›</span> 계정 추가</p>
        {fields.map(({ key, label, placeholder }) => (
          <div key={key} className="mb-3">
            <label className="block text-[10px] text-term-secondary mb-1">{label}</label>
            <input
              className="w-full bg-canvas border border-term rounded px-2.5 py-1.5 text-xs text-term font-mono focus:outline-none focus:border-accent"
              placeholder={placeholder}
              value={(form as Record<string, string>)[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            />
          </div>
        ))}
        <p className="text-[10px] text-term-secondary mb-4 leading-relaxed">
          대상 계정에 <span className="text-accent">aigo-im-cross-account</span> IAM Role을 생성하고<br />
          Trust Principal에 이 계정의 action-executor Role을 추가해야 합니다.
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-mono text-term-secondary border border-term rounded hover:bg-white/5">취소</button>
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending}
            className="px-3 py-1.5 text-xs font-mono text-accent border border-accent rounded hover:bg-accent/10 disabled:opacity-50"
          >
            {create.isPending ? '추가 중...' : '계정 추가'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountsTab() {
  const [showModal, setShowModal] = useState(false);
  const qc = useQueryClient();

  const { data: accounts, isLoading } = useQuery<LinkedAccount[]>({
    queryKey: ['im-accounts'],
    queryFn: () => imApi.get<{ items: LinkedAccount[] }>('/accounts').then((r) => r.items),
  });

  const deleteAccount = useMutation({
    mutationFn: (id: string) => imApi.delete(`/accounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['im-accounts'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] text-term-secondary">
          등록된 Linked Account의 인시던트도 조사·조치합니다.
        </p>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-accent border border-accent rounded hover:bg-accent/10"
        >
          <Plus className="w-3.5 h-3.5" /> 계정 추가
        </button>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-6 font-mono text-xs text-term-secondary animate-pulse">$ fetching accounts...</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-term bg-canvas/50">
                {['Account ID', '별칭', 'Role ARN', '상태', '추가일', ''].map((h) => (
                  <th key={h} className="text-left font-mono text-[10px] text-term-secondary uppercase tracking-wider px-4 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(accounts ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center font-mono text-xs text-term-secondary">
                    등록된 Linked Account가 없습니다.
                  </td>
                </tr>
              )}
              {(accounts ?? []).map((acc) => (
                <tr key={acc.accountId} className="border-b border-term/30 hover:bg-white/3 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs text-accent">{acc.accountId}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-term">{acc.alias}</td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-term-secondary max-w-[240px] truncate">{acc.crossAccountRoleArn}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn('font-mono text-[10px] px-1.5 py-0.5 rounded', acc.isActive ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400')}>
                      {acc.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-term-secondary">
                    {new Date(acc.addedAt).toLocaleDateString('ko-KR')}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => deleteAccount.mutate(acc.accountId)} className="text-term-secondary/40 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {showModal && <AddAccountModal onClose={() => setShowModal(false)} />}
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────
interface RemediationSettings {
  readonly mode: 'ALLOWLIST' | 'ALL';
}

interface AllowedAction {
  readonly actionId: string;
  readonly service: string;
  readonly operation: string;
  readonly description: string;
  readonly riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly isEnabled: boolean;
}

function SettingsTab() {
  const qc = useQueryClient();

  const { data: settings } = useQuery<RemediationSettings>({
    queryKey: ['im-settings'],
    queryFn: () => imApi.get<RemediationSettings>('/settings'),
  });

  const { data: actions, isLoading: actionsLoading } = useQuery<AllowedAction[]>({
    queryKey: ['im-allowed-actions'],
    queryFn: () => imApi.get<{ items: AllowedAction[] }>('/settings/allowed-actions').then((r) => r.items),
  });

  const updateSettings = useMutation({
    mutationFn: (mode: 'ALLOWLIST' | 'ALL') => imApi.patch('/settings', { mode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['im-settings'] }),
  });

  const toggleAction = useMutation({
    mutationFn: ({ actionId, isEnabled }: { actionId: string; isEnabled: boolean }) =>
      imApi.patch(`/settings/allowed-actions/${actionId}`, { isEnabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['im-allowed-actions'] }),
  });

  const RISK_COLORS: Record<string, string> = {
    LOW: 'bg-green-500/10 text-green-400',
    MEDIUM: 'bg-yellow-500/10 text-yellow-400',
    HIGH: 'bg-red-500/10 text-red-400',
  };

  return (
    <div className="space-y-6">
      {/* Mode selector */}
      <div>
        <p className="font-mono text-[10px] text-term-secondary uppercase tracking-wider mb-3">Remediation 모드</p>
        <div className="grid grid-cols-2 gap-3">
          {(['ALLOWLIST', 'ALL'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => updateSettings.mutate(mode)}
              className={cn(
                'card p-4 text-left transition-colors border-2',
                settings?.mode === mode ? 'border-accent' : 'border-transparent',
              )}
            >
              <p className={cn('font-mono text-xs font-bold mb-1.5', settings?.mode === mode ? 'text-accent' : 'text-term')}>
                {mode === 'ALLOWLIST' ? 'AllowList 모드' : 'All 모드'}
              </p>
              <p className="font-mono text-[10px] text-term-secondary leading-relaxed">
                {mode === 'ALLOWLIST'
                  ? '하단 허용 액션 중 Enable된 것만 실행 가능. 안전하고 예측 가능한 범위로 제한.'
                  : '등록 여부 관계없이 모든 AWS API 액션 실행 가능. 최대 유연성, 고위험.'}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* AllowList */}
      <div>
        <p className="font-mono text-[10px] text-term-secondary uppercase tracking-wider mb-3">
          허용 액션 목록
          {settings?.mode === 'ALL' && (
            <span className="ml-2 text-yellow-400">(All 모드 — AllowList 무시됨)</span>
          )}
        </p>
        <div className="card overflow-hidden">
          {actionsLoading ? (
            <div className="p-6 font-mono text-xs text-term-secondary animate-pulse">$ loading allowed actions...</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-term bg-canvas/50">
                  {['서비스', '오퍼레이션', '설명', '위험도', '활성'].map((h) => (
                    <th key={h} className="text-left font-mono text-[10px] text-term-secondary uppercase tracking-wider px-4 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(actions ?? []).map((action) => (
                  <tr key={action.actionId} className="border-b border-term/30 hover:bg-white/3 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-[11px] text-accent">{action.service}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-term">{action.operation}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-term-secondary max-w-[200px]">{action.description}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('font-mono text-[10px] px-1.5 py-0.5 rounded', RISK_COLORS[action.riskLevel])}>
                        {action.riskLevel}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => toggleAction.mutate({ actionId: action.actionId, isEnabled: !action.isEnabled })}
                        disabled={settings?.mode === 'ALL'}
                        className="disabled:opacity-40"
                      >
                        {action.isEnabled
                          ? <ToggleRight className="w-5 h-5 text-accent" />
                          : <ToggleLeft className="w-5 h-5 text-term-secondary" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ManagePage ───────────────────────────────────────────────────
export function IMManagePage() {
  const [tab, setTab] = useState<Tab>('계정 관리');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-mono text-base font-bold text-term flex items-center gap-2">
          <span className="text-accent">›</span> 관리
        </h1>
        <p className="font-mono text-[10px] text-term-secondary mt-0.5">$ im manage --admin</p>
      </div>

      <div className="flex gap-0 border-b border-term">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-xs font-mono border-b-2 transition-colors',
              tab === t ? 'border-accent text-accent' : 'border-transparent text-term-secondary hover:text-term',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === '계정 관리' && <AccountsTab />}
      {tab === '자동 조치 설정' && <SettingsTab />}
    </div>
  );
}
