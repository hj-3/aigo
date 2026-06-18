import { cn } from '@/lib/utils';

export type AgentStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

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

// Layout constants (px)
const NODE_W   = 80;  // w-20
const NODE_H   = 80;  // h-20
const P_GAP    = 28;  // gap between persona boxes
const V_STEM   = 40;  // orch bottom → horizontal spine
const V_BRANCH = 20;  // spine → persona box top

const STATUS_RING: Record<AgentStatus, string> = {
  pending: 'border-2 border-dashed border-gray-600/30',
  running: 'border-2 border-yellow-400/80 shadow-[0_0_16px_rgba(250,204,21,0.40)]',
  done:    'border-2 border-green-500/60 shadow-[0_0_12px_rgba(74,222,128,0.22)]',
  failed:  'border-2 border-red-500/60 shadow-[0_0_12px_rgba(248,113,113,0.22)]',
  skipped: 'border-2 border-dashed border-gray-700/20',
};

const STATUS_TEXT: Record<AgentStatus, string> = {
  pending: 'text-gray-500/40',
  running: 'text-yellow-400',
  done:    'text-green-400',
  failed:  'text-red-400',
  skipped: 'text-gray-600/30',
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  pending: 'QUEUED',
  running: 'RUNNING',
  done:    'DONE',
  failed:  'FAILED',
  skipped: 'SKIP',
};

function lineRgba(s: AgentStatus): string {
  if (s === 'done')    return 'rgba(34,197,94,0.55)';
  if (s === 'running') return 'rgba(250,204,21,0.65)';
  if (s === 'failed')  return 'rgba(239,68,68,0.45)';
  return 'rgba(75,85,99,0.22)';
}

/** Arrowhead pointing right */
function ArrowR({ status }: { status: AgentStatus }) {
  return (
    <div
      className="flex-shrink-0 transition-colors duration-700"
      style={{
        width: 0, height: 0,
        borderTop: '5px solid transparent',
        borderBottom: '5px solid transparent',
        borderLeft: `8px solid ${lineRgba(status)}`,
      }}
    />
  );
}

/** Horizontal arrow: flex-1 line + arrowhead */
function HArrow({ status }: { status: AgentStatus }) {
  const isPending = status === 'pending';
  const isRunning = status === 'running';
  return (
    <div className="flex items-center flex-1 min-w-[40px]">
      <div
        className={cn(
          'flex-1 transition-all duration-700',
          isPending ? 'border-t-[3px] border-dashed border-gray-600/25' :
          isRunning ? 'border-t-[3px] border-yellow-400/65 animate-pulse'  :
          status === 'done'   ? 'border-t-[3px] border-green-500/55' :
                                'border-t-[3px] border-red-500/45',
        )}
      />
      <ArrowR status={status} />
    </div>
  );
}

/**
 * NodeBox — fixed w-20 h-20 box with:
 * - icon + short name INSIDE the box
 * - status info (duration / "처리 중") absolutely below (z-10, doesn't affect flex layout)
 */
