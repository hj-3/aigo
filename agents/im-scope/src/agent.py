"""IM Scope Agent — Root cause analysis using CloudWatch, X-Ray, CloudTrail via Strands."""

from __future__ import annotations

import json
import os

import structlog
from botocore.config import Config as BotoConfig
from strands import Agent, tool
from strands.models import BedrockModel

logger = structlog.get_logger(__name__)

MODEL_ID = os.environ.get("MODEL_ID", "us.anthropic.claude-sonnet-4-6-20250514-v1:0")
AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-2")


SCOPE_SYSTEM_PROMPT = """You are the AIGO IM Scope Agent — a root cause analysis specialist.

Given an incident, you:
1. Analyze CloudWatch metrics and alarms around the incident time window
2. Examine X-Ray traces for latency/error spikes
3. Review CloudTrail for recent API changes that may have caused the issue
4. Identify the root cause, blast radius, and affected services
5. Propose concrete, executable recovery actions

When calling save_scope_result, the recovery_options parameter must be a JSON array of recovery actions.
Each action must have these fields:
  - description: string (what this action does, in Korean)
  - actionType: "RESTART_ECS_SERVICE" | "INVOKE_LAMBDA" | "SSM_RUN_COMMAND" | "MANUAL"
  - targetResource: string (ARN or resource identifier)
  - risk: "LOW" | "MEDIUM" | "HIGH"
  - estimatedMinutes: integer (estimated execution time)
  - params: object (action-type-specific parameters required for execution)

params structure per actionType:
  RESTART_ECS_SERVICE → {"cluster": "<cluster-name-or-arn>", "service": "<service-name>", "region": "ap-northeast-2"}
  INVOKE_LAMBDA       → {"functionName": "<function-name-or-arn>", "payload": {}, "region": "ap-northeast-2"}
  SSM_RUN_COMMAND     → {"instanceIds": ["i-xxxx"], "documentName": "AWS-RunShellScript", "parameters": {"commands": ["..."]}, "region": "ap-northeast-2"}
  MANUAL              → {} (empty — human executes manually)

Example recovery_options:
[
  {
    "description": "ECS api 서비스 강제 재시작",
    "actionType": "RESTART_ECS_SERVICE",
    "targetResource": "arn:aws:ecs:ap-northeast-2:123456789012:service/prod-cluster/api-service",
    "risk": "LOW",
    "estimatedMinutes": 3,
    "params": {"cluster": "prod-cluster", "service": "api-service", "region": "ap-northeast-2"}
  },
  {
    "description": "롤백 Lambda 실행",
    "actionType": "INVOKE_LAMBDA",
    "targetResource": "arn:aws:lambda:ap-northeast-2:123456789012:function:rollback-deploy",
    "risk": "MEDIUM",
    "estimatedMinutes": 5,
    "params": {"functionName": "rollback-deploy", "payload": {}, "region": "ap-northeast-2"}
  }
]

Infer params from the CloudWatch alarm name, X-Ray service names, and CloudTrail events.
If ARNs are not determinable from evidence, use descriptive names with a note in description.
If no automated action is possible, set actionType to MANUAL with empty params.
"""


@tool
def get_cloudwatch_metrics(
    namespace: str,
    metric_name: str,
    start_time: str,
    end_time: str,
    dimensions: str = "{}",
) -> str:
    """Fetch CloudWatch metric statistics for root cause analysis."""
    import boto3
    from datetime import datetime
    cw = boto3.client("cloudwatch", region_name=AWS_REGION)
    try:
        dims = json.loads(dimensions)
        response = cw.get_metric_statistics(
            Namespace=namespace,
            MetricName=metric_name,
            StartTime=datetime.fromisoformat(start_time),
            EndTime=datetime.fromisoformat(end_time),
            Period=60,
            Statistics=["Average", "Maximum", "Sum"],
            Dimensions=[{"Name": k, "Value": v} for k, v in dims.items()],
        )
        return json.dumps(response.get("Datapoints", []), default=str)
    except Exception as exc:
        return json.dumps({"error": str(exc)})


@tool
def get_cloudwatch_logs(
    log_group: str,
    start_time: str,
    end_time: str,
    filter_pattern: str = "ERROR",
    limit: int = 50,
) -> str:
    """Search CloudWatch Logs for errors around the incident time."""
    import boto3
    from datetime import datetime
    logs = boto3.client("logs", region_name=AWS_REGION)
    try:
        start_ms = int(datetime.fromisoformat(start_time).timestamp() * 1000)
        end_ms = int(datetime.fromisoformat(end_time).timestamp() * 1000)
        response = logs.filter_log_events(
            logGroupName=log_group,
            startTime=start_ms,
            endTime=end_ms,
            filterPattern=filter_pattern,
            limit=min(limit, 100),
        )
        events = response.get("events", [])
        return json.dumps([{"timestamp": e["timestamp"], "message": e["message"][:500]} for e in events])
    except Exception as exc:
        return json.dumps({"error": str(exc)})


