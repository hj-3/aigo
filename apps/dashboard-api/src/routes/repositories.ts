import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createSign } from 'node:crypto';
import { ddbQuery, ddbGet, ddbPut, ddbUpdate, getSecretJson, Config } from '@aigo/aws-clients';
import { requireAuth, requireRole, extractClaims } from '../middleware/auth.js';

interface GitHubAppCredentials {
  readonly appId: string;
  readonly privateKey: string;
}

function createGitHubJWT(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  return `${signingInput}.${sign.sign(privateKey, 'base64url')}`;
}

async function getInstallationToken(appId: string, privateKey: string, installationId: string): Promise<string> {
  const jwt = createGitHubJWT(appId, privateKey);
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const data = await res.json() as { token: string };
  return data.token;
}

async function fetchGitHubRepoId(fullName: string, token: string): Promise<{ id: number; default_branch: string } | null> {
  const res = await fetch(`https://api.github.com/repos/${fullName}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) return null;
  return res.json() as Promise<{ id: number; default_branch: string }>;
}

const ULID_PLACEHOLDER = (): string => {
  return Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 9).toUpperCase();
};

const registerRepoSchema = z.object({
  fullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Must be in owner/repo format'),
  provider: z.enum(['GITHUB']).default('GITHUB'),
  providerRepoId: z.string().optional(),
  defaultBranch: z.string().default('main'),
  config: z.object({
    autoAnalyzeOnPR: z.boolean().default(true),
    notifyOnSlack: z.boolean().default(true),
    blockMergeOnHigh: z.boolean().default(false),
    riskThreshold: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('HIGH'),
  }).default({}),
});

const updateConfigSchema = z.object({
  config: z.object({
    autoAnalyzeOnPR: z.boolean().optional(),
    notifyOnSlack: z.boolean().optional(),
    blockMergeOnHigh: z.boolean().optional(),
    riskThreshold: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  }),
});

export const repositoriesRouter = new Hono();

repositoriesRouter.use('*', requireAuth());

// GET /repositories
repositoriesRouter.get('/', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  if (!orgId) return c.json([]);

  const { items } = await ddbQuery({
    TableName: Config.tableName('Repositories'),
    IndexName: 'GSI1-orgId-provider-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}` },
    ScanIndexForward: false,
  });

  return c.json(items);
});

// POST /repositories — register a new repo
repositoriesRouter.post(
  '/',
  requireRole('ADMIN'),
  zValidator('json', registerRepoSchema),
  async (c) => {
    const claims = extractClaims(c)!;
    const orgId = claims['custom:orgId'];
    if (!orgId) return c.json({ error: 'ORG_REQUIRED' }, 400);

    const body = c.req.valid('json');
    const repoId = ULID_PLACEHOLDER();
    const now = new Date().toISOString();
    const [owner, repoName] = body.fullName.split('/');

    // Auto-fetch providerRepoId from GitHub if not provided
    let providerRepoId = body.providerRepoId ?? null;
    let defaultBranch = body.defaultBranch;

    if (!providerRepoId) {
      try {
        const integrationResult = await ddbQuery<{ installationId: string }>({
          TableName: Config.tableName('Integrations'),
          KeyConditionExpression: 'PK = :pk AND SK = :sk',
          ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':sk': 'INTEGRATION#GITHUB' },
          Limit: 1,
        });
        const installationId = integrationResult.items[0]?.installationId;
        if (installationId) {
          const secretArn = process.env['GITHUB_SECRET_ARN']!;
          const creds = await getSecretJson<GitHubAppCredentials>(secretArn);
          const token = await getInstallationToken(creds.appId, creds.privateKey, installationId);
          const ghRepo = await fetchGitHubRepoId(body.fullName, token);
          if (ghRepo) {
            providerRepoId = String(ghRepo.id);
            defaultBranch = ghRepo.default_branch;
          }
        }
      } catch {
        // Non-fatal: store without providerRepoId, PR webhooks won't auto-route
      }
    }

    await ddbPut({
      TableName: Config.tableName('Repositories'),
      Item: {
        PK: `REPO#${repoId}`,
        SK: 'METADATA',
        repoId,
        orgId,
        fullName: body.fullName,
        owner,
        name: repoName,
        provider: body.provider,
        providerRepoId,
        defaultBranch,
        status: 'ACTIVE',
        config: body.config,
        createdAt: now,
        updatedAt: now,
        GSI1PK: `ORG#${orgId}`,
        GSI1SK: `${body.provider}#${repoId}`,
        ...(providerRepoId ? { GSI2PK: `PROVIDER_REPO#${providerRepoId}` } : {}),
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    });

    return c.json({ repoId, fullName: body.fullName, providerRepoId }, 201);
  },
);

// DELETE /repositories/:repoId
repositoriesRouter.delete(
  '/:repoId',
  requireRole('ADMIN'),
  async (c) => {
    const claims = extractClaims(c)!;
    const orgId = claims['custom:orgId'];
    const repoId = c.req.param('repoId');
    if (!orgId) return c.json({ error: 'ORG_REQUIRED' }, 400);

    const repo = await ddbGet<{ orgId: string }>({
      TableName: Config.tableName('Repositories'),
      Key: { PK: `REPO#${repoId}`, SK: 'METADATA' },
    });

    if (!repo || repo.orgId !== orgId) {
      return c.json({ error: 'NOT_FOUND' }, 404);
    }

    const now = new Date().toISOString();
    await ddbUpdate({
      TableName: Config.tableName('Repositories'),
      Key: { PK: `REPO#${repoId}`, SK: 'METADATA' },
      UpdateExpression: 'SET #s = :s, updatedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': 'INACTIVE', ':now': now },
    });

    return c.json({ ok: true });
  },
);

// PATCH /repositories/:repoId/config
repositoriesRouter.patch(
  '/:repoId/config',
  requireRole('ADMIN'),
  zValidator('json', updateConfigSchema),
  async (c) => {
    const claims = extractClaims(c)!;
    const orgId = claims['custom:orgId'];
    const repoId = c.req.param('repoId');
    if (!orgId) return c.json({ error: 'ORG_REQUIRED' }, 400);

    const repo = await ddbGet<{ orgId: string; config: object }>({
      TableName: Config.tableName('Repositories'),
      Key: { PK: `REPO#${repoId}`, SK: 'METADATA' },
    });

    if (!repo || repo.orgId !== orgId) {
      return c.json({ error: 'NOT_FOUND' }, 404);
    }

    const { config } = c.req.valid('json');
    const now = new Date().toISOString();
    const mergedConfig = { ...(repo.config as object), ...config };

    await ddbUpdate({
      TableName: Config.tableName('Repositories'),
      Key: { PK: `REPO#${repoId}`, SK: 'METADATA' },
      UpdateExpression: 'SET config = :cfg, updatedAt = :now',
      ExpressionAttributeValues: { ':cfg': mergedConfig, ':now': now },
    });

    return c.json({ repoId, config: mergedConfig });
  },
);
