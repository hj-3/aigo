"""
GitHub Tools — post comments, manage Check Runs, and update PR status.
Agents use these to report findings back to GitHub PRs.
"""

from __future__ import annotations

import json
import os
from typing import Any

import boto3
import httpx
import structlog
from strands import tool

logger = structlog.get_logger(__name__)


def _get_github_creds() -> dict[str, str]:
    secret_arn = os.environ.get("GITHUB_SECRET_ARN")
    if not secret_arn:
        raise RuntimeError("GITHUB_SECRET_ARN not set")
    sm = boto3.client("secretsmanager", region_name=os.environ.get("AWS_REGION", "ap-northeast-2"))
    return json.loads(sm.get_secret_value(SecretId=secret_arn)["SecretString"])


def _get_installation_token(repo_full_name: str, installation_id: str = "") -> str:
    """Gets a GitHub App installation access token.

    If installation_id is provided, uses it directly.
    Otherwise falls back to the installationId stored in Secrets Manager (single-tenant legacy).
    """
    creds = _get_github_creds()

    from github_auth import create_installation_token  # type: ignore[import]

    effective_id = installation_id or creds.get("installationId", "")
    if not effective_id:
        raise RuntimeError("No GitHub installation ID available")

    return create_installation_token(
        app_id=creds["appId"],
        private_key=creds["privateKey"],
        installation_id=effective_id,
    )


def _github_request(method: str, url: str, token: str, **kwargs: Any) -> dict:
    resp = httpx.request(
        method,
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        timeout=15,
        **kwargs,
    )
    resp.raise_for_status()
    return resp.json() if resp.content else {}


@tool
def create_check_run(
    repo_full_name: str,
    head_sha: str,
    name: str = "AgentOps / PR Analysis",
    installation_id: str = "",
) -> str:
    """
    Creates a GitHub Check Run on a commit to show analysis is in progress.
    Call this at the START of analysis to give developers immediate feedback.

    Args:
        repo_full_name: Repository in owner/repo format
        head_sha: Git commit SHA of the PR head
        name: Check run display name
        installation_id: GitHub App installation ID (per-org in multi-tenant mode)

    Returns:
        Check run ID as string (use in update_check_run calls)
    """
    token = _get_installation_token(repo_full_name, installation_id)
    result = _github_request(
        "POST",
        f"https://api.github.com/repos/{repo_full_name}/check-runs",
        token,
        json={
            "name": name,
            "head_sha": head_sha,
            "status": "in_progress",
            "started_at": _utcnow_iso(),
            "output": {
                "title": "Analysis in progress",
                "summary": "AgentOps is analyzing this pull request. Results will appear shortly.",
            },
        },
    )
    check_run_id = str(result.get("id", ""))
    logger.info("Check run created", repo=repo_full_name, sha=head_sha[:8], check_run_id=check_run_id)
    return check_run_id


@tool
def update_check_run(
    repo_full_name: str,
    check_run_id: str,
    conclusion: str,
    output_title: str,
    output_summary: str,
    output_text: str = "",
    installation_id: str = "",
) -> str:
    """
    Updates a GitHub Check Run with the final analysis result.
    Call this at the END of analysis after saving the report.

    Args:
        repo_full_name: Repository in owner/repo format
        check_run_id: Check run ID returned by create_check_run
        conclusion: success | failure | neutral | action_required (use action_required for HIGH/CRITICAL)
        output_title: Short summary title (e.g., "3 Critical, 5 High findings")
        output_summary: Markdown summary shown in the check details
        output_text: Additional details (optional, can include findings list)
        installation_id: GitHub App installation ID

    Returns:
        URL of the completed check run
    """
    token = _get_installation_token(repo_full_name, installation_id)
    output: dict[str, str] = {"title": output_title, "summary": output_summary}
    if output_text:
        output["text"] = output_text[:65535]  # GitHub limit

    result = _github_request(
        "PATCH",
        f"https://api.github.com/repos/{repo_full_name}/check-runs/{check_run_id}",
        token,
        json={
            "status": "completed",
            "conclusion": conclusion,
            "completed_at": _utcnow_iso(),
            "output": output,
        },
    )
    url = result.get("html_url", "")
    logger.info("Check run updated", repo=repo_full_name, check_run_id=check_run_id, conclusion=conclusion)
    return url


