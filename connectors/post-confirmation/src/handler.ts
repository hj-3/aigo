import type { PostConfirmationTriggerHandler } from 'aws-lambda';
import { ddbPut, Config } from '@aigo/aws-clients';
import { createContextLogger } from '@aigo/logger';
import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({
  region: process.env['AWS_REGION'] ?? 'ap-northeast-2',
});

const ULID_PLACEHOLDER = (): string => {
  return Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 9).toUpperCase();
};

export const handler: PostConfirmationTriggerHandler = async (event) => {
  const logger = createContextLogger({ source: 'post-confirmation', sub: event.userName });

  const { userPoolId, userName, request } = event;
  const userAttributes = request.userAttributes;

  const email = userAttributes['email'];
  const name = userAttributes['name'] ?? email.split('@')[0];
  const userId = userAttributes['sub'];

  if (!email || !userId) {
    logger.error('Missing required user attributes', { email, userId });
    throw new Error('Missing required user attributes');
  }

  const now = new Date().toISOString();

  // ── 1. Create Users record ─────────────────────────────────────────────────
  await ddbPut({
    TableName: Config.tableName('Users'),
    Item: {
      PK: `USER#${userId}`,
      SK: 'METADATA',
      userId,
      email,
      name,
      role: 'OWNER',
      status: 'ACTIVE',
      cognitoUsername: userName,
      onboardingCompleted: false,
      createdAt: now,
      updatedAt: now,
    },
    ConditionExpression: 'attribute_not_exists(PK)',
  });

  // ── 2. Add user to OWNER Cognito group ────────────────────────────────────
  try {
    await cognito.send(new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: userName,
      GroupName: 'OWNER',
    }));
  } catch (err) {
    logger.warn('Failed to add user to OWNER group', { error: String(err) });
  }

  logger.info('User created after confirmation', { userId, email });

  return event;
};
