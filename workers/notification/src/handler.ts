import type { SQSRecord } from 'aws-lambda';
import { getSecretJson } from '@aigo/aws-clients';
import { createContextLogger } from '@aigo/logger';
import type { NotificationQueueMessage } from '@aigo/types';
import { sendSlackMessage, buildBlocks } from './slack.js';
import { postPrComment, buildPrComment, createPrReview, mergePr, closePr } from './github.js';

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

  // REVIEW_SUBMITTED — dashboard Approve/Reject → GitHub PR formal review + merge if APPROVED
  if (notificationType === 'REVIEW_SUBMITTED') {
    const prUrl = payload['prUrl'] as string | undefined;
    const decision = payload['decision'] as string | undefined;
    const comment = payload['comment'] as string | undefined;
    if (prUrl && decision) {
      const githubCreds = await getSecretJson<GithubAppCredentials>(GITHUB_SECRET_ARN);
      const githubEvent = decision === 'APPROVED' ? 'APPROVE' : 'REQUEST_CHANGES';
      const reviewBody = buildReviewBody(decision, comment ?? '');
      await createPrReview(prUrl, githubEvent, reviewBody, githubCreds, message.installationId);
      logger.info('GitHub PR review submitted', { prUrl, decision: githubEvent });

      // Merge PR when manually approved via Slack /approve or Dashboard
      if (decision === 'APPROVED') {
        await mergePr(prUrl, githubCreds, message.installationId);
        logger.info('GitHub PR merged after manual approval', { prUrl });
      } else if (decision === 'REJECTED') {
        await closePr(prUrl, githubCreds, message.installationId);
        logger.info('GitHub PR closed after rejection', { prUrl });
      }
    }
    return;
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

function buildReviewBody(decision: string, comment: string): string {
  if (decision === 'APPROVED') {
    return [
      '## ✅ AgentOps 분석 — 승인',
      '',
      'AIGO 대시보드에서 이 PR이 승인되었습니다.',
      comment ? `\n> ${comment}` : '',
    ].join('\n');
  }
  return [
    '## ❌ AgentOps 분석 — 변경 요청',
    '',
    'AIGO 대시보드에서 이 PR에 대한 변경이 요청되었습니다.',
    comment ? `\n> ${comment}` : '',
    '',
    '리포트를 확인하고 발견된 문제를 수정한 후 재검토를 요청하세요.',
  ].join('\n');
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
