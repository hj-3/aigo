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

    # Write AgentRun record so the dashboard can show which personas actually ran.
    # Even with 0 findings, writing this record marks the persona as invoked (not skipped).
    agent_run_table = _table("AgentRuns")
    run_id = f"{job_id}-{agent_name}"
    agent_run_table.put_item(Item={
        "PK": f"RUN#{run_id}",
        "SK": "METADATA",
        "runId": run_id,
        "jobId": job_id,
        "agentType": agent_name,
        "status": "COMPLETED",
        "findingsCount": saved,
        "completedAt": now,
        "startedAt": now,
        "GSI1PK": f"JOB#{job_id}",
        "GSI1SK": agent_name,
    })

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
    risk_score: int = 0,
    report_s3_key: str | None = None,
    pr_number: int = 0,
    pr_url: str = "",
    pr_title: str = "",
    commit_sha: str = "",
    author_login: str = "",
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
        risk_score: Numeric risk score 0-100 (CRITICAL×25 + HIGH×10 + MEDIUM×3 + LOW×1, capped at 100)
        report_s3_key: Optional S3 key for full report JSON
        pr_number: Pull Request number
        pr_url: GitHub PR URL
        pr_title: Pull Request title
        commit_sha: Head commit SHA
        author_login: GitHub username of the PR author

    Returns:
        The generated report ID
    """
    report_id = f"{job_id}-report"
    now = _utcnow()

    pr_context = {
        "prNumber": pr_number,
        "prUrl": pr_url,
        "prTitle": pr_title,
        "commitSha": commit_sha,
        "authorLogin": author_login,
    }

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
            "riskScore": risk_score,
            "mergeRecommendation": merge_recommendation,
            "approvalStatus": "PENDING",
            "summary": summary,
            "findingsBySeverity": findings_by_severity,
            "prContext": pr_context,
            "reportS3Key": report_s3_key,
            "createdAt": now,
            "updatedAt": now,
            # GSI1: by jobId
            "GSI1PK": f"JOB#{job_id}",
            "GSI1SK": now,
            # GSI2: by repoId
            "GSI2PK": f"REPO#{repo_id}",
            "GSI2SK": now,
            # GSI3: by orgId (queried by dashboard-api)
            "GSI3PK": f"ORG#{org_id}",
            "GSI3SK": f"PENDING#{now}",
        }
    )

    # Update job to COMPLETED and update GSI2PK so dashboard status queries work
    _table("AnalysisJobs").update_item(
        Key={"PK": f"JOB#{job_id}", "SK": "METADATA"},
        UpdateExpression="SET reportId = :rid, #status = :status, updatedAt = :now, GSI2PK = :gsi2pk",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":rid": report_id,
            ":status": "COMPLETED",
            ":now": now,
            ":gsi2pk": f"ORG#{org_id}#COMPLETED",
        },
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


# ═══════════════════════════════════════════════════════════════════════════
# AgentCore Memory — DynamoDB-backed long-term memory for agents
# ═══════════════════════════════════════════════════════════════════════════

@tool
def save_pr_analysis_memory(
    org_id: str,
    repo_id: str,
    repo_full_name: str,
    pr_number: int,
    author_login: str,
    risk_score: int,
    risk_level: str,
    findings_summary: dict[str, int],
    key_findings: list[str],
    merge_recommendation: str,
) -> str:
    """
    Saves a PR analysis result to long-term agent memory.
    Call this AFTER saving the report so future analyses can learn from history.

    Args:
        org_id: Organization ID
        repo_id: Repository ID
        repo_full_name: Repository full name (owner/repo)
        pr_number: Pull Request number
        author_login: GitHub username of the PR author
        risk_score: Numeric risk score 0-100
        risk_level: CRITICAL | HIGH | MEDIUM | LOW
        findings_summary: Dict of severity → count
        key_findings: Top 3-5 most important findings (short descriptions)
        merge_recommendation: APPROVE | REQUEST_CHANGES | BLOCK

    Returns:
        Confirmation string
    """
    now = _utcnow()
    pk = f"MEMORY#PR#ORG#{org_id}#REPO#{repo_id}"
    sk = now  # sorted by time

    _table("AgentMemory").put_item(Item={
        "PK": pk,
        "SK": sk,
        "memoryType": "PR_ANALYSIS",
        "orgId": org_id,
        "repoId": repo_id,
        "repoFullName": repo_full_name,
        "prNumber": pr_number,
        "authorLogin": author_login,
        "riskScore": risk_score,
        "riskLevel": risk_level,
        "findingsSummary": findings_summary,
        "keyFindings": key_findings,
        "mergeRecommendation": merge_recommendation,
        "GSI1PK": f"ORG#{org_id}#REPO#{repo_id}",
        "GSI1SK": now,
        "GSI2PK": f"ORG#{org_id}#AUTHOR#{author_login}",
        "GSI2SK": now,
        "ttl": int(datetime.now(UTC).timestamp()) + (90 * 24 * 3600),  # 90 days
    })
    logger.info("PR analysis memory saved", org_id=org_id, repo_id=repo_id, pr_number=pr_number)
    return f"Memory saved for PR #{pr_number}"


@tool
def get_repo_memory(org_id: str, repo_id: str, limit: int = 5) -> str:
    """
    Retrieves recent PR analysis memories for a repository.
    Use this BEFORE analyzing a PR to understand repo history and recurring patterns.

    Args:
        org_id: Organization ID
        repo_id: Repository ID
        limit: Number of recent analyses to retrieve (default: 5)

    Returns:
        JSON string with recent analysis summaries
    """
    response = _table("AgentMemory").query(
        IndexName="GSI1-repo-time-index",
        KeyConditionExpression="GSI1PK = :pk",
        ExpressionAttributeValues={":pk": f"ORG#{org_id}#REPO#{repo_id}"},
        ScanIndexForward=False,
        Limit=limit,
    )
    items = response.get("Items", [])
    logger.info("Repo memory retrieved", org_id=org_id, repo_id=repo_id, count=len(items))
    return json.dumps(items, default=str)


@tool
def get_developer_memory(org_id: str, author_login: str, limit: int = 10) -> str:
    """
    Retrieves recent PR analysis memories for a developer.
    Use this to identify recurring patterns in a developer's code changes.

    Args:
        org_id: Organization ID
        author_login: GitHub username of the developer
        limit: Number of recent PRs to retrieve (default: 10)

    Returns:
        JSON string with the developer's recent PR analysis history
    """
    response = _table("AgentMemory").query(
        IndexName="GSI2-author-time-index",
        KeyConditionExpression="GSI2PK = :pk",
        ExpressionAttributeValues={":pk": f"ORG#{org_id}#AUTHOR#{author_login}"},
        ScanIndexForward=False,
        Limit=limit,
    )
    items = response.get("Items", [])
    logger.info("Developer memory retrieved", org_id=org_id, author=author_login, count=len(items))
    return json.dumps(items, default=str)


@tool
def save_incident_memory(
    org_id: str,
    incident_id: str,
    service: str,
    root_cause: str,
    resolution: str,
    affected_services: list[str],
    prevention: str,
    duration_minutes: int,
) -> str:
    """
    Saves incident RCA to long-term memory for future incident pattern matching.
    Call this after an incident is RESOLVED.

    Args:
        org_id: Organization ID
        incident_id: Incident ID
        service: Primary affected service
        root_cause: Root cause description
        resolution: How the incident was resolved
        affected_services: All affected services
        prevention: Long-term prevention recommendation
        duration_minutes: How long the incident lasted

    Returns:
        Confirmation string
    """
    now = _utcnow()
    pk = f"MEMORY#INCIDENT#ORG#{org_id}#SERVICE#{service}"
    sk = now

    _table("AgentMemory").put_item(Item={
        "PK": pk,
        "SK": sk,
        "memoryType": "INCIDENT",
        "orgId": org_id,
        "incidentId": incident_id,
        "service": service,
        "rootCause": root_cause,
        "resolution": resolution,
        "affectedServices": affected_services,
        "prevention": prevention,
        "durationMinutes": duration_minutes,
        "GSI1PK": f"ORG#{org_id}#SERVICE#{service}",
        "GSI1SK": now,
        "GSI2PK": f"ORG#{org_id}#INCIDENTS",
        "GSI2SK": now,
        "ttl": int(datetime.now(UTC).timestamp()) + (365 * 24 * 3600),  # 1 year
    })
    logger.info("Incident memory saved", org_id=org_id, incident_id=incident_id, service=service)
    return f"Incident memory saved for {service}"


@tool
def get_incident_memory(org_id: str, service: str, limit: int = 5) -> str:
    """
    Retrieves past incident memories for a service.
    Use this at the START of incident investigation to find similar past incidents.

    Args:
        org_id: Organization ID
        service: Service name to look up
        limit: Number of recent incidents to retrieve

    Returns:
        JSON string with past incident summaries
    """
    response = _table("AgentMemory").query(
        IndexName="GSI1-repo-time-index",
        KeyConditionExpression="GSI1PK = :pk",
        ExpressionAttributeValues={":pk": f"ORG#{org_id}#SERVICE#{service}"},
        ScanIndexForward=False,
        Limit=limit,
    )
    items = response.get("Items", [])
    logger.info("Incident memory retrieved", org_id=org_id, service=service, count=len(items))
    return json.dumps(items, default=str)
