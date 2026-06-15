import { Hono } from 'hono';
import { ddbGet, ddbUpdate, Config } from '@aigo/aws-clients';
import { requireAuth, requireRole, extractClaims } from '../middleware/auth.js';
import { SSMClient, DeleteParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({ region: process.env['AWS_REGION'] ?? 'ap-northeast-2' });

export const integrationsRouter = new Hono();

integrationsRouter.use('*', requireAuth());

// GET /integrations — return GitHub + Slack integration status for the org
integrationsRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  if (!orgId) return c.json({ error: 'ORG_REQUIRED' }, 400);

  const [github, slack] = await Promise.all([
    ddbGet<{
      status: string;
      installationId: string;
      accountLogin: string;
      updatedAt: string;
    }>({
      TableName: Config.tableName('Integrations'),
      Key: { PK: `ORG#${orgId}`, SK: 'INTEGRATION#GITHUB' },
    }),
    ddbGet<{
      status: string;
      slackTeamId: string;
      slackTeamName: string;
      botUserId: string;
      updatedAt: string;
    }>({
      TableName: Config.tableName('Integrations'),
      Key: { PK: `ORG#${orgId}`, SK: 'INTEGRATION#SLACK' },
    }),
  ]);

  const githubAppInstallUrl = process.env['GITHUB_APP_INSTALL_URL'] ?? '';
  const slackClientId = process.env['SLACK_CLIENT_ID'] ?? '';
  const slackRedirectUri = process.env['SLACK_REDIRECT_URI'] ?? '';

  return c.json({
    github: github
      ? {
          connected: github.status === 'ACTIVE',
          status: github.status,
          accountLogin: github.accountLogin,
          installedAt: github.updatedAt,
          installUrl: githubAppInstallUrl,
        }
      : { connected: false, installUrl: githubAppInstallUrl },
    slack: slack
      ? {
          connected: slack.status === 'ACTIVE',
          status: slack.status,
          teamId: slack.slackTeamId,
          teamName: slack.slackTeamName,
          connectUrl: buildSlackConnectUrl(slackClientId, slackRedirectUri, orgId),
        }
      : {
          connected: false,
          connectUrl: buildSlackConnectUrl(slackClientId, slackRedirectUri, orgId),
        },
  });
});

// DELETE /integrations/slack — disconnect Slack workspace
integrationsRouter.delete(
  '/slack',
  requireRole('OWNER'),
  async (c) => {
    const claims = extractClaims(c)!;
    const orgId = claims['custom:orgId'];
    if (!orgId) return c.json({ error: 'ORG_REQUIRED' }, 400);

    const now = new Date().toISOString();
    const ssmPath = process.env['SSM_SLACK_TOKEN_PATH'] ?? '/aigo/integrations/slack';

    await ddbUpdate({
      TableName: Config.tableName('Integrations'),
      Key: { PK: `ORG#${orgId}`, SK: 'INTEGRATION#SLACK' },
      UpdateExpression: 'SET #s = :disconnected, updatedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':disconnected': 'DISCONNECTED', ':now': now },
    });

    // Remove bot token from SSM
    try {
      await ssm.send(new DeleteParameterCommand({
        Name: `${ssmPath}/${orgId}/bot-token`,
      }));
    } catch {
      // If token doesn't exist, that's fine
    }

    return c.json({ ok: true });
  },
);

function buildSlackConnectUrl(clientId: string, redirectUri: string, orgId: string): string {
  if (!clientId) return '';
  const nonce = Math.random().toString(36).substring(2);
  const state = `${orgId}:${nonce}`;
  const scopes = [
    'chat:write',
    'chat:write.public',
    'channels:read',
    'groups:read',
  ].join(',');
  return `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
}
