import json

import boto3
import structlog
from github import Github, GithubIntegration

from .config import get_config

logger = structlog.get_logger(__name__)


def _get_github_credentials() -> dict:
    config = get_config()
    client = boto3.client("secretsmanager", region_name=config.aws_region)
    response = client.get_secret_value(SecretId=config.github_secret_arn)
    return json.loads(response["SecretString"])


def get_installation_token(repo_full_name: str) -> str:
    """Gets a GitHub App installation access token for a specific repository."""
    creds = _get_github_credentials()
    integration = GithubIntegration(
        integration_id=int(creds["appId"]),
        private_key=creds["privateKey"],
    )
    installation = integration.get_repo_installation(*repo_full_name.split("/", 1))
    return integration.get_access_token(installation.id).token


def create_fix_branch(
    repo_full_name: str,
    base_branch: str,
    fix_branch_name: str,
    access_token: str,
) -> None:
    g = Github(access_token)
    repo = g.get_repo(repo_full_name)
    base_ref = repo.get_branch(base_branch)
    repo.create_git_ref(ref=f"refs/heads/{fix_branch_name}", sha=base_ref.commit.sha)
    logger.info("Fix branch created", branch=fix_branch_name, repo=repo_full_name)


def push_fix_branch(repo_dir_path: str, fix_branch_name: str, access_token: str, repo_full_name: str) -> None:
    import subprocess

    remote_url = f"https://x-access-token:{access_token}@github.com/{repo_full_name}.git"
    subprocess.run(
        ["git", "remote", "set-url", "origin", remote_url],
        cwd=repo_dir_path,
        check=True,
        timeout=10,
    )
    subprocess.run(
        ["git", "push", "origin", fix_branch_name],
        cwd=repo_dir_path,
        check=True,
        timeout=120,
    )
    logger.info("Fix branch pushed", branch=fix_branch_name)


def create_fix_pr(
    repo_full_name: str,
    fix_branch_name: str,
    base_branch: str,
    title: str,
    body: str,
    access_token: str,
) -> str:
    """Creates the Fix PR and returns its URL."""
    g = Github(access_token)
    repo = g.get_repo(repo_full_name)
    pr = repo.create_pull(
        title=title,
        body=body,
        head=fix_branch_name,
        base=base_branch,
        draft=False,
    )
    logger.info("Fix PR created", pr_url=pr.html_url, pr_number=pr.number)
    return pr.html_url
