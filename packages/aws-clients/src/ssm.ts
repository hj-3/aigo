import { SSMClient, GetParameterCommand, PutParameterCommand, DeleteParameterCommand } from '@aws-sdk/client-ssm';
import { Config } from './config.js';

let _client: SSMClient | undefined;

function getSsmClient(): SSMClient {
  if (!_client) {
    _client = new SSMClient({ region: Config.region });
  }
  return _client;
}

export async function ssmGetParameter(name: string): Promise<string | undefined> {
  const result = await getSsmClient().send(
    new GetParameterCommand({ Name: name, WithDecryption: true }),
  );
  return result.Parameter?.Value;
}

export async function ssmPutParameter(
  name: string,
  value: string,
  type: 'String' | 'SecureString' = 'SecureString',
  description?: string,
): Promise<void> {
  await getSsmClient().send(
    new PutParameterCommand({
      Name: name,
      Value: value,
      Type: type,
      Overwrite: true,
      ...(description && { Description: description }),
    }),
  );
}

export async function ssmDeleteParameter(name: string): Promise<void> {
  await getSsmClient().send(new DeleteParameterCommand({ Name: name }));
}
