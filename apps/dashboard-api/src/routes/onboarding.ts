import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ddbPut, ddbGet, ddbUpdate, Config } from '@aigo/aws-clients';
import { requireAuth, extractClaims } from '../middleware/auth.js';
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({
  region: process.env['AWS_REGION'] ?? 'ap-northeast-2',
});

const ULID_PLACEHOLDER = (): string => {
  return Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 9).toUpperCase();
};

const setupOrgSchema = z.object({
  orgName: z.string().min(2).max(80),
  githubLogin: z.string().min(1).max(100).optional(),
  plan: z.enum(['STARTER', 'GROWTH', 'ENTERPRISE']).default('STARTER'),
});

export const onboardingRouter = new Hono();

onboardingRouter.use('*', requireAuth());

// POST /onboarding/setup-org — create org and link user as OWNER
onboardingRouter.post(
  '/setup-org',
  zValidator('json', setupOrgSchema),
  async (c) => {
    const claims = extractClaims(c)!;
    const userId = claims.sub;
    const email = claims.email;

    // Prevent double-org creation
    if (claims['custom:orgId']) {
      return c.json({ error: 'ORG_ALREADY_EXISTS', orgId: claims['custom:orgId'] }, 409);
    }

    const { orgName, githubLogin, plan } = c.req.valid('json');
    const orgId = ULID_PLACEHOLDER();
    const now = new Date().toISOString();
    const userPoolId = process.env['COGNITO_USER_POOL_ID'];
    const githubAppInstallUrl = process.env['GITHUB_APP_INSTALL_URL'] ?? '';

    // ── 1. Create Organization ───────────────────────────────────────────────
    await ddbPut({
      TableName: Config.tableName('Organizations'),
      Item: {
        PK: `ORG#${orgId}`,
        SK: 'METADATA',
        orgId,
        name: orgName,
        ownerId: userId,
        plan,
        status: 'ACTIVE',
        githubLogin: githubLogin ?? null,
        createdAt: now,
        updatedAt: now,
        GSI1PK: githubLogin ? `GITHUB_LOGIN#${githubLogin}` : `ORG#${orgId}`,
        GSI1SK: now,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    });

    // ── 2. Update User record with orgId and role ────────────────────────────
    await ddbUpdate({
      TableName: Config.tableName('Users'),
      Key: { PK: `USER#${userId}`, SK: 'METADATA' },
      UpdateExpression: 'SET orgId = :orgId, #role = :role, updatedAt = :now, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: {
        ':orgId': orgId,
        ':role': 'OWNER',
        ':now': now,
        ':gsi1pk': `ORG#${orgId}`,
        ':gsi1sk': `USER#${userId}`,
      },
    });

    // ── 3. Update Cognito user attributes ────────────────────────────────────
    if (userPoolId) {
      await cognito.send(new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'custom:orgId', Value: orgId },
          { Name: 'custom:role', Value: 'OWNER' },
        ],
      }));
    }

    return c.json({
      orgId,
      orgName,
      githubAppInstallUrl: githubLogin
        ? `${githubAppInstallUrl}?suggested_target_id=${githubLogin}`
        : githubAppInstallUrl,
    }, 201);
  },
);

// GET /onboarding/status — returns current onboarding step
onboardingRouter.get('/status', async (c) => {
  const claims = extractClaims(c)!;
  const userId = claims.sub;
  const orgId = claims['custom:orgId'];

  const steps: {
    orgCreated: boolean;
    githubConnected: boolean;
    slackConnected: boolean;
    repoRegistered: boolean;
    completed: boolean;
  } = {
    orgCreated: false,
    githubConnected: false,
    slackConnected: false,
    repoRegistered: false,
    completed: false,
  };

  if (!orgId) {
    return c.json({ ...steps, userId });
  }

  steps.orgCreated = true;

  const [githubInteg, slackInteg, repos] = await Promise.all([
    ddbGet<{ status: string }>({
      TableName: Config.tableName('Integrations'),
      Key: { PK: `ORG#${orgId}`, SK: 'INTEGRATION#GITHUB' },
    }),
    ddbGet<{ status: string }>({
      TableName: Config.tableName('Integrations'),
      Key: { PK: `ORG#${orgId}`, SK: 'INTEGRATION#SLACK' },
    }),
    import('@aigo/aws-clients').then(({ ddbQuery }) =>
      ddbQuery({
        TableName: Config.tableName('Repositories'),
        IndexName: 'GSI1-orgId-provider-index',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `ORG#${orgId}` },
        Limit: 1,
      }),
    ),
  ]);

  steps.githubConnected = githubInteg?.status === 'ACTIVE';
  steps.slackConnected = slackInteg?.status === 'ACTIVE';
  steps.repoRegistered = (repos?.items?.length ?? 0) > 0;
  steps.completed = steps.githubConnected && steps.repoRegistered;

  return c.json({ ...steps, orgId, userId });
});

// POST /onboarding/complete — mark onboarding as finished, update Cognito attribute
onboardingRouter.post('/complete', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  const email = claims.email;
  const userId = claims.sub;

  if (!orgId) {
    return c.json({ error: 'ORG_REQUIRED' }, 400);
  }

  const userPoolId = process.env['COGNITO_USER_POOL_ID'];
  const now = new Date().toISOString();

  await Promise.all([
    userPoolId
      ? cognito.send(new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [{ Name: 'custom:onboardingCompleted', Value: 'true' }],
      }))
      : Promise.resolve(),
    ddbUpdate({
      TableName: Config.tableName('Users'),
      Key: { PK: `USER#${userId}`, SK: 'METADATA' },
      UpdateExpression: 'SET onboardingCompleted = :t, updatedAt = :now',
      ExpressionAttributeValues: { ':t': true, ':now': now },
    }),
  ]);

  return c.json({ ok: true });
});
