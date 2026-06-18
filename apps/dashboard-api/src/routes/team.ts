import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ddbPut, ddbGet, ddbUpdate, ddbDelete, ddbQuery, Config } from '@aigo/aws-clients';
import { requireAuth, requireRole, extractClaims } from '../middleware/auth.js';
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const cognito = new CognitoIdentityProviderClient({
  region: process.env['AWS_REGION'] ?? 'ap-northeast-2',
});

const ses = new SESClient({ region: process.env['AWS_REGION'] ?? 'ap-northeast-2' });

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

const acceptInviteSchema = z.object({
  invitationId: z.string().min(1),
});

export const teamRouter = new Hono();

// GET /team/invite/:invitationId — public (no auth required; API Gateway also exempts this route)
teamRouter.get('/invite/:invitationId', async (c) => {
  const invitationId = c.req.param('invitationId');

  const result = await ddbQuery<{
    invitationId: string;
    orgId: string;
    orgName: string;
    email: string;
    role: string;
    status: string;
    ttl: number;
  }>({
    TableName: Config.tableName('OrgInvitations'),
    IndexName: 'GSI2-invitationId-index',
    KeyConditionExpression: 'GSI2PK = :pk',
    ExpressionAttributeValues: { ':pk': `INVITATION#${invitationId}` },
    Limit: 1,
  });

  const invite = result.items[0];
  if (!invite) return c.json({ error: 'INVITATION_NOT_FOUND' }, 404);
  if (invite.status !== 'PENDING') return c.json({ error: 'INVITATION_ALREADY_USED' }, 410);
  if (invite.ttl < Math.floor(Date.now() / 1000)) return c.json({ error: 'INVITATION_EXPIRED' }, 410);

  return c.json({
    invitationId: invite.invitationId,
    orgName: invite.orgName,
    email: invite.email,
    role: invite.role,
  });
});

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

// POST /team/invite — ADMIN/OWNER only
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

    // Fetch org name for the email
    const orgResult = await ddbQuery<{ name: string }>({
      TableName: Config.tableName('Organizations'),
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: { ':pk': `ORG#${orgId}`, ':sk': 'METADATA' },
      Limit: 1,
    });
    const orgName = orgResult.items[0]?.name ?? 'AgentOps';

    await ddbPut({
      TableName: Config.tableName('OrgInvitations'),
      Item: {
        PK: `ORG#${orgId}`,
        SK: `INVITATION#${invitationId}`,
        invitationId,
        orgId,
        orgName,
        email,
        role,
        status: 'PENDING',
        invitedBy: claims.sub,
        createdAt: now,
        ttl,
        GSI1PK: `EMAIL#${email}`,
        GSI1SK: now,
        GSI2PK: `INVITATION#${invitationId}`,
      },
    });

    const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'https://app.seolphung.com';
    const fromAddress = process.env['SES_FROM_ADDRESS'] ?? 'noreply@seolphung.com';
    const inviteUrl = `${dashboardUrl}/invite?token=${invitationId}`;

    let emailSent = true;
    try {
      await ses.send(new SendEmailCommand({
        Source: fromAddress,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: `[AgentOps] ${orgName} 팀에 초대되었습니다` },
          Body: {
            Html: {
              Data: `
<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Helvetica Neue', Arial, sans-serif; background: #0a0a0a; color: #e2e8f0; margin: 0; padding: 40px 20px;">
  <div style="max-width: 520px; margin: 0 auto; background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 40px;">
    <h1 style="font-size: 20px; font-weight: 600; margin: 0 0 8px; color: #f1f5f9;">AgentOps 팀 초대</h1>
    <p style="color: #94a3b8; font-size: 14px; margin: 0 0 32px;">AI 기반 DevOps 자동화 플랫폼</p>

    <p style="font-size: 15px; line-height: 1.6; color: #cbd5e1; margin: 0 0 24px;">
      <strong style="color: #f1f5f9;">${orgName}</strong> 팀에 <strong style="color: #f1f5f9;">${role}</strong> 역할로 초대되었습니다.
    </p>

    <a href="${inviteUrl}"
       style="display: inline-block; background: #3b82f6; color: #ffffff; text-decoration: none;
              padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 500;">
      초대 수락하기
    </a>

    <p style="font-size: 12px; color: #6b7280; margin: 32px 0 0;">
      이 링크는 7일 후 만료됩니다.<br>
      원하지 않는 초대라면 이 이메일을 무시하세요.
    </p>
  </div>
</body>
</html>`,
            },
            Text: {
              Data: `${orgName} 팀에 ${role} 역할로 초대되었습니다.\n\n초대 수락: ${inviteUrl}\n\n이 링크는 7일 후 만료됩니다.`,
            },
          },
        },
      }));
    } catch (sesErr) {
      emailSent = false;
      console.warn('[team/invite] SES send failed (sandbox mode?):', (sesErr as Error).message);
    }

    return c.json({ invitationId, email, role, inviteUrl, emailSent }, 201);
  },
);

