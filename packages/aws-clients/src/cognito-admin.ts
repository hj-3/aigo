import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  type AttributeType,
} from '@aws-sdk/client-cognito-identity-provider';
import { Config } from './config.js';

let _client: CognitoIdentityProviderClient | undefined;

function getCognitoClient(): CognitoIdentityProviderClient {
  if (!_client) {
    _client = new CognitoIdentityProviderClient({ region: Config.region });
  }
  return _client;
}

export async function cognitoAdminUpdateAttributes(
  userPoolId: string,
  username: string,
  attributes: Record<string, string>,
): Promise<void> {
  const userAttributes: AttributeType[] = Object.entries(attributes).map(([Name, Value]) => ({
    Name,
    Value,
  }));
  await getCognitoClient().send(
    new AdminUpdateUserAttributesCommand({ UserPoolId: userPoolId, Username: username, UserAttributes: userAttributes }),
  );
}

export async function cognitoAdminAddToGroup(
  userPoolId: string,
  username: string,
  groupName: string,
): Promise<void> {
  await getCognitoClient().send(
    new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: groupName }),
  );
}

export async function cognitoAdminGetUser(
  userPoolId: string,
  username: string,
): Promise<Record<string, string>> {
  const result = await getCognitoClient().send(
    new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }),
  );
  return Object.fromEntries(
    (result.UserAttributes ?? []).map((a) => [a.Name ?? '', a.Value ?? '']),
  );
}
