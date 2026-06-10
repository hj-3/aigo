"""
Heavy worker entry point — processes fix-queue messages from ECS Fargate.
Each invocation handles a single FixRequest end-to-end:
  1. Fetch fix metadata from DynamoDB
  2. Get patch content from S3 (produced by Fix Agent)
  3. Clone the repository
  4. Apply patch
  5. Push fix branch
  6. Create Fix PR on GitHub
  7. Update FixRequest status in DynamoDB
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any, cast

import boto3
import structlog

from .config import get_config
from .github_client import (
    create_fix_pr,
    get_installation_token,
    push_fix_branch,
)
from .patch_applier import apply_patch, commit_changes
from .repo_cloner import cleanup_repo, clone_repo

logger = structlog.get_logger(__name__)


def utcnow() -> str:
    return datetime.now(UTC).isoformat()


def run() -> None:
    """Entry point for ECS task. Reads fix request from SQS via polling."""
    config = get_config()
    sqs = boto3.client("sqs", region_name=config.aws_region)

    logger.info("Heavy worker started, polling SQS", queue=config.sqs_fix_queue_url)

    while True:
        response = sqs.receive_message(
            QueueUrl=config.sqs_fix_queue_url,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=20,
            VisibilityTimeout=900,  # 15 min — matches max ECS task runtime for single job
        )

        messages = response.get("Messages", [])
        if not messages:
            logger.debug("No messages, continuing poll")
            continue

        message = messages[0]
        receipt_handle = message.get("ReceiptHandle", "")

        try:
            body = json.loads(message.get("Body", "{}"))
            process_fix_request(body)
            sqs.delete_message(QueueUrl=config.sqs_fix_queue_url, ReceiptHandle=receipt_handle)
        except Exception:
            logger.exception("Failed to process fix request", message_id=message.get("MessageId"))
            # Message becomes visible again after VisibilityTimeout, will retry up to DLQ maxReceiveCount


def process_fix_request(message: dict) -> None:
    config = get_config()
    fix_id = message["fixId"]
    job_id = message["jobId"]
    org_id = message["orgId"]
    repo_id = message["repoId"]

    log = logger.bind(fix_id=fix_id, job_id=job_id, org_id=org_id, repo_id=repo_id)
    log.info("Processing fix request")

    ddb_resource = boto3.resource("dynamodb", region_name=config.aws_region)
    s3 = boto3.client("s3", region_name=config.aws_region)

    # ── 1. Fetch FixRequest from DynamoDB ─────────────────────────────────────
    fix_table = ddb_resource.Table(config.table("FixRequests"))
    fix_item = fix_table.get_item(Key={"PK": f"FIX#{fix_id}", "SK": "METADATA"}).get("Item")
    if not fix_item:
        raise ValueError(f"FixRequest not found: {fix_id}")

    # ── 2. Fetch Repository record ─────────────────────────────────────────────
    repo_table = ddb_resource.Table(config.table("Repositories"))
    repo_item = repo_table.get_item(Key={"PK": f"REPO#{repo_id}", "SK": "METADATA"}).get("Item")
    if not repo_item:
        raise ValueError(f"Repository not found: {repo_id}")

    repo_full_name: str = cast(str, repo_item["providerRepoFullName"])
    default_branch: str = cast(str, repo_item.get("defaultBranch", "main"))

    # ── 3. Fetch patch content from S3 ────────────────────────────────────────
    patch_s3_key = fix_item.get("patchS3Key")
    if not patch_s3_key:
        raise ValueError(f"No patchS3Key on FixRequest {fix_id}")

    patch_object = s3.get_object(Bucket=config.s3_patches_bucket, Key=cast(str, patch_s3_key))
    patch_content = patch_object["Body"].read().decode("utf-8")
    log.info("Patch content fetched", key=patch_s3_key, size=len(patch_content))

    # ── 4. Get GitHub installation token ─────────────────────────────────────
    access_token = get_installation_token(repo_full_name)

    # ── 5. Clone repository ───────────────────────────────────────────────────
    repo_dir = clone_repo(repo_full_name, access_token, default_branch)

    try:
        # ── 6. Apply patch ────────────────────────────────────────────────────
        result = apply_patch(repo_dir, patch_content)
        if not result.success:
            _fail_fix_request(fix_table, fix_id, f"Patch apply failed: {result.error}", org_id)
            return

        # ── 7. Commit changes ─────────────────────────────────────────────────
        fix_branch_name = f"aigo/fix-{fix_id[:8].lower()}"
        commit_sha = commit_changes(
            repo_dir,
            commit_message=(
                f"fix: apply AgentOps automated fix [{fix_id}]\n\n"
                f"Applied by AgentOps Platform Fix Agent.\n"
                f"Fix request: {fix_id}\nAffected files: {', '.join(result.applied_files)}"
            ),
            author_name="AgentOps Bot",
            author_email="agentops-bot@noreply.github.com",
        )
        log.info("Changes committed", sha=commit_sha, branch=fix_branch_name)

        # ── 8. Push fix branch ────────────────────────────────────────────────
        push_fix_branch(str(repo_dir), fix_branch_name, access_token, repo_full_name)

        # ── 9. Create Fix PR ──────────────────────────────────────────────────
        pr_title = f"[AgentOps Fix] Automated fix for report {fix_item.get('reportId', '')}"
        pr_body = _build_pr_body(fix_item, result.applied_files, commit_sha)
        pr_url = create_fix_pr(
            repo_full_name=repo_full_name,
            fix_branch_name=fix_branch_name,
            base_branch=default_branch,
            title=pr_title,
            body=pr_body,
            access_token=access_token,
        )

        # ── 10. Update FixRequest to COMPLETED ────────────────────────────────
        now = utcnow()
        fix_table.update_item(
            Key={"PK": f"FIX#{fix_id}", "SK": "METADATA"},
            UpdateExpression=(
                "SET #status = :status, fixPrUrl = :prUrl, fixBranch = :branch,"
                " commitSha = :sha, appliedFiles = :files,"
                " completedAt = :now, updatedAt = :now, GSI2PK = :gsi2pk"
            ),
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": "COMPLETED",
                ":prUrl": pr_url,
                ":branch": fix_branch_name,
                ":sha": commit_sha,
                ":files": result.applied_files,
                ":now": now,
                ":gsi2pk": f"ORG#{org_id}#COMPLETED",
            },
        )
        log.info("Fix request completed", pr_url=pr_url)

    finally:
        cleanup_repo(repo_dir)


def _fail_fix_request(fix_table: Any, fix_id: str, error: str, org_id: str) -> None:
    now = utcnow()
    fix_table.update_item(
        Key={"PK": f"FIX#{fix_id}", "SK": "METADATA"},
        UpdateExpression="SET #status = :status, errorMessage = :error, updatedAt = :now, GSI2PK = :gsi2pk",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": "FAILED",
            ":error": error,
            ":now": now,
            ":gsi2pk": f"ORG#{org_id}#FAILED",
        },
    )
    logger.error("Fix request failed", fix_id=fix_id, error=error)


def _build_pr_body(fix_item: dict, applied_files: list[str], commit_sha: str) -> str:
    return f"""## AgentOps Automated Fix

This Pull Request was created automatically by the **AgentOps Platform** Fix Agent.

| Field | Value |
|-------|-------|
| Fix Request ID | `{fix_item.get("fixId", "")}` |
| Report ID | `{fix_item.get("reportId", "")}` |
| Requested By | `{fix_item.get("requestedBy", "")}` |
| Commit SHA | `{commit_sha[:8]}` |

### Changed Files
{chr(10).join(f"- `{f}`" for f in applied_files)}

### Notes
- This fix was generated by an AI agent and should be reviewed before merging.
- The fix addresses findings identified in the analysis report.
- Please verify the changes do not introduce new issues.

---
*Generated by [AgentOps Platform](https://github.com/your-org/aigo)*
"""
