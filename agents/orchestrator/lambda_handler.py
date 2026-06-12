"""
Orchestrator Lambda entry point.
Receives job input from lightweight-worker, fetches PR diff from S3,
then runs the Strands orchestrator agent.
"""

from __future__ import annotations

import json
import os
import sys

# Tools are co-located under /var/task/tools at runtime
sys.path.insert(0, "/var/task")
sys.path.insert(0, "/var/task/tools")

import boto3
import structlog

logger = structlog.get_logger(__name__)

# Diff truncation: Claude 3.5 Sonnet has 200K context; 30K chars ≈ 7500 tokens
MAX_DIFF_CHARS = 30_000


def handler(event: dict, context: object) -> dict:
    job_id = event.get("jobId", "unknown")
    log = logger.bind(job_id=job_id)

    try:
        log.info("Orchestrator Lambda invoked")
        job_input = _enrich_with_diff(event)

        from src.agent import run_analysis  # noqa: PLC0415

        result = run_analysis(job_input)
        log.info("Orchestrator completed successfully")
        return {"statusCode": 200, "body": json.dumps(result)}

    except Exception as exc:
        log.exception("Orchestrator Lambda failed", error=str(exc))
        _mark_failed(job_id, str(exc))
        return {"statusCode": 500, "body": json.dumps({"error": str(exc), "jobId": job_id})}


def _enrich_with_diff(job_input: dict) -> dict:
    """Fetch the PR diff from S3 and embed it in the job input."""
    diff_meta = job_input.get("diffMetadata", {})
    s3_key = diff_meta.get("s3Key")
    s3_bucket = diff_meta.get("s3Bucket") or os.environ.get("S3_DIFFS_BUCKET", "aigo-diffs")

    if not s3_key:
        logger.warning("No diffS3Key in job input — proceeding without diff")
        return {**job_input, "diffContent": ""}

    try:
        s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "ap-northeast-2"))
        obj = s3.get_object(Bucket=s3_bucket, Key=s3_key)
        diff_content = obj["Body"].read().decode("utf-8")
        truncated = diff_content[:MAX_DIFF_CHARS]
        if len(diff_content) > MAX_DIFF_CHARS:
            truncated += f"\n\n[...diff truncated at {MAX_DIFF_CHARS} chars, {len(diff_content)} total...]"
        logger.info("Diff fetched", s3_key=s3_key, size=len(diff_content))
        return {**job_input, "diffContent": truncated}
    except Exception as exc:
        logger.warning("Failed to fetch diff from S3", s3_key=s3_key, error=str(exc))
        return {**job_input, "diffContent": ""}


def _mark_failed(job_id: str, error_message: str) -> None:
    try:
        import boto3 as b3  # noqa: PLC0415

        ddb = b3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "ap-northeast-2"))
        prefix = os.environ.get("DYNAMODB_TABLE_PREFIX", "aigo")
        table = ddb.Table(f"{prefix}-AnalysisJobs")
        from datetime import UTC, datetime  # noqa: PLC0415

        table.update_item(
            Key={"PK": f"JOB#{job_id}", "SK": "METADATA"},
            UpdateExpression="SET #status = :status, updatedAt = :now, errorMessage = :err",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": "FAILED",
                ":now": datetime.now(UTC).isoformat(),
                ":err": error_message[:2000],
            },
        )
    except Exception:
        pass  # Best effort — don't mask the original error
