import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ddbPut, ddbUpdate, ddbQuery, Config } from '@aigo/aws-clients';
import { createContextLogger } from '@aigo/logger';
import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({ region: process.env['AWS_REGION'] ?? 'ap-northeast-2' });

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token: string;
  bot_user_id: string;
  team: {
    id: string;
    name: string;
  };
  authed_user: {
    id: string;
  };
  scope: string;
  /** Present when bot was authorized with incoming-webhook scope */
  incoming_webhook?: {
    channel: string;
    channel_id: string;
    configuration_url: string;
    url: string;
  };
}

export async function handleSlackOAuth(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;
  const logger = createContextLogger({ requestId, source: 'slack-oauth' });

  const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'https://app.seolphung.com';
  const clientId = process.env['SLACK_CLIENT_ID'];
  const clientSecret = process.env['SLACK_CLIENT_SECRET'];
  const redirectUri = process.env['SLACK_REDIRECT_URI'];
  const ssmPath = process.env['SSM_SLACK_TOKEN_PATH'] ?? '/aigo/integrations/slack';

  // ── 1. Extract OAuth callback params ─────────────────────────────────────
  const { code, state, error: oauthError } = event.queryStringParameters ?? {};

  if (oauthError) {
    logger.warn('Slack OAuth denied by user', { error: oauthError });
    return redirect(`${dashboardUrl}/settings?slack_error=${oauthError}`);
  }

  if (!code || !state) {
    return { statusCode: 400, body: '{"error":"missing_code_or_state"}' };
  }

  // ── 2. Validate state param — format: {orgId}:{nonce} ────────────────────
  const [orgId, nonce] = state.split(':');
  if (!orgId || !nonce) {
    logger.warn('Invalid OAuth state parameter', { state });
    return { statusCode: 400, body: '{"error":"invalid_state"}' };
  }

  if (!clientId || !clientSecret || !redirectUri) {
    logger.error('Slack OAuth env vars missing');
    return { statusCode: 500, body: '{"error":"config_error"}' };
  }

  // ── 3. Exchange code for access token ─────────────────────────────────────
  const tokenUrl = 'https://slack.com/api/oauth.v2.access';
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  let slackData: SlackOAuthResponse;
  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    slackData = (await response.json()) as SlackOAuthResponse;
  } catch (err) {
    logger.error('Failed to exchange Slack OAuth code', { error: String(err) });
    return redirect(`${dashboardUrl}/settings?slack_error=token_exchange_failed`);
  }

  if (!slackData.ok) {
    logger.warn('Slack OAuth token exchange failed', { error: slackData.error });
    return redirect(`${dashboardUrl}/settings?slack_error=${slackData.error}`);
  }

  const { access_token, team, bot_user_id, incoming_webhook } = slackData;
  const now = new Date().toISOString();
  const defaultChannelId = incoming_webhook?.channel_id ?? '';
  const defaultChannelName = incoming_webhook?.channel ?? '';

  // ── 4. Store bot token in SSM Parameter Store (SecureString) ──────────────
  const paramName = `${ssmPath}/${orgId}/bot-token`;
  await ssm.send(new PutParameterCommand({
    Name: paramName,
    Value: access_token,
    Type: 'SecureString',
    Overwrite: true,
    Description: `Slack bot token for org ${orgId} (team: ${team.name})`,
  }));

  // Store the default channel ID if provided via incoming_webhook scope
  if (defaultChannelId) {
    await ssm.send(new PutParameterCommand({
      Name: `${ssmPath}/${orgId}/channel-id`,
      Value: defaultChannelId,
      Type: 'String',
      Overwrite: true,
      Description: `Default Slack channel ID for org ${orgId} (${defaultChannelName})`,
    }));
  }

  // ── 5. Persist integration record in DynamoDB ─────────────────────────────
  await ddbPut({
    TableName: Config.tableName('Integrations'),
    Item: {
      PK: `ORG#${orgId}`,
      SK: 'INTEGRATION#SLACK',
      orgId,
      type: 'SLACK',
      slackTeamId: team.id,
      slackTeamName: team.name,
      botUserId: bot_user_id,
      status: 'ACTIVE',
      scope: slackData.scope,
      slackChannelId: defaultChannelId,
      slackChannelName: defaultChannelName,
      createdAt: now,
      updatedAt: now,
      GSI1PK: `ORG#${orgId}`,
      GSI1SK: 'INTEGRATION#SLACK',
      GSI2PK: `SLACK_TEAM#${team.id}`,
    },
  });

  // ── 6. Update Organization record ─────────────────────────────────────────
  // Look up the organization PK from orgId
  const orgResult = await ddbQuery<{ PK: string }>({
    TableName: Config.tableName('Organizations'),
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}` },
    Limit: 1,
  });

  if (orgResult.items.length > 0) {
    await ddbUpdate({
      TableName: Config.tableName('Organizations'),
      Key: { PK: `ORG#${orgId}`, SK: 'METADATA' },
      UpdateExpression: 'SET slackTeamId = :teamId, slackTeamName = :teamName, slackConnectedAt = :now, updatedAt = :now',
      ExpressionAttributeValues: {
        ':teamId': team.id,
        ':teamName': team.name,
        ':now': now,
      },
    });
  }

  logger.info('Slack workspace connected', { orgId, slackTeamId: team.id, slackTeamName: team.name });

  return redirect(`${dashboardUrl}/settings?slack_connected=true`);
}

function redirect(url: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 302,
    headers: { Location: url },
    body: '',
  };
}
