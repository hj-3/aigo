import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { Config } from './config.js';

let _client: SecretsManagerClient | undefined;

function getSecretsClient(): SecretsManagerClient {
  if (!_client) {
    _client = new SecretsManagerClient({ region: Config.region });
  }
  return _client;
}

const _cache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getSecret(secretArn: string): Promise<string> {
  const cached = _cache.get(secretArn);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const result = await getSecretsClient().send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );

  const value = result.SecretString ?? '';
  if (!value) throw new Error(`Secret has no string value: ${secretArn}`);

  _cache.set(secretArn, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function getSecretJson<T = Record<string, unknown>>(
  secretArn: string,
): Promise<T> {
  const raw = await getSecret(secretArn);
  return JSON.parse(raw) as T;
}

export { GetSecretValueCommand };
