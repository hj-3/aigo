import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { imApi } from '@/lib/im-api-client';
import { cn } from '@/lib/utils';
import { Plus, Trash2, ExternalLink } from 'lucide-react';

interface AwsTarget {
  readonly targetId: string;
  readonly accountId: string;
  readonly serviceName: string;
  readonly alarmName: string;
  readonly region: string;
  readonly enabled: boolean;
  readonly createdAt: string;
}

interface Integration {
  readonly integrationId: string;
  readonly type: 'SLACK' | 'PAGERDUTY' | 'OPSGENIE' | 'WEBHOOK';
  readonly name: string;
  readonly webhookToken: string | null;
  readonly enabled: boolean;
  readonly createdAt: string;
}

const TABS = ['AWS 서비스', '외부 도구'] as const;
type Tab = typeof TABS[number];

function AlarmRegisterModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ accountId: '', serviceName: '', alarmName: '', region: 'ap-northeast-2' });

  const create = useMutation({
    mutationFn: () => imApi.post('/targets', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['im-targets'] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface border border-term rounded w-[440px] p-5 font-mono">
        <p className="text-xs font-bold text-term mb-4">
          <span className="text-accent">›</span> 알람 등록
        </p>
        {[
          { key: 'accountId', label: 'AWS Account ID', placeholder: '123456789012' },
          { key: 'serviceName', label: 'AWS 서비스', placeholder: 'EC2, RDS, ECS, Lambda ...' },
          { key: 'alarmName', label: 'CloudWatch 알람명', placeholder: 'prod-api-cpu-high' },
          { key: 'region', label: '리전', placeholder: 'ap-northeast-2' },
        ].map(({ key, label, placeholder }) => (
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
        <div className="flex gap-2 mt-4 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-mono text-term-secondary border border-term rounded hover:bg-white/5">
            취소
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending}
            className="px-3 py-1.5 text-xs font-mono text-accent border border-accent rounded hover:bg-accent/10 disabled:opacity-50"
          >
            {create.isPending ? '등록 중...' : '등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

function IntegrationModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ type: 'WEBHOOK' as 'SLACK' | 'PAGERDUTY' | 'OPSGENIE' | 'WEBHOOK', name: '' });

  const create = useMutation({
    mutationFn: () => imApi.post<{ webhookToken: string }>('/integrations', { ...form, config: {} }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['im-integrations'] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface border border-term rounded w-[400px] p-5 font-mono">
        <p className="text-xs font-bold text-term mb-4">
          <span className="text-accent">›</span> 연동 추가
        </p>
        <div className="mb-3">
          <label className="block text-[10px] text-term-secondary mb-1">도구 유형</label>
          <select
            className="w-full bg-canvas border border-term rounded px-2.5 py-1.5 text-xs text-term font-mono focus:outline-none focus:border-accent"
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as typeof form.type }))}
          >
            {(['SLACK', 'PAGERDUTY', 'OPSGENIE', 'WEBHOOK'] as const).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="mb-3">
          <label className="block text-[10px] text-term-secondary mb-1">연동 이름</label>
          <input
            className="w-full bg-canvas border border-term rounded px-2.5 py-1.5 text-xs text-term font-mono focus:outline-none focus:border-accent"
            placeholder="prod-zabbix"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div className="flex gap-2 mt-4 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-mono text-term-secondary border border-term rounded hover:bg-white/5">
            취소
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending}
            className="px-3 py-1.5 text-xs font-mono text-accent border border-accent rounded hover:bg-accent/10 disabled:opacity-50"
          >
            {create.isPending ? '추가 중...' : '연동 추가'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function IMTargetsPage() {
  const [tab, setTab] = useState<Tab>('AWS 서비스');
  const [showAlarmModal, setShowAlarmModal] = useState(false);
  const [showIntModal, setShowIntModal] = useState(false);
  const qc = useQueryClient();

  const { data: targets, isLoading: targetsLoading } = useQuery<AwsTarget[]>({
    queryKey: ['im-targets'],
    queryFn: () => imApi.get<{ items: AwsTarget[] }>('/targets').then((r) => r.items),
    enabled: tab === 'AWS 서비스',
  });

  const { data: integrations, isLoading: intsLoading } = useQuery<Integration[]>({
    queryKey: ['im-integrations'],
    queryFn: () => imApi.get<{ items: Integration[] }>('/integrations').then((r) => r.items),
    enabled: tab === '외부 도구',
  });

  const deleteTarget = useMutation({
    mutationFn: (id: string) => imApi.delete(`/targets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['im-targets'] }),
  });

  const deleteInt = useMutation({
    mutationFn: (id: string) => imApi.delete(`/integrations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['im-integrations'] }),
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-base font-bold text-term flex items-center gap-2">
            <span className="text-accent">›</span> 조사 대상 설정
          </h1>
          <p className="font-mono text-[10px] text-term-secondary mt-0.5">$ im targets --list</p>
        </div>
        <button
          onClick={() => tab === 'AWS 서비스' ? setShowAlarmModal(true) : setShowIntModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-accent border border-accent rounded hover:bg-accent/10 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {tab === 'AWS 서비스' ? '알람 등록' : '연동 추가'}
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-0 border-b border-term">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-xs font-mono border-b-2 transition-colors',
              tab === t
                ? 'border-accent text-accent'
                : 'border-transparent text-term-secondary hover:text-term',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* AWS 서비스 탭 */}
      {tab === 'AWS 서비스' && (
        <div className="card overflow-hidden">
          {targetsLoading ? (
            <div className="p-6 font-mono text-xs text-term-secondary animate-pulse">$ fetching targets...</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-term bg-canvas/50">
                  {['계정', '서비스', '알람명', '리전', '상태', ''].map((h) => (
                    <th key={h} className="text-left font-mono text-[10px] text-term-secondary uppercase tracking-wider px-4 py-2.5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(targets ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center font-mono text-xs text-term-secondary">
                      등록된 조사 대상이 없습니다. 알람 등록 버튼으로 추가하세요.
                    </td>
                  </tr>
                )}
                {(targets ?? []).map((t) => (
                  <tr key={t.targetId} className="border-b border-term/30 hover:bg-white/3 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-[11px] text-term-secondary">{t.accountId}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-accent">{t.serviceName}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-term">{t.alarmName}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-term-secondary">{t.region}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('font-mono text-[10px] px-1.5 py-0.5 rounded', t.enabled ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400')}>
                        {t.enabled ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => deleteTarget.mutate(t.targetId)}
                        className="text-term-secondary/40 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 외부 도구 탭 */}
      {tab === '외부 도구' && (
        <div className="card overflow-hidden">
          {intsLoading ? (
            <div className="p-6 font-mono text-xs text-term-secondary animate-pulse">$ fetching integrations...</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-term bg-canvas/50">
                  {['이름', '유형', 'Webhook Token', '상태', ''].map((h) => (
                    <th key={h} className="text-left font-mono text-[10px] text-term-secondary uppercase tracking-wider px-4 py-2.5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(integrations ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center font-mono text-xs text-term-secondary">
                      연동된 외부 도구가 없습니다. 연동 추가 버튼으로 Webhook Token을 발급하세요.
                    </td>
                  </tr>
                )}
                {(integrations ?? []).map((i) => (
                  <tr key={i.integrationId} className="border-b border-term/30 hover:bg-white/3 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-xs text-term">{i.name}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                        {i.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-term-secondary max-w-xs truncate">
                      <span className="font-mono text-[10px]">{i.webhookToken ?? '—'}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn('font-mono text-[10px] px-1.5 py-0.5 rounded', i.enabled ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400')}>
                        {i.enabled ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right flex items-center gap-2 justify-end">
                      <button
                        onClick={() => i.webhookToken && navigator.clipboard.writeText(i.webhookToken)}
                        className="text-term-secondary/40 hover:text-accent transition-colors"
                        title="Token 복사"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteInt.mutate(i.integrationId)}
                        className="text-term-secondary/40 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showAlarmModal && <AlarmRegisterModal onClose={() => setShowAlarmModal(false)} />}
      {showIntModal && <IntegrationModal onClose={() => setShowIntModal(false)} />}
    </div>
  );
}