@tool
def get_xray_traces(
    start_time: str,
    end_time: str,
    filter_expression: str = "responsetime > 1",
) -> str:
    """Fetch X-Ray traces for latency/error analysis."""
    import boto3
    from datetime import datetime
    xray = boto3.client("xray", region_name=AWS_REGION)
    try:
        response = xray.get_trace_summaries(
            StartTime=datetime.fromisoformat(start_time),
            EndTime=datetime.fromisoformat(end_time),
            FilterExpression=filter_expression,
        )
        summaries = response.get("TraceSummaries", [])[:10]
        return json.dumps([{
            "id": s.get("Id", ""),
            "duration": s.get("Duration", 0),
            "hasError": s.get("HasError", False),
            "hasFault": s.get("HasFault", False),
            "serviceNames": [svc.get("Name", "") for svc in s.get("ServiceIds", [])],
        } for s in summaries])
    except Exception as exc:
        return json.dumps({"error": str(exc)})


@tool
def get_cloudtrail_events(
    start_time: str,
    end_time: str,
    event_name: str = "",
) -> str:
    """Look up recent CloudTrail API events — find deploy/config changes that caused the incident."""
    import boto3
    from datetime import datetime
    ct = boto3.client("cloudtrail", region_name=AWS_REGION)
    try:
        kwargs: dict = {
            "StartTime": datetime.fromisoformat(start_time),
            "EndTime": datetime.fromisoformat(end_time),
            "MaxResults": 20,
        }
        if event_name:
            kwargs["LookupAttributes"] = [{"AttributeKey": "EventName", "AttributeValue": event_name}]

        response = ct.lookup_events(**kwargs)
        events = response.get("Events", [])
        return json.dumps([{
            "eventTime": str(e.get("EventTime", "")),
            "eventName": e.get("EventName", ""),
            "username": e.get("Username", ""),
            "resources": [r.get("ResourceName", "") for r in e.get("Resources", [])],
        } for e in events])
    except Exception as exc:
        return json.dumps({"error": str(exc)})


@tool
def save_scope_result(
    incident_id: str,
    root_cause: str,
    affected_services: str,
    blast_radius: str,
    mitigation: str,
    confidence: float,
    evidence: str,
    recovery_options: str = "[]",
) -> str:
    """Save the scope analysis result and recovery options to DynamoDB.

    recovery_options: JSON array of {description, actionType, targetResource, risk, estimatedMinutes}
    """
    import boto3
    from datetime import UTC, datetime
    ddb = boto3.resource("dynamodb", region_name=AWS_REGION)
    table = ddb.Table(os.environ["IM_INVESTIGATION_TABLE"])
    try:
        parsed_recovery = json.loads(recovery_options) if recovery_options else []
        if not isinstance(parsed_recovery, list):
            parsed_recovery = []

        # Ensure every action has a params field (defaults to empty dict)
        for opt in parsed_recovery:
            if isinstance(opt, dict) and "params" not in opt:
                opt["params"] = {}

        table.put_item(Item={
            "PK": f"INCIDENT#{incident_id}",
            "SK": "SCOPE_RESULT",
            "rootCause": root_cause,
            "affectedServices": json.loads(affected_services),
            "blastRadius": blast_radius,
            "mitigation": mitigation,
            "confidence": str(confidence),
            "evidence": json.loads(evidence) if evidence.startswith("[") else [evidence],
            "recoveryOptions": parsed_recovery,
            "generatedAt": datetime.now(UTC).isoformat(),
        })
        return json.dumps({"saved": True, "recoveryOptionsCount": len(parsed_recovery)})
    except Exception as exc:
        return json.dumps({"error": str(exc)})


def build_agent() -> Agent:
    model = BedrockModel(
        model_id=MODEL_ID,
        region_name=AWS_REGION,
        max_tokens=8192,
        temperature=0.0,
        boto_client_config=BotoConfig(retries={"max_attempts": 5, "mode": "adaptive"}),
    )
    return Agent(
        model=model,
        system_prompt=SCOPE_SYSTEM_PROMPT,
        tools=[
            get_cloudwatch_metrics,
            get_cloudwatch_logs,
            get_xray_traces,
            get_cloudtrail_events,
            save_scope_result,
        ],
    )


def run_scope_analysis(incident_id: str, org_id: str, incident_data: dict) -> dict:
    log = logger.bind(incident_id=incident_id)
    log.info("Scope agent starting")

    agent = build_agent()
    now = incident_data.get("createdAt", "")
    title = incident_data.get("title", "")
    affected_services = json.dumps(incident_data.get("affectedServices", []))

    prompt = f"""Analyze incident: {incident_id}
Title: {title}
Affected services: {affected_services}
Detected at: {now}

## Instructions
1. Check CloudWatch metrics for affected services around incident time (±15 min)
2. Search CloudWatch Logs for ERROR messages in /aws/lambda/* and /ecs/* log groups
3. Get X-Ray traces with errors or high latency during the incident window
4. Check CloudTrail for any deployments or config changes in the past 2 hours
5. Based on findings, propose 1-3 concrete recovery actions

After collecting evidence, call save_scope_result with:
- Your root cause analysis
- recovery_options: a JSON array of concrete recovery actions (see system prompt format)
  - If the affected service is ECS, include a RESTART_ECS_SERVICE action
  - If a Lambda is involved, consider an INVOKE_LAMBDA rollback action
  - Always include at least one MANUAL action as fallback

Incident time: {now}
Org ID: {org_id}
"""
    try:
        agent(prompt)
        log.info("Scope analysis completed")
        return {"status": "completed", "incidentId": incident_id}
    except Exception as exc:
        log.exception("Scope analysis failed", error=str(exc))
        return {"error": str(exc), "rootCause": "Analysis failed", "affectedServices": [], "blastRadius": "UNKNOWN", "mitigation": "Manual investigation required"}