// POST /team/accept-invite — authenticated
teamRouter.post(
  '/accept-invite',
  zValidator('json', acceptInviteSchema),
  async (c) => {
    const claims = extractClaims(c)!;
    const userId = claims.sub;
    const userEmail = claims.email;
    const { invitationId } = c.req.valid('json');
    const now = new Date().toISOString();

    const result = await ddbQuery<{
      PK: string;
      SK: string;
      invitationId: string;
      orgId: string;
      orgName: string;
      email: string;
      role: string;
      status: string;
      ttl: number;
    }>({
      TableName: Config.tableName('OrgInvitations'),
      IndexName: 'GSI2-invitationId-index',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': `INVITATION#${invitationId}` },
      Limit: 1,
    });

    const invite = result.items[0];
    if (!invite) return c.json({ error: 'INVITATION_NOT_FOUND' }, 404);
    if (invite.status !== 'PENDING') return c.json({ error: 'INVITATION_ALREADY_USED' }, 410);
    if (invite.ttl < Math.floor(Date.now() / 1000)) return c.json({ error: 'INVITATION_EXPIRED' }, 410);
    if (invite.email.toLowerCase() !== userEmail?.toLowerCase()) {
      return c.json({ error: 'EMAIL_MISMATCH' }, 403);
    }

    const { orgId, role } = invite;
    const userPoolId = process.env['COGNITO_USER_POOL_ID']!;

    // Update user in DynamoDB
    await ddbUpdate({
      TableName: Config.tableName('Users'),
      Key: { PK: `USER#${userId}`, SK: 'METADATA' },
      UpdateExpression: 'SET orgId = :orgId, #role = :role, #status = :active, updatedAt = :now, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk',
      ExpressionAttributeNames: { '#role': 'role', '#status': 'status' },
      ExpressionAttributeValues: {
        ':orgId': orgId,
        ':role': role,
        ':active': 'ACTIVE',
        ':now': now,
        ':gsi1pk': `ORG#${orgId}`,
        ':gsi1sk': `USER#${userId}`,
      },
    });

    // Update Cognito attributes
    const cognitoUsername = claims['cognito:username'] as string ?? userEmail;
    await cognito.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: userPoolId,
      Username: cognitoUsername,
      UserAttributes: [
        { Name: 'custom:orgId', Value: orgId },
        { Name: 'custom:role', Value: role },
        { Name: 'custom:onboardingCompleted', Value: 'true' },
      ],
    }));
    await cognito.send(new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: cognitoUsername,
      GroupName: role,
    }));

    // Mark invitation as accepted
    await ddbUpdate({
      TableName: Config.tableName('OrgInvitations'),
      Key: { PK: invite.PK, SK: invite.SK },
      UpdateExpression: 'SET #status = :used, acceptedBy = :uid, acceptedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':used': 'ACCEPTED', ':uid': userId, ':now': now },
    });

    return c.json({ orgId, role });
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
      ExpressionAttributeValues: { ':role': role, ':now': now, ':orgId': orgId },
      ConditionExpression: 'orgId = :orgId',
    });

    if (userPoolId) {
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