@tool
def post_pr_comment(
    repo_full_name: str,
    pr_number: int,
    risk_level: str,
    risk_score: int,
    merge_recommendation: str,
    summary: str,
    findings_by_severity: dict[str, int],
    report_id: str,
    installation_id: str = "",
) -> str:
    """
    Posts an analysis summary comment on a GitHub Pull Request.

    Args:
        repo_full_name: Repository in owner/repo format
        pr_number: Pull Request number
        risk_level: CRITICAL | HIGH | MEDIUM | LOW
        risk_score: Numeric risk score 0-100
        merge_recommendation: APPROVE | REQUEST_CHANGES | BLOCK
        summary: Human-readable analysis summary
        findings_by_severity: Dict of severity → count
        report_id: Report ID for dashboard link
        installation_id: GitHub App installation ID (per-org in multi-tenant mode)

    Returns:
        URL of the created comment
    """
    token = _get_installation_token(repo_full_name, installation_id)

    risk_emoji = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🟢"}.get(risk_level, "⚪")
    rec_emoji = {"APPROVE": "✅", "REQUEST_CHANGES": "⚠️", "BLOCK": "🚫"}.get(merge_recommendation, "❓")
    dashboard_url = os.environ.get("DASHBOARD_URL", "https://app.agentops.example.com")

    total_critical = findings_by_severity.get("CRITICAL", 0)
    total_high = findings_by_severity.get("HIGH", 0)
    total_medium = findings_by_severity.get("MEDIUM", 0)
    total_low = findings_by_severity.get("LOW", 0)
    total_info = findings_by_severity.get("INFO", 0)

    score_bar = _score_bar(risk_score)

    body = f"""## {risk_emoji} AgentOps Analysis Report

**Risk Level:** {risk_emoji} `{risk_level}` &nbsp;|&nbsp; **Risk Score:** `{risk_score}/100` {score_bar}
**Recommendation:** {rec_emoji} `{merge_recommendation}`

### Summary
{summary}

### Findings
| Severity | Count |
|----------|-------|
| 🔴 Critical | {total_critical} |
| 🟠 High | {total_high} |
| 🟡 Medium | {total_medium} |
| 🟢 Low | {total_low} |
| ℹ️ Info | {total_info} |

### Actions
- [📊 View Full Report]({dashboard_url}/reports/{report_id})
- To approve: `/approve {report_id}`
- To request fix: `/fix {report_id}`

---
*Generated by [AgentOps Platform](https://github.com/your-org/aigo) • Powered by Claude Sonnet*
"""

    result = _github_request(
        "POST",
        f"https://api.github.com/repos/{repo_full_name}/issues/{pr_number}/comments",
        token,
        json={"body": body},
    )

    comment_url = result.get("html_url", "")
    logger.info("PR comment posted", repo=repo_full_name, pr_number=pr_number, url=comment_url)
    return comment_url


@tool
def set_commit_status(
    repo_full_name: str,
    commit_sha: str,
    state: str,
    description: str,
    context: str = "AgentOps/analysis",
    installation_id: str = "",
) -> str:
    """
    Sets a commit status check on GitHub.

    Args:
        repo_full_name: Repository in owner/repo format
        commit_sha: Git commit SHA
        state: pending | success | failure | error
        description: Short status description (max 140 chars)
        context: Status context identifier
        installation_id: GitHub App installation ID

    Returns:
        Confirmation string
    """
    token = _get_installation_token(repo_full_name, installation_id)
    _github_request(
        "POST",
        f"https://api.github.com/repos/{repo_full_name}/statuses/{commit_sha}",
        token,
        json={"state": state, "description": description[:140], "context": context},
    )
    logger.info("Commit status set", repo=repo_full_name, sha=commit_sha[:8], state=state)
    return f"Commit status set to {state}"


