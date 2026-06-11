import type { SQSRecord } from 'aws-lambda';
import { getSecretJson } from '@aigo/aws-clients';
import { createContextLogger } from '@aigo/logger';
import type { NotificationQueueMessage } from '@aigo/types';
import { sendSlackMessage, buildBlocks } from './slack.js';
import { postPrComment, buildPrComment } from './github.js';

const SLACK_SECRET_ARN = process.env['SLACK_SECRET_ARN'] ?? '';
const GITHUB_SECRET_ARN = process.env['GITHUB_SECRET_ARN'] ?? '';

// Notification types that map to GitHub PR events — post a comment on the PR
const PR_NOTIFICATION_TYPES = new Set([
  'ANALYSIS_COMPLETE',
  'HIGH_RISK_DETECTED',
  'FIX_READY',
  'FIX_APPLIED',
  'APPROVAL_NEEDED',
]);

export interface GithubAppCredentials {
  readonly appId: string;
  readonly privateKey: string;
  readonly installationId: string;
  readonly webhookSecret: string;
}

export async function processRecord(record: SQSRecord): Promise<void> {
  const message = JSON.parse(record.body) as NotificationQueueMessage;
  const { notificationType, payload, slackChannel, orgId } = message;

  const logger = createContextLogger(
    { orgId, notificationType } as Record<string, unknown>,
    'notification-worker',
  );

  logger.info('Processing notification', { messageId: message.messageId });

  // Slack: send if a channel is specified
  const channel = slackChannel ?? '';
  if (channel) {
    const { botToken } = await getSecretJson<{ botToken: string }>(SLACK_SECRET_ARN);
    const blocks = buildBlocks(notificationType, payload);
    const text = buildFallbackText(notificationType, payload);
    await sendSlackMessage(channel, blocks, text, botToken);
    logger.info('Slack notification sent', { channel });
  }

  // GitHub PR comment for PR-related notification types
  if (PR_NOTIFICATION_TYPES.has(notificationType)) {
    const prUrl = payload['prUrl'] as string | undefined;
    if (prUrl) {
      const githubCreds = await getSecretJson<GithubAppCredentials>(GITHUB_SECRET_ARN);
      const comment = buildPrComment(notificationType, payload);
      await postPrComment(prUrl, comment, githubCreds);
      logger.info('GitHub PR comment posted', { prUrl });
    }
  }
}

function buildFallbackText(type: string, p: Record<string, unknown>): string {
  switch (type) {
    case 'ANALYSIS_COMPLETE':
      return `분석 완료 — 리스크: ${p['riskLevel']} | 발견: ${p['findingsCount']}건`;
    case 'HIGH_RISK_DETECTED':
      return `고위험 감지 — PR #${p['prNumber']}에서 ${p['findingsCount']}건 발견`;
    case 'FIX_READY':
      return `수정 패치 준비 완료 — 리포트 ${p['reportId']}`;
    case 'FIX_APPLIED':
      return `수정 사항 적용 완료 — ${p['prUrl'] ?? ''}`;
    case 'INCIDENT_DETECTED':
      return `인시던트 감지: ${p['title']}`;
    case 'INCIDENT_RESOLVED':
      return `인시던트 해결: ${p['title']}`;
    case 'APPROVAL_NEEDED':
      return `승인 요청 — 리포트 ${p['reportId']}`;
    default:
      return `AgentOps 알림: ${type}`;
  }
}
