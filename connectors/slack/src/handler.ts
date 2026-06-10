import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { getSecret, sqsSendMessage, Config } from '@aigo/aws-clients';
import { createContextLogger } from '@aigo/logger';
import { validateSlackSignature, parseSlashCommandBody } from './validator.js';
import { randomUUID } from 'node:crypto';

interface SlackCredentials {
  readonly signingSecret: string;
  readonly botToken: string;
}

type SlackCommandType = 'APPROVE' | 'REJECT' | 'INVESTIGATE';

const COMMAND_MAP: Record<string, SlackCommandType> = {
  '/approve': 'APPROVE',
  '/reject': 'REJECT',
  '/investigate': 'INVESTIGATE',
};

const SLACK_ACCEPTED_RESPONSE = {
  response_type: 'ephemeral',
  text: '분석 요청이 접수되었습니다. 잠시 후 결과를 알려드리겠습니다.',
};

export async function handleSlackCommand(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;
  const logger = createContextLogger({ requestId, source: 'slack-connector' });

  const slackSecretArn = process.env['SLACK_SECRET_ARN'];
  if (!slackSecretArn) {
    logger.error('SLACK_SECRET_ARN env var missing');
    return jsonResponse(500, { error: 'config_error' });
  }

  // ── 1. Validate Slack signature ───────────────────────────────────────────
  const timestamp = event.headers['x-slack-request-timestamp'];
  const signature = event.headers['x-slack-signature'];
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf-8')
    : (event.body ?? '');

  if (!timestamp || !signature) {
    return jsonResponse(401, { error: 'missing_signature_headers' });
  }

  let credentials: SlackCredentials;
  try {
    credentials = await getSecret(slackSecretArn) as unknown as SlackCredentials;
  } catch {
    return jsonResponse(500, { error: 'secret_fetch_failed' });
  }

  if (!validateSlackSignature(credentials.signingSecret, timestamp, rawBody, signature)) {
    logger.warn('Invalid Slack signature');
    return jsonResponse(401, { error: 'invalid_signature' });
  }

  // ── 2. Parse slash command ────────────────────────────────────────────────
  const params = parseSlashCommandBody(rawBody);
  const command = params['command'] ?? '';
  const text = (params['text'] ?? '').trim();
  const userId = params['user_id'] ?? '';
  const teamId = params['team_id'] ?? '';

  const commandType = COMMAND_MAP[command];
  if (!commandType) {
    return slackResponse({ response_type: 'ephemeral', text: `알 수 없는 명령어: ${command}` });
  }

  if (!text) {
    return slackResponse({
      response_type: 'ephemeral',
      text: `사용법: ${command} <reportId> [comment]`,
    });
  }

  // text format: "<reportId> [optional comment]"
  const [reportId, ...commentParts] = text.split(' ');
  const comment = commentParts.join(' ');

  if (!reportId) {
    return slackResponse({ response_type: 'ephemeral', text: 'reportId가 필요합니다.' });
  }

  // ── 3. Publish to command-queue ───────────────────────────────────────────
  const payload = {
    type: 'COMMAND',
    messageId: randomUUID(),
    timestamp: new Date().toISOString(),
    source: 'slack',
    command: commandType,
    reportId,
    orgId: teamId,
    actorId: userId,
    comment: comment || undefined,
  };

  await sqsSendMessage(Config.sqs.commandQueueUrl, payload, {
    messageGroupId: `${teamId}#${reportId}`,
    messageDeduplicationId: `slack-${commandType}-${reportId}-${Date.now()}`,
  });

  logger.info('Slack command queued', { command: commandType, reportId, userId });
  return slackResponse(SLACK_ACCEPTED_RESPONSE);
}

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function slackResponse(body: object): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
