"""Process GuardDuty findings → SecurityEvents DDB → invoke security-agent."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime

import boto3
import structlog
from python_ulid import ULID

logger = structlog.get_logger(__name__)

SECURITY_EVENTS_TABLE = os.environ["IM_SECURITY_EVENTS_TABLE"]
INCIDENTS_TABLE = os.environ["IM_INCIDENTS_TABLE"]
IM_SECURITY_AGENT_FUNCTION = os.environ.get("IM_SECURITY_AGENT_FUNCTION", "aigo-im-security-agent")
AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-2")

ddb = boto3.resource("dynamodb", region_name=AWS_REGION)
lambda_client = boto3.client("lambda", region_name=AWS_REGION)


def lambda_handler(event: dict, context: object) -> dict:
    log = logger.bind(source=event.get("source", ""))
    log.info("Security event invoked")

    try:
        source = event.get("source", "")
        detail = event.get("detail", {})

        if source != "aws.guardduty":
            log.warning("Non-GuardDuty event — skipping", source=source)
            return {"statusCode": 200, "skipped": True}

        sec_event = _normalize_guardduty(event, detail)
        _save_security_event(sec_event)

        # Invoke security agent asynchronously
        lambda_client.invoke(
            FunctionName=IM_SECURITY_AGENT_FUNCTION,
            InvocationType="Event",
            Payload=json.dumps({
                "securityEventId": sec_event["securityEventId"],
                "orgId": sec_event["orgId"],
                "finding": detail,
            }).encode(),
        )

        log.info("Security event processed", security_event_id=sec_event["securityEventId"])
        return {"statusCode": 200, "securityEventId": sec_event["securityEventId"]}

    except Exception as exc:
        log.exception("Security event handler failed", error=str(exc))
        return {"statusCode": 500, "error": str(exc)}


def _normalize_guardduty(event: dict, detail: dict) -> dict:
    now = datetime.now(UTC).isoformat()
    event_id = str(ULID())
    severity_num = float(detail.get("severity", 5.0))

    if severity_num >= 7.0:
        severity = "CRITICAL"
    elif severity_num >= 4.0:
        severity = "HIGH"
    elif severity_num >= 1.0:
        severity = "MEDIUM"
    else:
        severity = "LOW"

    return {
        "securityEventId": event_id,
        "orgId": os.environ.get("ORG_ID", "default"),
        "source": "GUARDDUTY",
        "findingId": detail.get("id", ""),
        "findingType": detail.get("type", ""),
        "title": detail.get("title", "GuardDuty Finding"),
        "description": detail.get("description", ""),
        "severity": severity,
        "severityScore": severity_num,
        "region": event.get("region", AWS_REGION),
        "accountId": detail.get("accountId", ""),
        "resourceType": detail.get("resource", {}).get("resourceType", ""),
        "rawFinding": json.dumps(detail),
        "status": "OPEN",
        "createdAt": now,
        "updatedAt": now,
    }


def _save_security_event(sec_event: dict) -> None:
    table = ddb.Table(SECURITY_EVENTS_TABLE)
    org_id = sec_event["orgId"]
    table.put_item(Item={
        "PK": f"SECEVENT#{sec_event['securityEventId']}",
        "SK": "METADATA",
        "GSI1PK": f"ORG#{org_id}",
        "GSI1SK": f"SEVERITY#{sec_event['severity']}",
        **sec_event,
    })
