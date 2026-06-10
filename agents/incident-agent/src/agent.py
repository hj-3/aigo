"""
Incident Agent — investigates production incidents using AWS observability data.
"""
from __future__ import annotations

import json
from typing import Any

import structlog
from strands import Agent
from strands.models import BedrockModel

from .config import get_config

logger = structlog.get_logger(__name__)

INCIDENT_AGENT_SYSTEM_PROMPT = """You are the Incident Agent for the AgentOps Platform.

Your role is to investigate production incidents triggered by CloudWatch Alarms or manual reports.

Investigation Process:
1. **Triage**: Determine the scope and severity of the incident
2. **Root Cause Analysis**:
   - Check CloudWatch metrics and logs around the incident time
   - Look for correlated alarms
   - Identify recent deployments or changes
   - Analyze error patterns
3. **Impact Assessment**: Determine affected services, users, and data
4. **Mitigation**: Suggest immediate actions to reduce impact
5. **Root Cause**: Identify the underlying cause
6. **Prevention**: Recommend changes to prevent recurrence

Investigation Tools:
- aws_observability_tools: Query CloudWatch metrics, logs, X-Ray traces
- ddb_tools: Update incident status, save investigation notes
- slack_tools: Send incident updates to on-call channel
- repo_tools: Check recent commits and deployments

Always prioritize: Stop the bleeding → Understand the cause → Communicate status → Plan prevention
"""


def build_agent() -> Agent:
    config = get_config()

    model = BedrockModel(
        model_id=config.model_id,
        region_name=config.aws_region,
        max_tokens=8192,
        temperature=0.0,
    )

    from tools import aws_observability_tools, ddb_tools, repo_tools, slack_tools  # noqa: PLC0415

    return Agent(
        model=model,
        system_prompt=INCIDENT_AGENT_SYSTEM_PROMPT,
        tools=[
            aws_observability_tools.get_cloudwatch_metrics,
            aws_observability_tools.get_cloudwatch_logs,
            aws_observability_tools.get_xray_traces,
            aws_observability_tools.get_related_alarms,
            aws_observability_tools.get_resource_config,
            repo_tools.get_recent_deployments,
            ddb_tools.update_incident,
            slack_tools.send_incident_update,
        ],
    )


def investigate(incident_input: dict[str, Any]) -> dict[str, Any]:
    incident_id = incident_input["incidentId"]
    log = logger.bind(incident_id=incident_id, agent="incident-agent")
    log.info("Incident investigation starting")

    agent = build_agent()
    alarm_arn = incident_input.get("awsAlarmArn", "")
    incident_time = incident_input.get("createdAt", "")
    title = incident_input.get("title", "Unknown Incident")

    prompt = f"""Investigate the following production incident:

Incident: {title}
Incident ID: {incident_id}
Alarm ARN: {alarm_arn}
Time: {incident_time}

Full Context:
{json.dumps(incident_input, indent=2)}

1. Use get_cloudwatch_metrics to check key metrics around the incident time
2. Use get_cloudwatch_logs to find error patterns
3. Use get_xray_traces to identify failing service calls
4. Use get_related_alarms to find correlated issues
5. Use get_recent_deployments to check if a recent deploy caused this
6. Update the incident with your findings using update_incident
7. Send status update to Slack using send_incident_update
"""
    agent(prompt)
    log.info("Incident investigation complete")
    return {"status": "completed", "incidentId": incident_id}
