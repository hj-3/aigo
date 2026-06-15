import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ddbPut, ddbUpdate, ddbDelete, ddbQuery, Config } from '@aigo/aws-clients';
import { requireAuth, requireRole, extractClaims } from '../middleware/auth.js';
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({
  region: process.env['AWS_REGION'] ?? 'ap-northeast-2',
});

const ULID_PLACEHOLDER = (): string => {
  return Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 9).toUpperCase();
};

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'REVIEWER', 'VIEWER']),
});

const updateRoleSchema = z.object({
  role: z.enum(['ADMIN', 'REVIEWER', 'VIEWER']),
});

export const teamRouter = new Hono();

teamRouter.use('*', requireAuth());

// GET /team/members
teamRouter.get('/members', async (c) => {
  const claims = extractClaims(c)!;
  const orgId = claims['custom:orgId'];
  if (!orgId) return c.json({ error: 'ORG_REQUIRED' }, 400);

  const { items } = await ddbQuery({
    TableName: Config.tableName('Users'),
    IndexName: 'GSI1-orgId-email-index',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `ORG#${orgId}` },
  });

  return c.json(items);
});

// POST /team/invite — OWNER/ADMIN only
teamRouter.post(
  '/invite',
  requireRole('ADMIN'),
  zValidator('json', inviteSchema),
  async (c) => {
    const claims = extractClaims(c)!;
    const orgId = claims['custom:orgId'];
    if (!orgId) return c.json({ error: 'ORG_REQUIRED' }, 400);

    const { email, role } = c.req.valid('json');
    const invitationId = ULID_PLACEHOLDER();
    const now = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + 86400 * 7; // 7 days

    await ddbPut({
      TableName: Config.tableName('OrgInvitations'),
      Item: {
        PK: `ORG#${orgId}`,
        SK: `INVITATION#${invitationId}`,
        invitationId,
        orgId,
        email,
        role,
        status: 'PENDING',
        invitedBy: claims.sub,
        createdAt: now,
        ttl,
        GSI1PK: `EMAIL#${email}`,
        GSI1SK: now,
      },
    });

    // TODO: send SES invitation email
    return c.json({ invitationId, email, role }, 201);
  },
);

// PATCH /team/members/:userId/role — OWNER only
teamRouter.patch(
  '/members/:userId/role',
  requireRole('OWNER'),
  zValidator('json', updateRoleSchema),
  async (c) => {
    const claims = extractClaims(c)!;
    const orgId = claims['custom:orgId'];
    const targetUserId = c.req.param('userId');
    if (!orgId) return c.json({ error: 'ORG_REQUIRED' }, 400);
    if (targetUserId === claims.sub) return c.json({ error: 'CANNOT_CHANGE_OWN_ROLE' }, 400);

    const { role } = c.req.valid('json');
    const userPoolId = process.env['COGNITO_USER_POOL_ID'];
    const now = new Date().toISOString();

    await ddbUpdate({
      TableName: Config.tableName('Users'),
      Key: { PK: `USER#${targetUserId}`, SK: 'METADATA' },
      UpdateExpression: 'SET #role = :role, updatedAt = :now',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: { ':role': role, ':now': now },
      ConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: {
        ':role': role,
        ':now': now,
        ':orgId': orgId,
      },
    });

    if (userPoolId) {
      // Fetch user email for Cognito update
      const { items } = await ddbQuery<{ email: string; cognitoUsername: string }>({
        TableName: Config.tableName('Users'),
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `USER#${targetUserId}` },
        Limit: 1,
      });
      if (items[0]?.cognitoUsername) {
        await cognito.send(new AdminUpdateUserAttributesCommand({
          UserPoolId: userPoolId,
          Username: items[0].cognitoUsername,
          UserAttributes: [{ Name: 'custom:role', Value: role }],
        }));
        await cognito.send(new AdminAddUserToGroupCommand({
          UserPoolId: userPoolId,
          Username: items[0].cognitoUsername,
          GroupName: role,
        }));
      }
    }

    return c.json({ userId: targetUserId, role });
  },
);

// DELETE /team/members/:userId — OWNER only
teamRouter.delete(
  '/members/:userId',
  requireRole('OWNER'),
  async (c) => {
    const claims = extractClaims(c)!;
    const orgId = claims['custom:orgId'];
    const targetUserId = c.req.param('userId');
    if (!orgId) return c.json({ error: 'ORG_REQUIRED' }, 400);
    if (targetUserId === claims.sub) return c.json({ error: 'CANNOT_REMOVE_SELF' }, 400);

    const now = new Date().toISOString();

    await ddbUpdate({
      TableName: Config.tableName('Users'),
      Key: { PK: `USER#${targetUserId}`, SK: 'METADATA' },
      UpdateExpression: 'SET #status = :s, orgId = :null, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':s': 'REMOVED',
        ':null': null,
        ':now': now,
        ':orgId': orgId,
      },
      ConditionExpression: 'orgId = :orgId',
    });

    return c.json({ ok: true });
  },
);
