"""
DynamoDB Tools — persist agent findings, reports, and status updates.
All DynamoDB writes go through these tools to maintain auditability.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from typing import Any

import boto3
import structlog
from strands import tool

logger = structlog.get_logger(__name__)


def _ddb():
    return boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "ap-northeast-2"))


def _prefix() -> str:
    return os.environ.get("DYNAMODB_TABLE_PREFIX", "aigo")


def _table(name: str):
    return _ddb().Table(f"{_prefix()}-{name}")


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


@tool
def save_findings(job_id: str, agent_name: str, findings: list[dict[str, Any]]) -> str:
    """
    Saves agent findings to the Findings DynamoDB table.

    Args:
        job_id: The analysis job ID
        agent_name: Name of the agent producing these findings (e.g., 'code-reviewer')
        findings: List of findings, each with: severity, category, location, description, fixable, fix_suggestion

    Returns:
        Confirmation with count of saved findings
    """
    table = _table("Findings")
    now = _utcnow()
    saved = 0

    for finding in findings:
        finding_id = f"{job_id}-{agent_name}-{saved:04d}"
        item = {
            "PK": f"FINDING#{finding_id}",
            "SK": "METADATA",
            "findingId": finding_id,
            "jobId": job_id,
            "agentName": agent_name,
            "severity": finding.get("severity", "MEDIUM"),
            "category": finding.get("category", "OTHER"),
            "location": finding.get("location", {}),
            "description": finding.get("description", ""),
            "confidence": finding.get("confidence", 0.8),
            "fixable": finding.get("fixable", False),
            "fixSuggestion": finding.get("fix_suggestion"),
            "createdAt": now,
            "GSI1PK": f"JOB#{job_id}",
            "GSI1SK": f"{finding.get('severity', 'MEDIUM')}#{now}",
        }
        table.put_item(Item=item)
        saved += 1

    logger.info("Findings saved", job_id=job_id, agent=agent_name, count=saved)
    return f"Saved {saved} findings for job {job_id}"


@tool
def save_report(
    job_id: str,
    org_id: str,
    repo_id: str,
    risk_level: str,
    merge_recommendation: str,
    summary: str,
    findings_by_severity: dict[str, int],
    report_s3_key: str | None = None,
) -> str:
    """
    Saves the consolidated analysis report to DynamoDB.

    Args:
        job_id: The analysis job ID
        org_id: Organization ID
        repo_id: Repository ID
        risk_level: CRITICAL | HIGH | MEDIUM | LOW
        merge_recommendation: APPROVE | REQUEST_CHANGES | BLOCK
        summary: Human-readable summary of the analysis
        findings_by_severity: Dict of severity → count
        report_s3_key: Optional S3 key for full report JSON

    Returns:
        The generated report ID
    """
    report_id = f"{job_id}-report"
    now = _utcnow()

    table = _table("Reports")
    table.put_item(
        Item={
            "PK": f"REPORT#{report_id}",
            "SK": "METADATA",
            "reportId": report_id,
            "jobId": job_id,
            "orgId": org_id,
            "repoId": repo_id,
            "riskLevel": risk_level,
            "mergeRecommendation": merge_recommendation,
            "approvalStatus": "PENDING",
            "summary": summary,
            "findingsBySeverity": findings_by_severity,
            "reportS3Key": report_s3_key,
            "createdAt": now,
            "updatedAt": now,
            "GSI1PK": f"ORG#{org_id}",
            "GSI1SK": now,
            "GSI2PK": f"REPO#{repo_id}",
            "GSI2SK": now,
        }
    )

    # Update job to link report
    _table("AnalysisJobs").update_item(
        Key={"PK": f"JOB#{job_id}", "SK": "METADATA"},
        UpdateExpression="SET reportId = :rid, #status = :status, updatedAt = :now",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={":rid": report_id, ":status": "COMPLETED", ":now": now},
    )

    logger.info("Report saved", report_id=report_id, risk_level=risk_level)
    return report_id


@tool
def update_job_status(job_id: str, status: str, error_message: str | None = None) -> str:
    """
    Updates the status of an AnalysisJob.

    Args:
        job_id: The analysis job ID
        status: New status: IN_PROGRESS | COMPLETED | FAILED
        error_message: Optional error message if status is FAILED

    Returns:
        Confirmation string
    """
    now = _utcnow()
    update_expr = "SET #status = :status, updatedAt = :now"
    values: dict[str, Any] = {":status": status, ":now": now}

    if error_message:
        update_expr += ", errorMessage = :err"
        values[":err"] = error_message

    _table("AnalysisJobs").update_item(
        Key={"PK": f"JOB#{job_id}", "SK": "METADATA"},
        UpdateExpression=update_expr,
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues=values,
    )
    logger.info("Job status updated", job_id=job_id, status=status)
    return f"Job {job_id} updated to {status}"


@tool
def update_incident(
    incident_id: str,
    status: str,
    root_cause: str | None = None,
    mitigation: str | None = None,
    investigation_notes: str | None = None,
) -> str:
    """
    Updates an incident record with investigation findings.

    Args:
        incident_id: The incident ID
        status: OPEN | INVESTIGATING | MITIGATED | RESOLVED
        root_cause: Description of the root cause
        mitigation: Steps taken to mitigate the incident
        investigation_notes: Detailed investigation notes

    Returns:
        Confirmation string
    """
    now = _utcnow()
    update_expr = "SET #status = :status, updatedAt = :now"
    values: dict[str, Any] = {":status": status, ":now": now}

    if root_cause:
        update_expr += ", rootCause = :rc"
        values[":rc"] = root_cause
    if mitigation:
        update_expr += ", mitigation = :mit"
        values[":mit"] = mitigation
    if investigation_notes:
        update_expr += ", investigationNotes = :notes"
        values[":notes"] = investigation_notes

    _table("Incidents").update_item(
        Key={"PK": f"INCIDENT#{incident_id}", "SK": "METADATA"},
        UpdateExpression=update_expr,
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues=values,
    )
    logger.info("Incident updated", incident_id=incident_id, status=status)
    return f"Incident {incident_id} updated to {status}"


@tool
def update_fix_request(fix_id: str, status: str, patch_s3_key: str | None = None, error: str | None = None) -> str:
    """
    Updates a FixRequest record with patch location or failure details.

    Args:
        fix_id: The fix request ID
        status: PENDING | IN_PROGRESS | PATCH_READY | FAILED
        patch_s3_key: S3 key of the generated patch file
        error: Error message if status is FAILED

    Returns:
        Confirmation string
    """
    now = _utcnow()
    update_expr = "SET #status = :status, updatedAt = :now"
    values: dict[str, Any] = {":status": status, ":now": now}

    if patch_s3_key:
        update_expr += ", patchS3Key = :key"
        values[":key"] = patch_s3_key
    if error:
        update_expr += ", errorMessage = :err"
        values[":err"] = error

    _table("FixRequests").update_item(
        Key={"PK": f"FIX#{fix_id}", "SK": "METADATA"},
        UpdateExpression=update_expr,
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues=values,
    )
    logger.info("Fix request updated", fix_id=fix_id, status=status)
    return f"Fix request {fix_id} updated to {status}"


@tool
def get_findings_for_report(report_id: str) -> str:
    """
    Retrieves all findings associated with a report.

    Args:
        report_id: The report ID

    Returns:
        JSON string containing the list of findings
    """
    # First get the job_id from the report
    report = _table("Reports").get_item(Key={"PK": f"REPORT#{report_id}", "SK": "METADATA"}).get("Item")

    if not report:
        return json.dumps({"error": f"Report {report_id} not found"})

    job_id = report.get("jobId", "")

    # Query findings by jobId using GSI1
    response = _table("Findings").query(
        IndexName="GSI1",
        KeyConditionExpression="GSI1PK = :pk",
        ExpressionAttributeValues={":pk": f"JOB#{job_id}"},
    )

    findings = response.get("Items", [])
    logger.info("Findings retrieved", report_id=report_id, count=len(findings))
    return json.dumps(findings, default=str)
