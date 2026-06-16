import { cn } from '@/lib/utils';

export type AgentStatus = 'pending' | 'running' | 'done' | 'failed';

export interface AgentNode {
  id: string;
  label: string;
  sublabel?: string;
  icon: string;
  status: AgentStatus;
  durationMs?: number;
  errorMessage?: string;
}

interface Props {
  nodes: AgentNode[];
  compact?: boolean;
}

const STATUS_RING: Record<AgentStatus, string> = {
  pending: 'border-2 border-dashed opacity-35',
  running: 'border-2 border-dashed border-yellow-400 dark:border-yellow-400 shadow-[0_0_14px_rgba(250,204,21,0.35)] pipeline-node-running',
  done:    'border-2 border-green-500 dark:border-green-400 shadow-[0_0_10px_rgba(74,222,128,0.25)]',
  failed:  'border-2 border-red-500 dark:border-red-400 shadow-[0_0_10px_rgba(248,113,113,0.25)]',
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  pending: 'QUEUED',
  running: 'RUNNING',
  done:    'DONE',
  failed:  'FAILED',
};

const STATUS_TEXT: Record<AgentStatus, string> = {
  pending: 'text-gray-400/50',
  running: 'text-yellow-400',
  done:    'text-green-400 dark:text-green-400',
  failed:  'text-red-400',
};

function connectorClass(status: AgentStatus): string {
  if (status === 'done') return 'border-green-500/60';
  if (status === 'running') return 'border-yellow-400/60';
  return 'border-gray-600/30 border-dashed';
}

function Connector({ status }: { status: AgentStatus }) {
  return (
    <div className={cn('flex-1 h-px border-t-2 mx-1 self-center transition-all duration-700', connectorClass(status))} />
  );
}

function NodeBox({ node, compact }: { node: AgentNode; compact?: boolean }) {
  const size = compact ? 'w-16 h-16' : 'w-20 h-20';
  return (
    <div className="flex flex-col items-center gap-1.5 min-w-0">
      <div
        className={cn(
          'flex flex-col items-center justify-center rounded-xl bg-surface transition-all duration-500',
          size,
          STATUS_RING[node.status],
        )}
      >
        <span className={compact ? 'text-xl' : 'text-2xl'}>{node.icon}</span>
        {!compact && (
          <span className={cn('text-[9px] font-mono font-bold tracking-widest mt-0.5', STATUS_TEXT[node.status])}>
            {STATUS_LABEL[node.status]}
          </span>
        )}
      </div>

      <div className="text-center">
        <p className={cn('font-mono text-xs font-medium leading-tight', STATUS_TEXT[node.status])}>
          {node.label}
        </p>
        {node.sublabel && !compact && (
          <p className="text-[10px] text-term-secondary mt-0.5">{node.sublabel}</p>
        )}
        {node.durationMs != null && node.status === 'done' && !compact && (
          <p className="text-[10px] text-green-400/70 mt-0.5">{(node.durationMs / 1000).toFixed(1)}s</p>
        )}
        {node.status === 'running' && !compact && (
          <p className="text-[10px] text-yellow-400/80 mt-0.5 animate-pulse">처리 중...</p>
        )}
      </div>
    </div>
  );
}

