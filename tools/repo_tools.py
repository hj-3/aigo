"""
Repo Tools — inspect repository metadata, dependency graphs, and deployment history.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

import boto3
import structlog
from strands import tool

logger = structlog.get_logger(__name__)


def _s3() -> boto3.client:
    return boto3.client("s3", region_name=os.environ.get("AWS_REGION", "ap-northeast-2"))


def _artifacts_bucket() -> str:
    v = os.environ.get("S3_ARTIFACTS_BUCKET")
    if not v:
        raise RuntimeError("S3_ARTIFACTS_BUCKET not set")
    return v


@tool
def get_dependency_graph(repo_id: str, commit_sha: str) -> str:
    """
    Retrieves the dependency graph for a repository at a specific commit.
    Used by Risk Reviewer to assess blast radius of dependency changes.

    Args:
        repo_id: Repository ID
        commit_sha: Git commit SHA

    Returns:
        JSON string with dependency graph (direct and transitive deps)
    """
    s3_key = f"artifacts/{repo_id}/{commit_sha}/dependency-graph.json"
    try:
        obj = _s3().get_object(Bucket=_artifacts_bucket(), Key=s3_key)
        content = obj["Body"].read().decode("utf-8")
        logger.info("Dependency graph fetched", repo_id=repo_id, sha=commit_sha[:8])
        return content
    except Exception as e:
        logger.warning("Dependency graph not available", repo_id=repo_id, error=str(e))
        return json.dumps({"error": f"Dependency graph not available: {e}"})


@tool
def get_api_schema(repo_id: str, commit_sha: str) -> str:
    """
    Retrieves the OpenAPI/GraphQL schema for a repository at a specific commit.
    Used by Risk Reviewer to detect breaking API changes.

    Args:
        repo_id: Repository ID
        commit_sha: Git commit SHA

    Returns:
        JSON string with API schema
    """
    s3_key = f"artifacts/{repo_id}/{commit_sha}/api-schema.json"
    try:
        obj = _s3().get_object(Bucket=_artifacts_bucket(), Key=s3_key)
        content = obj["Body"].read().decode("utf-8")
        logger.info("API schema fetched", repo_id=repo_id, sha=commit_sha[:8])
        return content
    except Exception as e:
        logger.warning("API schema not available", repo_id=repo_id, error=str(e))
        return json.dumps({"error": f"API schema not available: {e}"})


@tool
def get_recent_deployments(repo_id: str, limit: int = 10) -> str:
    """
    Retrieves the recent deployment history for a repository.
    Used by Incident Agent to correlate incidents with recent deployments.

    Args:
        repo_id: Repository ID
        limit: Maximum number of deployments to return (default: 10)

    Returns:
        JSON string with list of recent deployments
    """
    import boto3
    ddb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "ap-northeast-2"))
    prefix = os.environ.get("DYNAMODB_TABLE_PREFIX", "aigo")

    # Query AnalysisJobs for completed jobs (deployments) on this repo
    response = ddb.Table(f"{prefix}-AnalysisJobs").query(
        IndexName="GSI1",
        KeyConditionExpression="GSI1PK = :pk",
        ExpressionAttributeValues={":pk": f"REPO#{repo_id}"},
        ScanIndexForward=False,
        Limit=limit,
    )

    items = response.get("Items", [])
    deployments = [
        {
            "jobId": item.get("jobId"),
            "type": item.get("type"),
            "status": item.get("status"),
            "commitSha": item.get("prContext", {}).get("commitSha"),
            "branch": item.get("prContext", {}).get("headBranch"),
            "author": item.get("prContext", {}).get("authorLogin"),
            "createdAt": item.get("createdAt"),
        }
        for item in items
    ]
    logger.info("Recent deployments retrieved", repo_id=repo_id, count=len(deployments))
    return json.dumps({"repo_id": repo_id, "deployments": deployments}, default=str)
