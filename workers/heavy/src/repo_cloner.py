import shutil
from pathlib import Path

import git
import structlog

from .config import get_config

logger = structlog.get_logger(__name__)


def clone_repo(repo_full_name: str, access_token: str, target_branch: str) -> Path:
    """
    Shallow clone the repository at the target branch into a temp directory.
    Returns the path to the cloned repo.
    """
    config = get_config()
    workspace = Path(config.clone_workspace)
    workspace.mkdir(parents=True, exist_ok=True)

    repo_dir = workspace / repo_full_name.replace("/", "_")
    if repo_dir.exists():
        shutil.rmtree(repo_dir)

    clone_url = f"https://x-access-token:{access_token}@github.com/{repo_full_name}.git"

    logger.info("Cloning repository", repo=repo_full_name, branch=target_branch)
    git.Repo.clone_from(
        clone_url,
        str(repo_dir),
        branch=target_branch,
        depth=50,  # shallow clone for speed
        single_branch=True,
    )

    logger.info("Clone complete", repo=repo_full_name, path=str(repo_dir))
    return repo_dir


def cleanup_repo(repo_dir: Path) -> None:
    if repo_dir.exists():
        shutil.rmtree(repo_dir, ignore_errors=True)
        logger.info("Cleaned up repo dir", path=str(repo_dir))