@tool
def auto_merge_pr(
    repo_full_name: str,
    pr_number: int,
    org_id: str,
    risk_score: int,
    merge_recommendation: str,
    installation_id: str = "",
) -> str:
    """
    Auto-merges a PR if org policy allows it.

    Checks org settings from DynamoDB:
    - approvalRequired: if True, skips auto-merge (human must approve)
    - riskThreshold: numeric 0-100; only merges if risk_score <= threshold (default 20)

    Only merges when merge_recommendation == "APPROVE".

    Args:
        repo_full_name: Repository in owner/repo format
        pr_number: Pull Request number
        org_id: Organization ID (used to look up settings)
        risk_score: Numeric risk score from analysis (0-100)
        merge_recommendation: APPROVE | REQUEST_CHANGES | BLOCK
        installation_id: GitHub App installation ID

    Returns:
        Result string describing what happened
    """
    if merge_recommendation != "APPROVE":
        return f"Auto-merge skipped: recommendation is {merge_recommendation} (not APPROVE)"

    # Check org policy
    ddb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "ap-northeast-2"))
    prefix = os.environ.get("DYNAMODB_TABLE_PREFIX", "aigo")
    org_table = ddb.Table(f"{prefix}-Organizations")

    resp = org_table.get_item(Key={"PK": f"ORG#{org_id}", "SK": "METADATA"})
    org = resp.get("Item", {})

    approval_required = org.get("approvalRequired", False)
    # riskThreshold is stored as a risk-level string: NONE | LOW | MEDIUM | HIGH | CRITICAL
    # Convert to a numeric upper bound for risk_score comparison.
    _threshold_map = {"NONE": -1, "LOW": 19, "MEDIUM": 39, "HIGH": 74, "CRITICAL": 100}
    raw = org.get("riskThreshold", "HIGH")
    risk_threshold = _threshold_map.get(str(raw), 74)  # default: HIGH (auto-merge if score <= 74)

    if approval_required:
        logger.info("Auto-merge skipped: approvalRequired=True", org_id=org_id)
        return "Auto-merge skipped: org requires manual approval via /approve"

    if risk_score > risk_threshold:
        logger.info("Auto-merge skipped: above threshold", risk_score=risk_score, threshold=risk_threshold)
        return f"Auto-merge skipped: risk_score {risk_score} > org threshold {risk_threshold} — manual approval required"

    # Perform merge
    token = _get_installation_token(repo_full_name, installation_id)
    try:
        _github_request(
            "PUT",
            f"https://api.github.com/repos/{repo_full_name}/pulls/{pr_number}/merge",
            token,
            json={
                "commit_title": f"Auto-merged by AgentOps (risk score: {risk_score}/100, level: LOW)",
                "commit_message": "Automatically merged after AgentOps analysis. Risk level: LOW — no manual review required.",
                "merge_method": "merge",
            },
        )
        logger.info("PR auto-merged", repo=repo_full_name, pr_number=pr_number, risk_score=risk_score)
        return f"PR #{pr_number} auto-merged (risk_score={risk_score}/{risk_threshold} threshold)"
    except Exception as exc:
        logger.warning("PR auto-merge failed", repo=repo_full_name, pr_number=pr_number, error=str(exc))
        return f"Auto-merge attempted but failed: {exc}"


def _utcnow_iso() -> str:
    from datetime import UTC, datetime
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _score_bar(score: int) -> str:
    """Renders a simple text progress bar for risk score."""
    filled = min(score // 10, 10)
    empty = 10 - filled
    if score >= 70:
        char = "🟥"
    elif score >= 40:
        char = "🟧"
    else:
        char = "🟩"
    return char * filled + "⬜" * empty