function NodeBox({ node, compact }: { node: AgentNode; compact?: boolean }) {
  const boxSize = compact ? 'w-14 h-14' : 'w-20 h-20';
  const isSkip  = node.status === 'skipped';

  // Short name shown inside the box (first word of label)
  const shortName = node.label.split(' ')[0];

  return (
    <div className={cn('relative flex-shrink-0 flex flex-col items-center', isSkip && 'opacity-25')}>
      <div className={cn(
        'flex flex-col items-center justify-center rounded-xl bg-surface transition-all duration-500',
        boxSize, STATUS_RING[node.status],
      )}>
        <span className={compact ? 'text-xl' : 'text-2xl'}>{node.icon}</span>
        {!compact && (
          <span className={cn(
            'text-[9px] font-mono font-semibold tracking-wide mt-1 leading-tight text-center px-1',
            STATUS_TEXT[node.status],
          )}>
            {shortName}
          </span>
        )}
      </div>

      {/* Status info below box (absolute — doesn't affect layout height) */}
      {!compact && (
        <div
          className="absolute left-1/2 -translate-x-1/2 text-center pointer-events-none z-10"
          style={{ top: NODE_H + 5, width: 88 }}
        >
          {node.status === 'running' && (
            <p className="text-[9px] text-yellow-400/80 animate-pulse font-mono">처리 중...</p>
          )}
          {node.durationMs != null && node.status === 'done' && (
            <p className="text-[9px] text-green-400/60 font-mono">{(node.durationMs / 1000).toFixed(1)}s</p>
          )}
          {node.status === 'failed' && (
            <p className="text-[9px] text-red-400/70 font-mono">실패</p>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentPipeline({ nodes, compact = false }: Props) {
  const githubNode = nodes[0];
  const orchNode   = nodes[1];
  const subNodes   = nodes.slice(2, nodes.length - 1);
  const outputNode = nodes[nodes.length - 1];

  if (!githubNode || !orchNode || !outputNode) return null;

  const anyRunning  = subNodes.some((n) => n.status === 'running');
  const anyFailed   = subNodes.some((n) => n.status === 'failed');
  const activeSubs  = subNodes.filter((n) => n.status !== 'skipped');
  const allSubsDone = activeSubs.length > 0 && activeSubs.every((n) => n.status === 'done');

  const fanStatus: AgentStatus =
    anyFailed ? 'failed' : allSubsDone ? 'done' : anyRunning ? 'running' : 'pending';

  // GitHub → Orch: green once orch has started
  const toOrchStatus: AgentStatus = orchNode.status === 'pending' ? 'pending' : 'done';

  // Orch → Slack: yellow pulse when analysis done but output not yet done
  const toSlackStatus: AgentStatus =
    outputNode.status === 'done'    ? 'done'    :
    outputNode.status === 'running' ? 'running' :
    fanStatus === 'done'            ? 'running' : 'pending';

  // Stem/spine color
  const stemStatus: AgentStatus = (anyRunning || allSubsDone || anyFailed) ? fanStatus : 'pending';

  // ── Compact badge chain ───────────────────────────────────────────────────
  if (compact) {
    const visibleNodes = [githubNode, orchNode, ...activeSubs, outputNode];
    return (
      <div className="flex flex-wrap items-center gap-1">
        {visibleNodes.map((node, i) => (
          <div key={node.id} className="flex items-center gap-1">
            {i > 0 && (
              <div className={cn(
                'w-2.5 h-px transition-all duration-500',
                node.status === 'done'    ? 'bg-green-500/50'  :
                node.status === 'running' ? 'bg-yellow-400/60' :
                node.status === 'failed'  ? 'bg-red-500/40'    : 'bg-gray-600/20',
              )} />
            )}
            <div className={cn(
              'flex items-center gap-1 px-1.5 py-0.5 rounded border transition-all duration-300',
              node.status === 'running' ? 'border-yellow-400/60 bg-yellow-400/8 shadow-[0_0_8px_rgba(250,204,21,0.2)]' :
              node.status === 'done'    ? 'border-green-500/40 bg-green-500/5'  :
              node.status === 'failed'  ? 'border-red-500/40   bg-red-500/5'    :
                                         'border-gray-600/20',
            )}>
              <span className="text-[10px]">{node.icon}</span>
              <span className={cn('font-mono text-[9px] font-medium', STATUS_TEXT[node.status])}>
                {node.label.split(' ')[0]}
              </span>
              {node.status === 'running' && (
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse flex-shrink-0" />
              )}
              {node.status === 'done' && (
                <span className="text-[8px] text-green-400 font-bold">✓</span>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Full view ─────────────────────────────────────────────────────────────
  const n = subNodes.length;
  // Total width of persona row
  const personaRowW = n > 0 ? n * NODE_W + (n - 1) * P_GAP : 0;

  return (
    <div className="w-full overflow-x-auto">
      {/*
        min-w-[640px] ensures arrows have room.
        pb-[200px] gives clearance for absolutely-positioned persona fan labels.
      */}
      <div className="flex flex-col min-w-[640px] w-full pb-[200px]">

        {/* Legend */}
        <div className="flex items-center gap-4 mb-6 text-[10px] font-mono text-term-secondary">
          {(['done', 'running', 'pending', 'failed'] as AgentStatus[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={cn('w-2 h-2 rounded-full',
                s === 'done'    ? 'bg-green-400'                :
                s === 'running' ? 'bg-yellow-400 animate-pulse' :
                s === 'failed'  ? 'bg-red-400'                  : 'bg-gray-500/30',
              )} />
              {STATUS_LABEL[s]}
            </span>
          ))}
        </div>

        {/*
          Main row: GitHub [arrow] Orch [arrow] Slack

          Orch wrapper is relative + fixed width (NODE_W), so:
          - Arrows get flex-1 space and actually reach the boxes
          - Persona fan hangs via absolute, doesn't affect the flex layout
        */}
        <div className="flex items-center">

          {/* GitHub */}
          <NodeBox node={githubNode} />

          {/* GitHub → Orch arrow */}
          <HArrow status={toOrchStatus} />

          {/* Orchestrator + absolute persona fan */}
          <div className="relative flex-shrink-0" style={{ width: NODE_W, height: NODE_H }}>
            <NodeBox node={orchNode} />

            {n > 0 && (
              /*
                Persona fan: centered under orch box using translateX(-50%).
                `position: absolute` so it doesn't affect the main row flex.
                Parent containers must not have overflow:hidden.
              */
              <div
                style={{
                  position: 'absolute',
                  top: NODE_H,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: personaRowW,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                }}
              >
                {/* Vertical stem: orch bottom → spine */}
                <div
                  className="transition-all duration-700 flex-shrink-0"
                  style={{ width: 3, height: V_STEM, background: lineRgba(stemStatus) }}
                />

                {/* Horizontal spine + persona columns */}
                <div className="relative flex-shrink-0" style={{ width: personaRowW }}>

                  {/* Spine: first persona center → last persona center */}
                  {n > 1 && (
                    <div
                      className="absolute transition-all duration-700"
                      style={{
                        top: 0,
                        left: NODE_W / 2,
                        width: (n - 1) * (NODE_W + P_GAP),
                        height: 3,
                        background: lineRgba(fanStatus),
                      }}
                    />
                  )}

                  {/* Persona columns */}
                  <div className="flex" style={{ gap: P_GAP }}>
                    {subNodes.map((sub) => {
                      const isSkip  = sub.status === 'skipped';
                      const bStatus = isSkip ? 'pending' : sub.status;
                      return (
                        <div
                          key={sub.id}
                          className={cn(
                            'flex flex-col items-center flex-shrink-0',
                            isSkip && 'opacity-25',
                          )}
                        >
                          {/* Branch: spine → persona */}
                          <div
                            className="transition-all duration-700"
                            style={{ width: 3, height: V_BRANCH, background: lineRgba(bStatus) }}
                          />
                          <NodeBox node={sub} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Orch → Slack arrow */}
          <HArrow status={toSlackStatus} />

          {/* Slack */}
          <NodeBox node={outputNode} />
        </div>

        {/* Running indicator */}
        {nodes.some((nd) => nd.status === 'running') && (
          <div
            className="mt-4 px-3 py-2 rounded border border-yellow-400/30 bg-yellow-400/5 font-mono text-xs text-yellow-400 flex items-center gap-2"
            style={{ marginTop: V_STEM + V_BRANCH + NODE_H + 60 }}
          >
            <span className="animate-pulse">⚡</span>
            <span>
              {nodes.filter((nd) => nd.status === 'running').map((nd) => `${nd.icon} ${nd.label.split(' ')[0]}`).join(' · ')}{' '}
              실행 중...
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Build pipeline nodes from agentRuns API data.
 */
export function buildPipelineNodes(
  agentRuns: Array<{ agentType: string; status: string; durationMs?: number; errorMessage?: string }>,
  jobStatus: string,
): AgentNode[] {
  const isJobDone   = jobStatus === 'COMPLETED';
  const isJobFailed = jobStatus === 'FAILED';
  const isFinished  = isJobDone || isJobFailed;

  function runFor(keyword: string) {
    return agentRuns.find((r) => r.agentType.toLowerCase().includes(keyword));
  }

  function statusOf(run: typeof agentRuns[number] | undefined): AgentStatus {
    if (run) {
      if (run.status === 'COMPLETED') return 'done';
      if (run.status === 'RUNNING')   return 'running';
      if (run.status === 'FAILED')    return 'failed';
      return 'pending';
    }
    return isFinished ? 'skipped' : 'pending';
  }

  // Orchestrator status is driven by job status — there's no dedicated orch AgentRun record.
  // Personas write their AgentRun records via save_findings, so agentRuns contains only persona entries.
  const orchStatus: AgentStatus =
    isJobDone   ? 'done'    :
    isJobFailed ? 'failed'  :
    (jobStatus === 'RUNNING' || jobStatus === 'IN_PROGRESS' || agentRuns.length > 0) ? 'running' : 'pending';

  const ghStatus: AgentStatus = orchStatus === 'pending' ? 'pending' : 'done';

  const outputStatus: AgentStatus =
    isJobDone   ? 'done'   :
    isJobFailed ? 'failed' : 'pending';

  function makeSubNode(id: string, label: string, icon: string): AgentNode {
    const run = runFor(id);
    return {
      id, label, icon,
      status: statusOf(run),
      ...(run?.durationMs != null ? { durationMs: run.durationMs } : {}),
      ...(run?.errorMessage        ? { errorMessage: run.errorMessage } : {}),
    };
  }

  return [
    { id: 'github',       label: 'GitHub',        icon: '🔔', status: ghStatus },
    { id: 'orchestrator', label: 'Orchestrator',  icon: '🧠', status: orchStatus },
    makeSubNode('code',     'Code',     '📝'),
    makeSubNode('infra',    'Infra',    '⚙️'),
    makeSubNode('security', 'Security', '🔒'),
    makeSubNode('risk',     'Risk',     '⚠️'),
    { id: 'output', label: 'Slack', icon: '📣', status: outputStatus },
  ];
}
