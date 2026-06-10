"""
Orchestrator Agent — coordinates all sub-agents for a PR analysis job.
This is registered as a Strands Agent on AWS Bedrock AgentCore.

Flow:
  1. Receive AnalysisInput (jobId, prContext, diffMetadata)
  2. Invoke code-reviewer, infra-reviewer, risk-reviewer, security-agent in parallel via subagent_tools
  3. Collect all AgentFindings
  4. Compute merged AgentReport (risk level, merge recommendation)
  5. Store report to DynamoDB and S3
  6. Notify via slack_tools
  7. Post GitHub PR comment via github_tools
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import boto3
import structlog
from strands import Agent, tool
from strands.models import BedrockModel

from .config import get_config

logger = structlog.get_logger(__name__)

ORCHESTRATOR_SYSTEM_PROMPT = """You are the Orchestrator Agent for the AgentOps Platform.
Your role is to coordinate analysis of a Pull Request by invoking specialized sub-agents:
- code_reviewer: Reviews code quality, patterns, and style issues
- infra_reviewer: Reviews infrastructure-as-code changes (Terraform, CloudFormation, K8s)
- risk_reviewer: Assesses business risk, breaking changes, and backward compatibility
- security_agent: Identifies security vulnerabilities and OWASP issues

After collecting results from all sub-agents, you must:
1. Call save_report to persist the consolidated report
2. Call notify_slack to send a Slack notification
3. Call post_github_comment to update the PR

Always use the provided tools — never make up findings.
"""


def build_agent() -> Agent:
    config = get_config()

    model = BedrockModel(
        model_id=config.model_id,
        region_name=config.aws_region,
        max_tokens=8192,
        temperature=0.0,
    )

    from tools import (  # noqa: PLC0415 — imported at runtime from MCP tool packages
        subagent_tools,
        ddb_tools,
        slack_tools,
        github_tools,
        pr_tools,
    )

    return Agent(
        model=model,
        system_prompt=ORCHESTRATOR_SYSTEM_PROMPT,
        tools=[
            subagent_tools.invoke_code_reviewer,
            subagent_tools.invoke_infra_reviewer,
            subagent_tools.invoke_risk_reviewer,
            subagent_tools.invoke_security_agent,
            ddb_tools.save_report,
            ddb_tools.save_findings,
            ddb_tools.update_job_status,
            slack_tools.notify_analysis_complete,
            github_tools.post_pr_comment,
            pr_tools.get_diff_content,
        ],
        max_parallel_steps=4,
    )


def run_analysis(job_input: dict[str, Any]) -> dict[str, Any]:
    """Entry point called by Bedrock AgentCore."""
    job_id = job_input["jobId"]
    log = logger.bind(job_id=job_id)
    log.info("Orchestrator starting analysis")

    agent = build_agent()
    prompt = f"""Analyze the following Pull Request and coordinate all sub-agents.

Job Input:
{json.dumps(job_input, indent=2)}

Steps:
1. Use get_diff_content to load the PR diff
2. Invoke all four sub-agents in parallel with the diff and context
3. Consolidate all findings into a unified report
4. Save the report using save_report and save_findings
5. Notify via notify_analysis_complete
6. Post a summary comment using post_pr_comment
"""

    result = agent(prompt)
    log.info("Orchestrator completed", result_length=len(str(result)))
    return {"status": "completed", "jobId": job_id}
