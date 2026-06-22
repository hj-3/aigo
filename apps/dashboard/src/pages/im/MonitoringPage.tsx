import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { imApi } from '@/lib/im-api-client';
import { Activity } from 'lucide-react';

interface MetricSummary {
  readonly service: string;
  readonly alarmName: string;
  readonly currentValue: number;
  readonly unit: string;
  readonly threshold: number;
  readonly state: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';
  readonly updatedAt: string;
}

const STATE_COLORS: Record<string, string> = {
  OK: 'text-green-400',
  ALARM: 'text-red-400',
  INSUFFICIENT_DATA: 'text-gray-400',
};

const STATE_BG: Record<string, string> = {
  OK: 'bg-green-500/10',
  ALARM: 'bg-red-500/10',
  INSUFFICIENT_DATA: 'bg-gray-500/10',
};

function MetricBar({ value, threshold, max }: { value: number; threshold: number; max: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const thresholdPct = Math.min((threshold / max) * 100, 100);
  const isAlarmed = value >= threshold;

  return (
    <div className="relative h-1.5 bg-canvas rounded-full overflow-visible w-24">
      <div
        className={`h-full rounded-full transition-all ${isAlarmed ? 'bg-red-400' : 'bg-green-400'}`}
        style={{ width: `${pct}%` }}
      />
      <div
        className="absolute top-0 bottom-0 w-px bg-yellow-400/60"
        style={{ left: `${thresholdPct}%` }}
      />
    </div>
  );
}

export function IMMonitoringPage() {
  const [filter, setFilter] = useState<'ALL' | 'ALARM' | 'OK'>('ALL');

  const { data: metrics, isLoading } = useQuery<MetricSummary[]>({
    queryKey: ['im-monitoring'],
    queryFn: () => imApi.get<{ items: MetricSummary[] }>('/monitoring').then((r) => r.items),
    refetchInterval: 60_000,
  });

  const filtered = (metrics ?? []).filter((m) => filter === 'ALL' || m.state === filter);
  const alarmCount = (metrics ?? []).filter((m) => m.state === 'ALARM').length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-base font-bold text-term flex items-center gap-2">
            <span className="text-accent">›</span> 모니터링
          </h1>
          <p className="font-mono text-[10px] text-term-secondary mt-0.5">$ im monitoring --targets=registered</p>
        </div>
        <div className="flex items-center gap-3">
          {alarmCount > 0 && (
            <div className="flex items-center gap-1.5 font-mono text-xs text-red-400">
              <Activity className="w-3.5 h-3.5 animate-pulse" />
              <span>{alarmCount} ALARM</span>
            </div>
          )}
          <div className="flex gap-1">
            {(['ALL', 'ALARM', 'OK'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 text-[10px] font-mono rounded border transition-colors ${
                  filter === f
                    ? 'border-accent text-accent bg-accent/10'
                    : 'border-term text-term-secondary hover:border-term-secondary'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 font-mono text-xs text-term-secondary py-8">
          <span className="animate-pulse text-yellow-400">⟳</span>
          <span>$ fetching metrics...</span>
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="card p-8 text-center font-mono text-xs text-term-secondary">
          {filter === 'ALL'
            ? '조사 대상으로 등록된 알람이 없습니다.'
            : `${filter} 상태인 알람이 없습니다.`}
        </div>
      )}

      <div className="grid gap-3">
        {filtered.map((m) => (
          <div key={`${m.service}-${m.alarmName}`} className="card px-4 py-3 flex items-center gap-4">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${m.state === 'ALARM' ? 'bg-red-400 animate-pulse' : m.state === 'OK' ? 'bg-green-400' : 'bg-gray-400'}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-mono text-xs font-bold text-accent">{m.service}</p>
                <p className="font-mono text-[11px] text-term truncate">{m.alarmName}</p>
              </div>
              <p className="font-mono text-[10px] text-term-secondary mt-0.5">
                임계값: {m.threshold} {m.unit} · 갱신: {new Date(m.updatedAt).toLocaleTimeString('ko-KR')}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <MetricBar value={m.currentValue} threshold={m.threshold} max={m.threshold * 1.5} />
              <div className="text-right w-20">
                <p className={`font-mono text-sm font-bold ${STATE_COLORS[m.state]}`}>
                  {m.currentValue.toFixed(1)}
                  <span className="text-[10px] font-normal text-term-secondary ml-0.5">{m.unit}</span>
                </p>
              </div>
              <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${STATE_BG[m.state]} ${STATE_COLORS[m.state]}`}>
                {m.state}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
