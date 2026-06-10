"""
Sub-agent Tools — Orchestrator uses these to invoke specialized agents via Bedrock AgentCore.
"""
from __future__ import annotations

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


async def _invoke_agent(agent_id: str, alias_id: str, session_id: str, input_text: str) -> str:
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
            chunks.append(event["chunk"]["bytes"].decode("utf-8"))

    return "".join(chunks)


@tool
def invoke_code_reviewer(job_input_json: str) -> str:
    """
    Invokes the Code Reviewer sub-agent to analyze code quality.

    Args:
        job_input_json: JSON string with job context (jobId, orgId, repoId, prContext, diffMetadata)

    Returns:
        Code review results as a JSON string with findings
    """
    import asyncio
    from uuid import uuid4
    agent_id = _require("CODE_REVIEWER_AGENT_ID")
    alias_id = _require("CODE_REVIEWER_ALIAS_ID")
    session_id = f"code-review-{uuid4()}"
    logger.info("Invoking code reviewer", session_id=session_id)
    result = asyncio.get_event_loop().run_until_complete(
        _invoke_agent(agent_id, alias_id, session_id, job_input_json)
    )
    logger.info("Code reviewer complete", session_id=session_id)
    return result


@tool
def invoke_infra_reviewer(job_input_json: str) -> str:
    """
    Invokes the Infrastructure Reviewer sub-agent for IaC analysis.

    Args:
        job_input_json: JSON string with job context

    Returns:
        Infrastructure review results as a JSON string with findings
    """
    import asyncio
    from uuid import uuid4
    agent_id = _require("INFRA_REVIEWER_AGENT_ID")
    alias_id = _require("INFRA_REVIEWER_ALIAS_ID")
    session_id = f"infra-review-{uuid4()}"
    logger.info("Invoking infra reviewer", session_id=session_id)
    result = asyncio.get_event_loop().run_until_complete(
        _invoke_agent(agent_id, alias_id, session_id, job_input_json)
    )
    logger.info("Infra reviewer complete", session_id=session_id)
    return result


@tool
def invoke_risk_reviewer(job_input_json: str) -> str:
    """
    Invokes the Risk Reviewer sub-agent for business risk assessment.

    Args:
        job_input_json: JSON string with job context

    Returns:
        Risk assessment results as a JSON string with findings
    """
    import asyncio
    from uuid import uuid4
    agent_id = _require("RISK_REVIEWER_AGENT_ID")
    alias_id = _require("RISK_REVIEWER_ALIAS_ID")
    session_id = f"risk-review-{uuid4()}"
    logger.info("Invoking risk reviewer", session_id=session_id)
    result = asyncio.get_event_loop().run_until_complete(
        _invoke_agent(agent_id, alias_id, session_id, job_input_json)
    )
    logger.info("Risk reviewer complete", session_id=session_id)
    return result


@tool
def invoke_security_agent(job_input_json: str) -> str:
    """
    Invokes the Security Agent sub-agent for security vulnerability scanning.

    Args:
        job_input_json: JSON string with job context

    Returns:
        Security scan results as a JSON string with findings
    """
    import asyncio
    from uuid import uuid4
    agent_id = _require("SECURITY_AGENT_ID")
    alias_id = _require("SECURITY_ALIAS_ID")
    session_id = f"security-{uuid4()}"
    logger.info("Invoking security agent", session_id=session_id)
    result = asyncio.get_event_loop().run_until_complete(
        _invoke_agent(agent_id, alias_id, session_id, job_input_json)
    )
    logger.info("Security agent complete", session_id=session_id)
    return result
