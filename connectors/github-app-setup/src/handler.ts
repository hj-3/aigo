import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ddbPut, ddbDelete, ddbQuery, ddbUpdate, getSecretJson, Config } from '@aigo/aws-clients';
import { createContextLogger } from '@aigo/logger';
import { validateGitHubSignature, extractRawBody } from './validator.js';

interface GithubAppCredentials {
  readonly webhookSecret: string;
}

interface InstallationPayload {
  action: 'created' | 'deleted' | 'suspend' | 'unsuspend';
  installation: {
    id: number;
    app_id: number;
    account: {
      login: string;
      id: number;
      type: 'Organization' | 'User';
    };
    created_at: string;
    updated_at: string;
    repository_selection: 'all' | 'selected';
    permissions: Record<string, string>;
  };
  sender: {
    login: string;
    id: number;
  };
}

export async function handleGitHubAppSetup(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;
  const logger = createContextLogger({ requestId, source: 'github-app-setup' });

  // ── 1. Validate signature ──────────────────────────────────────────────────
  const githubSecretArn = process.env['GITHUB_SECRET_ARN'];
  if (!githubSecretArn) {
    logger.error('GITHUB_SECRET_ARN env var missing');
    return { statusCode: 500, body: '{"error":"config_error"}' };
  }

  let credentials: GithubAppCredentials;
  try {
    credentials = await getSecretJson<GithubAppCredentials>(githubSecretArn);
  } catch (err) {
    logger.error('Failed to fetch GitHub secret', { error: String(err) });
    return { statusCode: 500, body: '{"error":"secret_fetch_failed"}' };
  }

  if (!validateGitHubSignature(event, credentials.webhookSecret)) {
    logger.warn('Invalid GitHub webhook signature');
    return { statusCode: 401, body: '{"error":"invalid_signature"}' };
  }

  // ── 2. Parse payload ───────────────────────────────────────────────────────
  const rawBody = extractRawBody(event);
  const eventType = event.headers['x-github-event'];

  if (eventType === 'ping') {
    return { statusCode: 200, body: '{"ok":true}' };
  }

  if (eventType !== 'installation') {
    return { statusCode: 204, body: '' };
  }

  let payload: InstallationPayload;
  try {
    payload = JSON.parse(rawBody) as InstallationPayload;
  } catch {
    logger.warn('Failed to parse webhook payload');
    return { statusCode: 400, body: '{"error":"invalid_json"}' };
  }

  const installationId = String(payload.installation.id);
  const accountLogin = payload.installation.account.login;
  const now = new Date().toISOString();

  if (payload.action === 'created') {
    // ── 3a. Find the org by GitHub account login ───────────────────────────
    // Orgs register their GitHub handle during onboarding; look up by githubLogin
    const orgResult = await ddbQuery<{ PK: string; orgId: string; githubLogin?: string }>({
      TableName: Config.tableName('Organizations'),
      IndexName: 'GSI1-orgId-provider-index',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `GITHUB_LOGIN#${accountLogin}`,
      },
      Limit: 1,
    });

    if (orgResult.items.length === 0) {
      // Installation from unknown org — store pending record keyed by login
      // The org will claim it during onboarding finish
      await ddbPut({
        TableName: Config.tableName('Integrations'),
        Item: {
          PK: `PENDING_INSTALLATION#${installationId}`,
          SK: 'GITHUB',
          installationId,
          accountLogin,
          status: 'PENDING_ORG',
          createdAt: now,
          GSI2PK: `INSTALLATION#${installationId}`,
          ttl: Math.floor(Date.now() / 1000) + 86400 * 30,
        },
      });
      logger.info('Stored pending installation (org not found yet)', { installationId, accountLogin });
      return { statusCode: 200, body: '{"status":"pending_org"}' };
    }

    const org = orgResult.items[0];
    const orgId = org.orgId;

    // ── 3b. Upsert Integrations record ─────────────────────────────────────
    await ddbPut({
      TableName: Config.tableName('Integrations'),
      Item: {
        PK: `ORG#${orgId}`,
        SK: 'INTEGRATION#GITHUB',
        orgId,
        type: 'GITHUB',
        installationId,
        accountLogin,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
        GSI1PK: `ORG#${orgId}`,
        GSI1SK: 'INTEGRATION#GITHUB',
        GSI2PK: `INSTALLATION#${installationId}`,
      },
    });

    // ── 3c. Update Organization record with installationId ─────────────────
    await ddbUpdate({
      TableName: Config.tableName('Organizations'),
      Key: { PK: org.PK, SK: 'METADATA' },
      UpdateExpression: 'SET githubInstallationId = :id, githubConnectedAt = :now, updatedAt = :now',
      ExpressionAttributeValues: {
        ':id': installationId,
        ':now': now,
      },
    });

    logger.info('GitHub App installed for org', { orgId, installationId });
    return { statusCode: 200, body: JSON.stringify({ orgId, installationId }) };

  } else if (payload.action === 'deleted' || payload.action === 'suspend') {
    // ── 4. Remove/deactivate the integration ──────────────────────────────
    const integrationResult = await ddbQuery<{ orgId: string; PK: string }>({
      TableName: Config.tableName('Integrations'),
      IndexName: 'GSI2-externalId-index',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `INSTALLATION#${installationId}`,
      },
      Limit: 1,
    });

    const integration = integrationResult.items[0];
    if (integration) {
      const status = payload.action === 'deleted' ? 'UNINSTALLED' : 'SUSPENDED';
      await ddbUpdate({
        TableName: Config.tableName('Integrations'),
        Key: { PK: `ORG#${integration.orgId}`, SK: 'INTEGRATION#GITHUB' },
        UpdateExpression: 'SET #s = :status, updatedAt = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':status': status, ':now': now },
      });
      logger.info('GitHub App integration updated', { orgId: integration.orgId, status });
    }

    return { statusCode: 200, body: '{"ok":true}' };
  }

  return { statusCode: 204, body: '' };
}
