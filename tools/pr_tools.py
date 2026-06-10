"""
PR Tools — read PR diffs and file contents from S3.
Agents use these to access code without direct GitHub access.
"""
from __future__ import annotations

import os

import boto3
import structlog
from strands import tool

logger = structlog.get_logger(__name__)


def _s3() -> boto3.client:
    return boto3.client("s3", region_name=os.environ.get("AWS_REGION", "ap-northeast-2"))


def _diffs_bucket() -> str:
    v = os.environ.get("S3_DIFFS_BUCKET")
    if not v:
        raise RuntimeError("S3_DIFFS_BUCKET not set")
    return v


def _artifacts_bucket() -> str:
    v = os.environ.get("S3_ARTIFACTS_BUCKET")
    if not v:
        raise RuntimeError("S3_ARTIFACTS_BUCKET not set")
    return v


@tool
def get_diff_content(diff_s3_key: str) -> str:
    """
    Retrieves the full unified diff content for a PR from S3.

    Args:
        diff_s3_key: S3 key of the diff file (e.g., diffs/org123/repo456/pr-7/abc123.diff)

    Returns:
        Full unified diff content as a string
    """
    logger.info("Fetching diff", key=diff_s3_key)
    try:
        obj = _s3().get_object(Bucket=_diffs_bucket(), Key=diff_s3_key)
        content = obj["Body"].read().decode("utf-8")
        logger.info("Diff fetched", key=diff_s3_key, size=len(content))
        return content
    except Exception as e:
        logger.error("Failed to fetch diff", key=diff_s3_key, error=str(e))
        return f"ERROR: Could not fetch diff: {e}"


@tool
def get_file_content(repo_id: str, commit_sha: str, file_path: str) -> str:
    """
    Retrieves the full content of a specific file at a specific commit from S3 artifacts.

    Args:
        repo_id: Repository ID
        commit_sha: Git commit SHA
        file_path: Path within the repository (e.g., src/index.ts)

    Returns:
        File content as a string, or an error message
    """
    s3_key = f"artifacts/{repo_id}/{commit_sha}/{file_path}"
    logger.info("Fetching file content", key=s3_key)
    try:
        obj = _s3().get_object(Bucket=_artifacts_bucket(), Key=s3_key)
        return obj["Body"].read().decode("utf-8")
    except Exception as e:
        logger.warning("File not found in artifacts", key=s3_key, error=str(e))
        return f"ERROR: File not available: {file_path}"
