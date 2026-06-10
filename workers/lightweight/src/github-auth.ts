import { Octokit } from '@octokit/rest';
import { createSign } from 'node:crypto';

interface GithubAppCreds {
  readonly appId: string;
  readonly privateKey: string;
  readonly installationId: string;
}

function createJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }),
  ).toString('base64url');

  const signing = `${header}.${payload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(signing);
  sign.end();
  const signature = sign.sign(privateKey, 'base64url');

  return `${signing}.${signature}`;
}

export async function createOctokitWithInstallation(creds: GithubAppCreds): Promise<Octokit> {
  const jwt = createJwt(creds.appId, creds.privateKey);

  // Get installation access token
  const res = await fetch(
    `https://api.github.com/app/installations/${creds.installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!res.ok) {
    throw new Error(`GitHub App token request failed: ${res.status}`);
  }

  const { token } = (await res.json()) as { token: string };
  return new Octokit({ auth: token });
}
