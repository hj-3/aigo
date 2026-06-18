import { createSign } from 'node:crypto';
import type { NotificationType } from '@aigo/types';
import type { GithubAppCredentials } from './handler.js';

interface InstallationTokenResponse {
  readonly token: string;
  readonly expires_at: string;
}

// Creates a signed GitHub App JWT (RS256, 10-minute window)
function createAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({ iss: appId, iat: now - 60, exp: now + 9 * 60 }),
  ).toString('base64url');
  const data = `${headerB64}.${payloadB64}`;
  const signer = createSign('RSA-SHA256');
  signer.update(data);
  const sig = signer.sign(privateKey, 'base64url');
  return `${data}.${sig}`;
}

async function getInstallationToken(credentials: GithubAppCredentials): Promise<string> {
  const jwt = createAppJwt(credentials.appId, credentials.privateKey);

  const response = await fetch(
    `https://api.github.com/app/installations/${credentials.installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'AgentOps-NotificationWorker',
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub App token request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as InstallationTokenResponse;
  return data.token;
}

function parsePrUrl(prUrl: string): { owner: string; repo: string; prNumber: number } {
  const match = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl);
  if (!match || !match[1] || !match[2] || !match[3]) {
    throw new Error(`Cannot parse GitHub PR URL: ${prUrl}`);
  }
  return { owner: match[1], repo: match[2], prNumber: Number(match[3]) };
}

/** Create a formal GitHub PR review (APPROVE or REQUEST_CHANGES) */
export async function createPrReview(
  prUrl: string,
  event: 'APPROVE' | 'REQUEST_CHANGES',
  body: string,
  credentials: GithubAppCredentials,
  installationId?: string,
): Promise<void> {
  const { owner, repo, prNumber } = parsePrUrl(prUrl);
  const creds = installationId ? { ...credentials, installationId } : credentials;
  const token = await getInstallationToken(creds);

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'AgentOps-NotificationWorker',
      },
      body: JSON.stringify({ event, body }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub PR review failed (${response.status}): ${text}`);
  }
}

/** Merge a PR via the GitHub API (squash merge) */
export async function mergePr(
  prUrl: string,
  credentials: GithubAppCredentials,
  installationId?: string,
): Promise<void> {
  const { owner, repo, prNumber } = parsePrUrl(prUrl);
  const creds = installationId ? { ...credentials, installationId } : credentials;
  const token = await getInstallationToken(creds);

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'AgentOps-NotificationWorker',
      },
      body: JSON.stringify({
        commit_title: `Approved and merged by AgentOps`,
        commit_message: 'Approved via AgentOps dashboard or Slack /approve command.',
        merge_method: 'merge',
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    // 405 = not mergeable (branch protection, open reviews, conflicts) — log, don't throw
    if (response.status === 405 || response.status === 422) {
      console.warn(`[notification-worker] PR not mergeable (${response.status}): ${text}`);
      return;
    }
    throw new Error(`GitHub PR merge failed (${response.status}): ${text}`);
  }
}

/** Close a PR (used when reviewer rejects — prevents re-merging without a new review) */
export async function closePr(
  prUrl: string,
  credentials: GithubAppCredentials,
  installationId?: string,
): Promise<void> {
  const { owner, repo, prNumber } = parsePrUrl(prUrl);
  const creds = installationId ? { ...credentials, installationId } : credentials;
  const token = await getInstallationToken(creds);

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'AgentOps-NotificationWorker',
      },
      body: JSON.stringify({ state: 'closed' }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub PR close failed (${response.status}): ${text}`);
  }
}

export async function postPrComment(
  prUrl: string,
  body: string,
  credentials: GithubAppCredentials,
): Promise<void> {
  const { owner, repo, prNumber } = parsePrUrl(prUrl);
  const token = await getInstallationToken(credentials);

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'AgentOps-NotificationWorker',
      },
      body: JSON.stringify({ body }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub PR comment failed (${response.status}): ${text}`);
  }
}

export function buildPrComment(
  type: NotificationType,
  p: Record<string, unknown>,
): string {
  switch (type) {
    case 'ANALYSIS_COMPLETE':
      return [
        '## AgentOps 분석 완료',
        '',
        '| 항목 | 값 |',
        '|------|-----|',
        `| 리스크 수준 | **${p['riskLevel'] ?? '-'}** |`,
        `| 발견 수 | ${p['findingsCount'] ?? 0} |`,
        `| 리포트 ID | \`${p['reportId'] ?? '-'}\` |`,
      ].join('\n');

    case 'HIGH_RISK_DETECTED':
      return [
        '## :warning: 고위험 항목 감지',
        '',
        `**${p['findingsCount'] ?? 0}건**의 고위험 항목이 발견되었습니다.`,
        '',
        `리스크 수준: **${p['riskLevel'] ?? '-'}**`,
      ].join('\n');

    case 'FIX_READY':
      return [
        '## :wrench: 수정 패치 준비 완료',
        '',
        `Fix ID: \`${p['fixId'] ?? '-'}\``,
        '',
        ...(p['patchSummary']
          ? ['**변경 사항 요약:**', '', String(p['patchSummary'])]
          : []),
      ].join('\n');

    case 'FIX_APPLIED':
      return [
        '## :white_check_mark: 수정 사항 적용 완료',
        '',
        `Fix ID: \`${p['fixId'] ?? '-'}\``,
      ].join('\n');

    case 'APPROVAL_NEEDED':
      return [
        '## :bell: 검토 승인 요청',
        '',
        `리포트 \`${p['reportId'] ?? '-'}\` 에 대한 승인이 필요합니다.`,
        '',
        `리스크 수준: **${p['riskLevel'] ?? '-'}**  `,
        `요청자: ${p['requestedBy'] ?? '-'}`,
      ].join('\n');

    default:
      return `AgentOps 알림: ${type}`;
  }
}
