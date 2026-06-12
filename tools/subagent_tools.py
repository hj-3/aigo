"""
Sub-agent Tools — Orchestrator uses these to invoke specialized agents via Bedrock AgentCore.
Diff content is included directly in the prompt so sub-agents don't require action groups.
"""

from __future__ import annotations

import json
import os

import boto3
import structlog
from strands import tool

logger = structlog.get_logger(__name__)


def _bedrock_runtime():
    return boto3.client("bedrock-agent-runtime", region_name=os.environ.get("AWS_REGION", "ap-northeast-2"))


def _require(key: str) -> str:
    v = os.environ.get(key)
    if not v:
        raise RuntimeError(f"Missing env: {key}")
    return v


def _invoke_agent(agent_id: str, alias_id: str, session_id: str, input_text: str) -> str:
    response = _bedrock_runtime().invoke_agent(
        agentId=agent_id,
        agentAliasId=alias_id,
        sessionId=session_id,
        inputText=input_text,
        enableTrace=False,
    )

    chunks = []
    for event in response["completion"]:
        if "chunk" in event:
            chunks.append(event["chunk"].get("bytes", b"").decode("utf-8"))

    return "".join(chunks)


def _build_review_prompt(role: str, diff_content: str, job_context: dict) -> str:
    pr_ctx = job_context.get("prContext", {})
    diff_meta = job_context.get("diffMetadata", {})
    return f"""You are the {role} for the AgentOps Platform.

## PR Context
- PR #{pr_ctx.get('prNumber')} — {pr_ctx.get('prTitle', '')}
- Author: {pr_ctx.get('authorLogin', '')}
- Branch: {pr_ctx.get('headBranch', '')} → {pr_ctx.get('baseBranch', '')}
- Files changed: {len(diff_meta.get('changedFiles', []))} (+{diff_meta.get('additions', 0)} / -{diff_meta.get('deletions', 0)})
- Commit messages: {json.dumps(diff_meta.get('commitMessages', []))}

## Full Diff
```diff
{diff_content[:12000]}
```

Analyze the diff above and return a JSON object:
{{
  "findings": [
    {{
      "severity": "CRITICAL|HIGH|MEDIUM|LOW|INFO",
      "category": "<category>",
      "location": "<file:line>",
      "description": "<specific issue>",
      "fixable": true|false,
      "fix_suggestion": "<concrete fix>"
    }}
  ],
  "summary": "<brief summary of key concerns>"
}}

Return ONLY valid JSON, no markdown fencing."""


@tool
def invoke_code_reviewer(job_input_json: str, diff_content: str) -> str:
    """
    Invokes the Code Reviewer sub-agent to analyze code quality.

    Args:
        job_input_json: JSON string with job context (jobId, orgId, repoId, prContext, diffMetadata)
        diff_content: Full unified diff content of the PR

    Returns:
        Code review results as a JSON string with findings
    """
    from uuid import uuid4

    job_context = json.loads(job_input_json)
    agent_id = _require("CODE_REVIEWER_AGENT_ID")
    alias_id = _require("CODE_REVIEWER_ALIAS_ID")
    session_id = f"code-review-{uuid4()}"

    prompt = _build_review_prompt(
        "Code Reviewer. Focus on: code quality, bugs, Race Conditions, N+1 queries, "
        "error handling, test coverage gaps, API breaking changes, hardcoded secrets.",
        diff_content,
        job_context,
    )

    logger.info("Invoking code reviewer", session_id=session_id, agent_id=agent_id)
    result = _invoke_agent(agent_id, alias_id, session_id, prompt)
    logger.info("Code reviewer complete", session_id=session_id)
    return result or json.dumps({"findings": [], "summary": "No code issues found"})


@tool
def invoke_infra_reviewer(job_input_json: str, diff_content: str) -> str:
    """
    Invokes the Infrastructure Reviewer sub-agent for IaC analysis.

    Args:
        job_input_json: JSON string with job context
        diff_content: Full unified diff content of the PR

    Returns:
        Infrastructure review results as a JSON string with findings
    """
    from uuid import uuid4

    job_context = json.loads(job_input_json)
    agent_id = _require("INFRA_REVIEWER_AGENT_ID")
    alias_id = _require("INFRA_REVIEWER_ALIAS_ID")
    session_id = f"infra-review-{uuid4()}"

    prompt = _build_review_prompt(
        "Infrastructure Reviewer. Focus on: Terraform/CloudFormation/K8s changes, "
        "IAM over-permissions, Security Group misconfigurations, resource cost impact, "
        "data retention violations, missing monitoring/logging.",
        diff_content,
        job_context,
    )

    logger.info("Invoking infra reviewer", session_id=session_id, agent_id=agent_id)
    result = _invoke_agent(agent_id, alias_id, session_id, prompt)
    logger.info("Infra reviewer complete", session_id=session_id)
    return result or json.dumps({"findings": [], "summary": "No infrastructure issues found"})


@tool
def invoke_risk_reviewer(job_input_json: str, diff_content: str) -> str:
    """
    Invokes the Risk Reviewer sub-agent for business risk assessment.

    Args:
        job_input_json: JSON string with job context
        diff_content: Full unified diff content of the PR

    Returns:
        Risk assessment results as a JSON string with findings
    """
    from uuid import uuid4

    job_context = json.loads(job_input_json)
    agent_id = _require("RISK_REVIEWER_AGENT_ID")
    alias_id = _require("RISK_REVIEWER_ALIAS_ID")
    session_id = f"risk-review-{uuid4()}"

    prompt = _build_review_prompt(
        "Risk Reviewer. Focus on: business risk, breaking changes, backward compatibility, "
        "data migration risks, rollback complexity, blast radius of the change.",
        diff_content,
        job_context,
    )

    logger.info("Invoking risk reviewer", session_id=session_id, agent_id=agent_id)
    result = _invoke_agent(agent_id, alias_id, session_id, prompt)
    logger.info("Risk reviewer complete", session_id=session_id)
    return result or json.dumps({"findings": [], "summary": "No risk issues found"})


@tool
def invoke_security_agent(job_input_json: str, diff_content: str) -> str:
    """
    Invokes the Security Agent sub-agent for security vulnerability scanning.

    Args:
        job_input_json: JSON string with job context
        diff_content: Full unified diff content of the PR

    Returns:
        Security scan results as a JSON string with findings
    """
    from uuid import uuid4

    job_context = json.loads(job_input_json)
    agent_id = _require("SECURITY_AGENT_ID")
    alias_id = _require("SECURITY_ALIAS_ID")
    session_id = f"security-{uuid4()}"

    prompt = _build_review_prompt(
        "Security Agent. Focus on: OWASP Top 10, hardcoded secrets/API keys, "
        "SQL/command injection, auth/authz vulnerabilities, insecure dependencies, "
        "data exposure risks, encryption at rest/transit issues.",
        diff_content,
        job_context,
    )

    logger.info("Invoking security agent", session_id=session_id, agent_id=agent_id)
    result = _invoke_agent(agent_id, alias_id, session_id, prompt)
    logger.info("Security agent complete", session_id=session_id)
    return result or json.dumps({"findings": [], "summary": "No security issues found"})
