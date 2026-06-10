import type { NotificationType } from '@aigo/types';

interface SlackTextObject {
  type: 'plain_text' | 'mrkdwn';
  text: string;
  emoji?: boolean;
}

interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

interface SlackResponse {
  ok: boolean;
  error?: string;
}

export async function sendSlackMessage(
  channel: string,
  blocks: SlackBlock[],
  text: string,
  botToken: string,
): Promise<void> {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({ channel, blocks, text }),
  });

  if (!response.ok) {
    throw new Error(`Slack API HTTP ${response.status}`);
  }

  const data = (await response.json()) as SlackResponse;
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error ?? 'unknown'}`);
  }
}

export function buildBlocks(type: NotificationType, p: Record<string, unknown>): SlackBlock[] {
  switch (type) {
    case 'ANALYSIS_COMPLETE':    return analysisCompleteBlocks(p);
    case 'HIGH_RISK_DETECTED':   return highRiskBlocks(p);
    case 'FIX_READY':            return fixReadyBlocks(p);
    case 'FIX_APPLIED':          return fixAppliedBlocks(p);
    case 'INCIDENT_DETECTED':    return incidentDetectedBlocks(p);
    case 'INCIDENT_RESOLVED':    return incidentResolvedBlocks(p);
    case 'APPROVAL_NEEDED':      return approvalNeededBlocks(p);
  }
}

// ── Block builders ────────────────────────────────────────────────────────────

function header(text: string): SlackBlock {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } as SlackTextObject };
}

function md(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } as SlackTextObject };
}

function divider(): SlackBlock {
  return { type: 'divider' };
}

function fields(items: Array<{ title: string; value: string }>): SlackBlock {
  return {
    type: 'section',
    fields: items.map(({ title, value }) => ({
      type: 'mrkdwn',
      text: `*${title}*\n${value}`,
    })),
  };
}

function linkButton(text: string, url: string): SlackBlock {
  return {
    type: 'actions',
    elements: [{ type: 'button', text: { type: 'plain_text', text }, url }],
  };
}

function riskBadge(riskLevel: unknown): string {
  switch (String(riskLevel ?? '').toUpperCase()) {
    case 'CRITICAL': return ':red_circle:';
    case 'HIGH':     return ':large_orange_circle:';
    case 'MEDIUM':   return ':large_yellow_circle:';
    default:         return ':large_green_circle:';
  }
}

// ── Per-type block definitions ────────────────────────────────────────────────

function analysisCompleteBlocks(p: Record<string, unknown>): SlackBlock[] {
  const blocks: SlackBlock[] = [
    header(':white_check_mark: 분석 완료'),
    divider(),
    fields([
      { title: '리스크 수준', value: `${riskBadge(p['riskLevel'])} ${p['riskLevel'] ?? '-'}` },
      { title: '발견 수',     value: String(p['findingsCount'] ?? 0) },
      { title: 'Job ID',      value: `\`${p['jobId'] ?? '-'}\`` },
      { title: '리포트 ID',   value: `\`${p['reportId'] ?? '-'}\`` },
    ]),
  ];
  if (p['prUrl']) blocks.push(linkButton('PR 보기', String(p['prUrl'])));
  return blocks;
}

function highRiskBlocks(p: Record<string, unknown>): SlackBlock[] {
  const blocks: SlackBlock[] = [
    header(':warning: 고위험 항목 감지'),
    divider(),
    md(`*${p['findingsCount'] ?? 0}건*의 고위험 항목이 발견되었습니다.`),
    fields([
      { title: '리스크 수준', value: `${riskBadge(p['riskLevel'])} ${p['riskLevel'] ?? '-'}` },
      {
        title: 'PR',
        value: p['prUrl']
          ? `<${p['prUrl']}|PR #${p['prNumber'] ?? ''}>`
          : String(p['prNumber'] ?? '-'),
      },
    ]),
  ];
  if (p['prUrl']) blocks.push(linkButton('리포트 보기', String(p['prUrl'])));
  return blocks;
}

function fixReadyBlocks(p: Record<string, unknown>): SlackBlock[] {
  const blocks: SlackBlock[] = [
    header(':wrench: 수정 패치 준비 완료'),
    divider(),
    fields([
      { title: 'Fix ID',  value: `\`${p['fixId'] ?? '-'}\`` },
      { title: '리포트', value: `\`${p['reportId'] ?? '-'}\`` },
    ]),
  ];
  if (p['patchSummary']) blocks.push(md(String(p['patchSummary'])));
  if (p['prUrl']) blocks.push(linkButton('PR에서 확인', String(p['prUrl'])));
  return blocks;
}

function fixAppliedBlocks(p: Record<string, unknown>): SlackBlock[] {
  const blocks: SlackBlock[] = [
    header(':white_check_mark: 수정 사항 적용 완료'),
    divider(),
    fields([
      { title: 'Fix ID',    value: `\`${p['fixId'] ?? '-'}\`` },
      { title: '적용 시각', value: String(p['appliedAt'] ?? new Date().toISOString()) },
    ]),
  ];
  if (p['prUrl']) blocks.push(linkButton('수정 PR 보기', String(p['prUrl'])));
  return blocks;
}

function incidentDetectedBlocks(p: Record<string, unknown>): SlackBlock[] {
  const affected = Array.isArray(p['affectedResources'])
    ? (p['affectedResources'] as string[]).join(', ')
    : String(p['affectedResources'] ?? '-');

  return [
    header(':rotating_light: 인시던트 감지'),
    divider(),
    md(`*${p['title'] ?? '알 수 없는 인시던트'}*`),
    fields([
      { title: '서비스',       value: String(p['serviceId'] ?? '-') },
      { title: '영향 리소스', value: affected },
    ]),
  ];
}

function incidentResolvedBlocks(p: Record<string, unknown>): SlackBlock[] {
  return [
    header(':large_green_circle: 인시던트 해결'),
    divider(),
    md(`*${p['title'] ?? '인시던트'}* 가 해결되었습니다.`),
    fields([
      { title: '서비스',      value: String(p['serviceId'] ?? '-') },
      { title: '해결 시각',  value: String(p['resolvedAt'] ?? new Date().toISOString()) },
    ]),
  ];
}

function approvalNeededBlocks(p: Record<string, unknown>): SlackBlock[] {
  const blocks: SlackBlock[] = [
    header(':bell: 승인 요청'),
    divider(),
    md(`리포트 \`${p['reportId'] ?? '-'}\` 에 대한 승인이 필요합니다.`),
    fields([
      { title: '리스크 수준', value: `${riskBadge(p['riskLevel'])} ${p['riskLevel'] ?? '-'}` },
      { title: '요청자',      value: String(p['requestedBy'] ?? '-') },
    ]),
  ];
  if (p['prUrl']) blocks.push(linkButton('승인하기', String(p['prUrl'])));
  return blocks;
}