export function AgentPipeline({ nodes, compact = false }: Props) {
  const githubNode = nodes[0];
  const orchNode = nodes[1];
  const subNodes = nodes.slice(2, nodes.length - 1);
  const outputNode = nodes[nodes.length - 1];

  if (!githubNode || !orchNode || !outputNode) return null;

  const allSubDone = subNodes.every((n) => n.status === 'done');
  const anySubRunning = subNodes.some((n) => n.status === 'running');
  const preOutputStatus: AgentStatus = allSubDone ? 'done' : anySubRunning ? 'running' : 'pending';

  return (
    <div className="w-full overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Legend */}
        {!compact && (
          <div className="flex items-center gap-4 mb-4 text-[11px] font-mono text-term-secondary">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />DONE
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse inline-block" />RUNNING
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-gray-400/30 inline-block" />QUEUED
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />FAILED
            </span>
          </div>
        )}

        {/* Pipeline row */}
        <div className="flex items-center gap-0">
          {/* GitHub (source) */}
          <NodeBox node={githubNode} compact={compact} />

          <Connector status={githubNode.status === 'done' ? 'done' : githubNode.status} />

          {/* Orchestrator */}
          <NodeBox node={orchNode} compact={compact} />

          {/* Fan-out to sub-agents */}
          <div className="flex flex-col items-end self-center mx-0.5">
            {subNodes.map((n, i) => {
              const cs: AgentStatus = n.status === 'pending' ? 'pending' : n.status;
              return (
                <div
                  key={n.id}
                  className={cn(
                    'h-px w-5 border-t-2 transition-all duration-700',
                    connectorClass(cs),
                    i > 0 ? (compact ? 'mt-11' : 'mt-14') : '',
                  )}
                />
              );
            })}
          </div>

          {/* Sub-agents vertical stack */}
          <div className="flex flex-col gap-1">
            {subNodes.map((n) => (
              <NodeBox key={n.id} node={n} compact={compact} />
            ))}
          </div>

          {/* Fan-in */}
          <div className="flex flex-col items-start self-center mx-0.5">
            {subNodes.map((n, i) => {
              const cs: AgentStatus = allSubDone ? 'done' : n.status === 'done' ? 'done' : 'pending';
              return (
                <div
                  key={n.id}
                  className={cn(
                    'h-px w-5 border-t-2 transition-all duration-700',
                    connectorClass(cs),
                    i > 0 ? (compact ? 'mt-11' : 'mt-14') : '',
                  )}
                />
              );
            })}
          </div>

          <Connector status={preOutputStatus} />

          {/* Output: PR comment + Slack */}
          <NodeBox node={outputNode} compact={compact} />
        </div>

        {/* Running agent highlight */}
        {!compact && (() => {
          const running = nodes.filter((n) => n.status === 'running');
          if (!running.length) return null;
          return (
            <div className="mt-4 px-3 py-2.5 rounded border border-yellow-400/30 bg-yellow-400/5 font-mono text-xs text-yellow-400 flex items-center gap-2">
              <span className="animate-pulse">⚡</span>
              <span>{running.map((n) => n.label).join(', ')} 실행 중...</span>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

/** Build pipeline nodes from agentRuns API data */
export function buildPipelineNodes(
  agentRuns: Array<{ agentType: string; status: string; durationMs?: number; errorMessage?: string }>,
  jobStatus: string,
): AgentNode[] {
  function runFor(key: string) {
    return agentRuns.find((r) => r.agentType.toLowerCase().includes(key));
  }

  function statusOf(run: typeof agentRuns[number] | undefined, fallback: AgentStatus): AgentStatus {
    if (!run) return fallback;
    if (run.status === 'COMPLETED') return 'done';
    if (run.status === 'RUNNING') return 'running';
    if (run.status === 'FAILED') return 'failed';
    return 'pending';
  }

  const orchRun = agentRuns.find(
    (r) => r.agentType.toLowerCase().includes('orchestrat') || r.agentType.toLowerCase() === 'pr_analysis',
  );
  const orchStatus: AgentStatus =
    orchRun?.status === 'COMPLETED' ? 'done' :
    orchRun?.status === 'RUNNING' ? 'running' :
    orchRun?.status === 'FAILED' ? 'failed' :
    agentRuns.length > 0 ? 'running' : 'pending';

  const ghStatus: AgentStatus = orchStatus === 'pending' ? 'pending' : 'done';

  const outputStatus: AgentStatus =
    jobStatus === 'COMPLETED' ? 'done' :
    jobStatus === 'FAILED' ? 'failed' :
    agentRuns.every((r) => r.status === 'COMPLETED') ? 'running' : 'pending';

  function makeSubNode(id: string, label: string, sublabel: string, icon: string): AgentNode {
    const run = runFor(id);
    const status = statusOf(run, jobStatus === 'COMPLETED' ? 'done' : 'pending');
    const base = { id, label, sublabel, icon, status };
    return run?.durationMs != null
      ? { ...base, durationMs: run.durationMs }
      : base;
  }

  const orchNode: AgentNode = orchRun?.durationMs != null
    ? { id: 'orchestrator', label: 'Orchestrator', sublabel: 'Strands agent', icon: '🧠', status: orchStatus, durationMs: orchRun.durationMs }
    : { id: 'orchestrator', label: 'Orchestrator', sublabel: 'Strands agent', icon: '🧠', status: orchStatus };

  return [
    { id: 'github', label: 'GitHub PR', sublabel: 'webhook trigger', icon: '🔔', status: ghStatus },
    orchNode,
    makeSubNode('code',     'Code',     '코드 품질',     '📝'),
    makeSubNode('security', 'Security', '보안 취약점',   '🔒'),
    makeSubNode('infra',    'Infra',    '인프라 변경',   '⚙️'),
    makeSubNode('docs',     'Docs',     '문서 변경',     '📚'),
    makeSubNode('test',     'Test',     '테스트 커버리지', '🧪'),
    { id: 'output', label: 'PR+Slack', sublabel: '결과 전달', icon: '📣', status: outputStatus },
  ];
}
