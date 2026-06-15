"""
Sub-agent Tools — Specialist Frontier Agents called by the Orchestrator.

Original design: Code/Infra/Risk/Security analysis is done DIRECTLY by the single
multi-persona Strands Orchestrator. These tools exist for SPECIALIST flows only:
  - invoke_devops_agent: incident investigation (CloudWatch metrics, X-Ray, CloudTrail)

Previously had invoke_code_reviewer / invoke_infra_reviewer / invoke_risk_reviewer /
invoke_security_agent — those are no longer needed since the Orchestrator Agent performs
all 4 persona analyses directly.
"""

from __future__ import annotations

import json
import os

import boto3
import structlog
from strands import tool

logger = structlog.get_logger(__name__)


def _bedrock_client():
    return boto3.client("bedrock-agent-runtime", region_name=os.environ.get("AWS_REGION", "ap-northeast-2"))


def _require(key: str) -> str:
    v = os.environ.get(key)
    if not v:
        raise RuntimeError(f"Missing env: {key}")
    return v


def _invoke_agent(agent_id: str, alias_id: str, session_id: str, input_text: str) -> str:
    response = _bedrock_client().invoke_agent(
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


@tool
def invoke_devops_agent(incident_context_json: str) -> str:
    """
    Invokes the DevOps Incident Agent to investigate a production incident.
    Use this when investigating CloudWatch alarms, 5xx spikes, or operational anomalies.

    Args:
        incident_context_json: JSON string with incident details:
          - incidentId: str
          - service: str
          - alarmName: str
          - startTime: ISO8601 str
          - endTime: ISO8601 str (optional)
          - errorMessages: list[str] (optional sample log lines)
          - recentDeployments: list[str] (optional PR/deploy IDs)

    Returns:
        RCA report as a JSON string with: rootCause, affectedServices, mitigation, timeline
    """
    from uuid import uuid4

    ctx = json.loads(incident_context_json)
    agent_id = _require("INCIDENT_AGENT_ID")
    alias_id = _require("INCIDENT_ALIAS_ID")
    session_id = f"incident-{ctx.get('incidentId', uuid4())}"

    prompt = f"""You are the DevOps Incident Agent. Investigate the following production incident.

## Incident Context
{json.dumps(ctx, indent=2)}

Use your observability tools to:
1. Query CloudWatch metrics for the affected service around the incident window
2. Search CloudWatch Logs for error patterns
3. Check X-Ray traces for latency or error spikes
4. Review CloudTrail for recent config changes
5. Check recent deployments for correlation

Return a JSON object:
{{
  "rootCause": "<primary root cause>",
  "confidence": 0.0-1.0,
  "affectedServices": ["<service1>", ...],
  "timeline": [{{"time": "...", "event": "..."}}],
  "mitigation": "<immediate steps to mitigate>",
  "prevention": "<long-term prevention recommendation>",
  "requiresHumanAction": true|false,
  "escalateTo": "<team or person if escalation needed>"
}}"""

    logger.info("Invoking DevOps agent", session_id=session_id, agent_id=agent_id)
    result = _invoke_agent(agent_id, alias_id, session_id, prompt)
    logger.info("DevOps agent complete", session_id=session_id)
    return result or json.dumps({"rootCause": "Investigation incomplete", "requiresHumanAction": True})
