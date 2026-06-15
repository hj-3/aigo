"""
Slack Tools — send notifications to Slack channels via Slack API.
Multi-tenant: each org has its own bot token stored in SSM Parameter Store.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache

import boto3
import httpx
import structlog
from strands import tool

logger = structlog.get_logger(__name__)


def _ssm() -> boto3.client:
    return boto3.client("ssm", region_name=os.environ.get("AWS_REGION", "ap-northeast-2"))


def _get_org_slack_token(org_id: str) -> str:
    """Reads per-org Slack bot token from SSM SecureString."""
    ssm_path = os.environ.get("SSM_SLACK_TOKEN_PATH", "/aigo/integrations/slack")
    param_name = f"{ssm_path}/{org_id}/bot-token"
    try:
        result = _ssm().get_parameter(Name=param_name, WithDecryption=True)
        return result["Parameter"]["Value"]
    except _ssm().exceptions.ParameterNotFound:
        raise RuntimeError(f"Slack bot token not configured for org {org_id}")


def _get_global_slack_token() -> str:
    """Fallback: reads global Slack bot token from Secrets Manager (legacy/single-tenant)."""
    secret_arn = os.environ.get("SLACK_SECRET_ARN")
    if not secret_arn:
        raise RuntimeError("SLACK_SECRET_ARN not set")
    sm = boto3.client("secretsmanager", region_name=os.environ.get("AWS_REGION", "ap-northeast-2"))
    secret = json.loads(sm.get_secret_value(SecretId=secret_arn)["SecretString"])
    return secret["botToken"]


def _resolve_token(org_id: str) -> str:
    if org_id:
        return _get_org_slack_token(org_id)
    return _get_global_slack_token()


def _post_message(channel: str, blocks: list[dict], text: str, token: str) -> None:
    resp = httpx.post(
        "https://slack.com/api/chat.postMessage",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"channel": channel, "text": text, "blocks": blocks},
        timeout=10,
    )
    data = resp.json()
    if not data.get("ok"):
        logger.error("Slack API error", error=data.get("error"))
        raise RuntimeError(f"Slack error: {data.get('error')}")


def _resolve_channel(org_id: str, slack_channel: str) -> str:
    """
    Returns the channel to post to. Priority:
    1. Explicit slack_channel parameter
    2. Per-org channel stored in SSM
    3. Global SLACK_CHANNEL_ID env var fallback
    """
    if slack_channel:
        return slack_channel
    if org_id:
        ssm_path = os.environ.get("SSM_SLACK_TOKEN_PATH", "/aigo/integrations/slack")
        param_name = f"{ssm_path}/{org_id}/channel-id"
        try:
            result = _ssm().get_parameter(Name=param_name)
            channel = result["Parameter"]["Value"]
            if channel:
                return channel
        except Exception:
            pass
    return os.environ.get("SLACK_CHANNEL_ID", "#agentops-alerts")


@tool
def notify_analysis_complete(
    job_id: str,
    org_id: str,
    repo_name: str,
    pr_number: int,
    pr_url: str,
    risk_level: str,
    risk_score: int,
    merge_recommendation: str,
    findings_summary: dict[str, int],
    report_url: str,
    slack_channel: str = "",
) -> str:
    """
    Sends a Slack notification when PR analysis is complete.
    Uses per-org bot token from SSM Parameter Store.

    Args:
        job_id: Analysis job ID
        org_id: Organization ID (used to resolve per-org Slack token and channel)
        repo_name: Repository name (e.g., org/repo)
        pr_number: Pull Request number
        pr_url: GitHub PR URL
        risk_level: CRITICAL | HIGH | MEDIUM | LOW
        risk_score: Numeric risk score 0-100
        merge_recommendation: APPROVE | REQUEST_CHANGES | BLOCK
        findings_summary: Dict of severity → count
        report_url: Dashboard URL for the full report
        slack_channel: Override channel (if empty, resolves from org config or env var)

    Returns:
        Confirmation string
    """
    risk_emoji = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🟢"}.get(risk_level, "⚪")
    rec_emoji = {"APPROVE": "✅", "REQUEST_CHANGES": "⚠️", "BLOCK": "🚫"}.get(merge_recommendation, "❓")

    token = _resolve_token(org_id)
    channel = _resolve_channel(org_id, slack_channel)

    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": f"{risk_emoji} AgentOps Analysis Complete"}},
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Repository:*\n{repo_name}"},
                {"type": "mrkdwn", "text": f"*PR:*\n<{pr_url}|#{pr_number}>"},
                {"type": "mrkdwn", "text": f"*Risk Level:*\n{risk_emoji} {risk_level} (`{risk_score}/100`)"},
                {"type": "mrkdwn", "text": f"*Recommendation:*\n{rec_emoji} {merge_recommendation}"},
            ],
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"*Findings:* "
                    f"🔴 {findings_summary.get('CRITICAL', 0)} Critical | "
                    f"🟠 {findings_summary.get('HIGH', 0)} High | "
                    f"🟡 {findings_summary.get('MEDIUM', 0)} Medium | "
                    f"🟢 {findings_summary.get('LOW', 0)} Low"
                ),
            },
        },
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "View Report"},
                    "url": report_url,
                    "style": "primary",
                },
                {"type": "button", "text": {"type": "plain_text", "text": "View PR"}, "url": pr_url},
            ],
        },
    ]

    _post_message(channel, blocks, f"AgentOps Analysis Complete: {repo_name} PR #{pr_number} — {risk_level}", token)
    logger.info("Slack notification sent", job_id=job_id, org_id=org_id, channel=channel)
    return f"Notification sent to {channel}"


@tool
def send_incident_update(
    incident_id: str,
    org_id: str,
    title: str,
    status: str,
    severity: str,
    update_message: str,
    affected_services: list[str],
    slack_channel: str = "",
) -> str:
    """
    Sends an incident status update to the on-call Slack channel.

    Args:
        incident_id: Incident ID
        org_id: Organization ID (used to resolve per-org Slack token)
        title: Incident title
        status: OPEN | INVESTIGATING | MITIGATED | RESOLVED
        severity: CRITICAL | HIGH | MEDIUM | LOW
        update_message: Current status update message
        affected_services: List of affected service names
        slack_channel: Override channel (if empty, resolves from SSM or env var SLACK_ONCALL_CHANNEL_ID)

    Returns:
        Confirmation string
    """
    severity_emoji = {"CRITICAL": "🚨", "HIGH": "🔴", "MEDIUM": "🟠", "LOW": "🟡"}.get(severity, "⚪")
    status_emoji = {"OPEN": "🔥", "INVESTIGATING": "🔍", "MITIGATED": "🩹", "RESOLVED": "✅"}.get(status, "❓")

    token = _resolve_token(org_id)
    oncall_channel = slack_channel or os.environ.get("SLACK_ONCALL_CHANNEL_ID", "#oncall")

    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": f"{severity_emoji} Incident: {title}"}},
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Incident ID:*\n`{incident_id}`"},
                {"type": "mrkdwn", "text": f"*Status:*\n{status_emoji} {status}"},
                {"type": "mrkdwn", "text": f"*Severity:*\n{severity_emoji} {severity}"},
                {"type": "mrkdwn", "text": f"*Affected Services:*\n{', '.join(affected_services) or 'Unknown'}"},
            ],
        },
        {"type": "section", "text": {"type": "mrkdwn", "text": f"*Update:*\n{update_message}"}},
    ]

    _post_message(oncall_channel, blocks, f"[{severity}] {title} — {status}", token)
    logger.info("Incident update sent", incident_id=incident_id, status=status, channel=oncall_channel)
    return f"Incident update sent to {oncall_channel}"
