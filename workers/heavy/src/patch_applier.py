import subprocess
from pathlib import Path
from typing import NamedTuple

import structlog

logger = structlog.get_logger(__name__)


class PatchResult(NamedTuple):
    success: bool
    applied_files: list[str]
    rejected_files: list[str]
    error: str | None


def apply_patch(repo_dir: Path, patch_content: str) -> PatchResult:
    """
    Applies a unified diff patch to the repository using git apply.
    Returns which files were patched and which were rejected.
    """
    patch_file = repo_dir / ".aigo_patch.diff"
    try:
        patch_file.write_text(patch_content, encoding="utf-8")

        # Dry run first
        dry_run = subprocess.run(
            ["git", "apply", "--check", "--whitespace=fix", str(patch_file)],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
            timeout=30,
        )

        if dry_run.returncode != 0:
            logger.warning("Patch check failed", stderr=dry_run.stderr)
            return PatchResult(
                success=False,
                applied_files=[],
                rejected_files=_extract_file_names(dry_run.stderr),
                error=dry_run.stderr,
            )

        # Apply
        apply = subprocess.run(
            ["git", "apply", "--whitespace=fix", str(patch_file)],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
            timeout=60,
        )

        if apply.returncode != 0:
            return PatchResult(
                success=False,
                applied_files=[],
                rejected_files=_extract_file_names(apply.stderr),
                error=apply.stderr,
            )

        # Get list of changed files
        diff = subprocess.run(
            ["git", "diff", "--name-only"],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
            timeout=10,
        )

        applied = diff.stdout.strip().splitlines()
        logger.info("Patch applied successfully", file_count=len(applied))
        return PatchResult(success=True, applied_files=applied, rejected_files=[], error=None)

    finally:
        patch_file.unlink(missing_ok=True)


def _extract_file_names(output: str) -> list[str]:
    files = []
    for line in output.splitlines():
        if "error:" in line and "patch" in line:
            parts = line.split(":")
            if len(parts) >= 2:
                files.append(parts[1].strip())
    return files


def commit_changes(repo_dir: Path, commit_message: str, author_name: str, author_email: str) -> str:
    """Stages all changes and creates a commit. Returns the commit SHA."""
    subprocess.run(["git", "add", "-A"], cwd=str(repo_dir), check=True, timeout=30)

    env = {
        "GIT_AUTHOR_NAME": author_name,
        "GIT_AUTHOR_EMAIL": author_email,
        "GIT_COMMITTER_NAME": author_name,
        "GIT_COMMITTER_EMAIL": author_email,
    }
    subprocess.run(
        ["git", "commit", "-m", commit_message],
        cwd=str(repo_dir),
        check=True,
        timeout=30,
        env={**__import__("os").environ, **env},
    )

    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=str(repo_dir),
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    )
    return result.stdout.strip()
