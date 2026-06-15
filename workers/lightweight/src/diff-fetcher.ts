import { getSecretJson } from '@aigo/aws-clients';
import { getLogger } from '@aigo/logger';
import { createOctokitWithInstallation } from './github-auth.js';

const logger = getLogger('diff-fetcher');

export interface PrContext {
  readonly prNumber: number;
  readonly commitSha: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly authorLogin: string;
  readonly prUrl: string;
  readonly prTitle: string;
  readonly diffS3Key: string;
}

export interface FetchedDiff {
  readonly diffContent: string;
  readonly changedFiles: string[];
  readonly additions: number;
  readonly deletions: number;
  readonly commitMessages: string[];
}

export async function fetchAndStorePrDiff(
  repoFullName: string,
  prContext: PrContext,
  _orgId: string,
  installationId?: string,
): Promise<FetchedDiff> {
  const githubSecretArn = process.env['GITHUB_SECRET_ARN']!;
  const credentials = await getSecretJson<{
    appId: string;
    privateKey: string;
    installationId: string;
  }>(githubSecretArn);

  // Use per-org installationId if provided; fall back to global credentials
  const effectiveInstallationId = installationId ?? credentials.installationId;
  const octokit = await createOctokitWithInstallation({
    ...credentials,
    installationId: effectiveInstallationId,
  });

  const [owner, repo] = repoFullName.split('/') as [string, string];

  // Fetch PR diff
  const { data: diffData } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prContext.prNumber,
    mediaType: { format: 'diff' },
  });

  const diffContent = typeof diffData === 'string' ? diffData : JSON.stringify(diffData);

  // Fetch PR files list for metadata
  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: prContext.prNumber,
    per_page: 100,
  });

  // Fetch commit messages
  const { data: commits } = await octokit.pulls.listCommits({
    owner,
    repo,
    pull_number: prContext.prNumber,
    per_page: 50,
  });

  const additions = files.reduce((sum, f) => sum + f.additions, 0);
  const deletions = files.reduce((sum, f) => sum + f.deletions, 0);

  logger.info('PR diff fetched', {
    prNumber: prContext.prNumber,
    fileCount: files.length,
    additions,
    deletions,
    installationId: effectiveInstallationId,
  });

  return {
    diffContent,
    changedFiles: files.map((f) => f.filename),
    additions,
    deletions,
    commitMessages: commits.map((c) => c.commit.message),
  };
}
