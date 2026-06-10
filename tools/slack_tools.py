"""
Slack Tools — send notifications to Slack channels via Slack API.
All Slack interactions go through these tools (no direct webhook calls from agents).
"""

from __future__ import annotations

import json
import os

import boto3
import httpx
import structlog
from strands import tool

logger = structlog.get_logger(__name__)


def _get_slack_token() -> str:
    secret_arn = os.environ.get("SLACK_SECRET_ARN")
    if not secret_arn:
        raise RuntimeError("SLACK_SECRET_ARN not set")
    client = boto3.client("secretsmanager", region_name=os.environ.get("AWS_REGION", "ap-northeast-2"))
    secret = json.loads(client.get_secret_value(SecretId=secret_arn)["SecretString"])
    return secret["botToken"]


def _post_message(channel: str, blocks: list[dict], text: str) -> None:
    token = _get_slack_token()
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


def _default_channel() -> str:
    return os.environ.get("SLACK_CHANNEL_ID", "#agentops-alerts")


@tool
def notify_analysis_complete(
    job_id: str,
    repo_name: str,
    pr_number: int,
    pr_url: str,
    risk_level: str,
    merge_recommendation: str,
    findings_summary: dict[str, int],
    report_url: str,
) -> str:
    """
    Sends a Slack notification when PR analysis is complete.

    Args:
        job_id: Analysis job ID
        repo_name: Repository name (e.g., org/repo)
        pr_number: Pull Request number
        pr_url: GitHub PR URL
        risk_level: CRITICAL | HIGH | MEDIUM | LOW
        merge_recommendation: APPROVE | REQUEST_CHANGES | BLOCK
        findings_summary: Dict of severity → count
        report_url: Dashboard URL for the full report

    Returns:
        Confirmation string
    """
    risk_emoji = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🟢"}.get(risk_level, "⚪")
    rec_emoji = {"APPROVE": "✅", "REQUEST_CHANGES": "⚠️", "BLOCK": "🚫"}.get(merge_recommendation, "❓")
    channel = _default_channel()

    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": f"{risk_emoji} AgentOps Analysis Complete"}},
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Repository:*\n{repo_name}"},
                {"type": "mrkdwn", "text": f"*PR:*\n<{pr_url}|#{pr_number}>"},
                {"type": "mrkdwn", "text": f"*Risk Level:*\n{risk_emoji} {risk_level}"},
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
                },  # noqa: E501
                {"type": "button", "text": {"type": "plain_text", "text": "View PR"}, "url": pr_url},
            ],
        },
    ]

    _post_message(channel, blocks, f"AgentOps Analysis Complete: {repo_name} PR #{pr_number} — {risk_level}")
    logger.info("Slack notification sent", job_id=job_id, channel=channel)
    return f"Notification sent to {channel}"


@tool
def send_incident_update(
    incident_id: str,
    title: str,
    status: str,
    severity: str,
    update_message: str,
    affected_services: list[str],
) -> str:
    """
    Sends an incident status update to the on-call Slack channel.

    Args:
        incident_id: Incident ID
        title: Incident title
        status: OPEN | INVESTIGATING | MITIGATED | RESOLVED
        severity: CRITICAL | HIGH | MEDIUM | LOW
        update_message: Current status update message
        affected_services: List of affected service names

    Returns:
        Confirmation string
    """
    severity_emoji = {"CRITICAL": "🚨", "HIGH": "🔴", "MEDIUM": "🟠", "LOW": "🟡"}.get(severity, "⚪")
    status_emoji = {"OPEN": "🔥", "INVESTIGATING": "🔍", "MITIGATED": "🩹", "RESOLVED": "✅"}.get(status, "❓")
    oncall_channel = os.environ.get("SLACK_ONCALL_CHANNEL_ID", "#oncall")

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

    _post_message(oncall_channel, blocks, f"[{severity}] {title} — {status}")
    logger.info("Incident update sent", incident_id=incident_id, status=status, channel=oncall_channel)
    return f"Incident update sent to {oncall_channel}"
