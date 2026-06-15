import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ddbQuery, ddbGet, ddbPut, ddbUpdate, ddbDelete, Config } from '@aigo/aws-clients';
import { requireAuth, requireRole, extractClaims } from '../middleware/auth.js';

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
        providerRepoId: body.providerRepoId ?? null,
        defaultBranch: body.defaultBranch,
        status: 'ACTIVE',
        config: body.config,
        createdAt: now,
        updatedAt: now,
        GSI1PK: `ORG#${orgId}`,
        GSI1SK: `${body.provider}#${repoId}`,
        ...(body.providerRepoId
          ? { GSI2PK: `PROVIDER_REPO#${body.providerRepoId}` }
          : {}),
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    });

    return c.json({ repoId, fullName: body.fullName }, 201);
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
