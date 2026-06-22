"""Normalize CloudWatch Alarm / AWS Health events → Incident record + Step Functions."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime

import boto3
import structlog
from python_ulid import ULID

logger = structlog.get_logger(__name__)

INCIDENTS_TABLE = os.environ["IM_INCIDENTS_TABLE"]
TARGETS_TABLE = os.environ["IM_TARGETS_TABLE"]
SFN_ARN = os.environ["IM_SFN_ARN"]
AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-2")

ddb = boto3.resource("dynamodb", region_name=AWS_REGION)
sfn = boto3.client("stepfunctions", region_name=AWS_REGION)


def lambda_handler(event: dict, context: object) -> dict:
    log = logger.bind(event_source=event.get("source", "unknown"))
    log.info("Normalize event invoked")

    try:
        source = event.get("source", "")
        detail = event.get("detail", {})

        if source == "aws.cloudwatch":
            alarm_name = detail.get("alarmName", "")
            account_id = event.get("account", "")
            target = _is_registered_target(alarm_name, account_id, log)
            if not target:
                log.info("Alarm not in investigation targets — skipping", alarm=alarm_name)
                return {"statusCode": 200, "skipped": True, "reason": "not_registered"}
            incident = _from_cloudwatch(event, detail, org_id=target.get("orgId", ""))
        elif source == "aws.health":
            incident = _from_health(event, detail)
        else:
            log.warning("Unknown event source — skipping", source=source)
            return {"statusCode": 200, "skipped": True}

        _save_incident(incident)
        _start_investigation(incident)

        log.info("Incident created", incident_id=incident["incidentId"])
        return {"statusCode": 200, "incidentId": incident["incidentId"]}

    except Exception as exc:
        log.exception("Normalize event failed", error=str(exc))
        return {"statusCode": 500, "error": str(exc)}


def _from_cloudwatch(event: dict, detail: dict, org_id: str = "") -> dict:
    alarm_name = detail.get("alarmName", "unknown")
    state = detail.get("state", {})
    previous_state = detail.get("previousState", {})
    now = datetime.now(UTC).isoformat()
    incident_id = str(ULID())

    return {
        "incidentId": incident_id,
        "orgId": org_id or os.environ.get("ORG_ID", "default"),
        "source": "CLOUDWATCH_ALARM",
        "title": f"CloudWatch Alarm: {alarm_name}",
        "description": state.get("reason", ""),
        "severity": _alarm_severity(alarm_name),
        "status": "OPEN",
        "alarmName": alarm_name,
        "alarmArn": detail.get("alarmArn", ""),
        "region": event.get("region", AWS_REGION),
        "linkedAccountId": event.get("account", ""),
        "previousState": previous_state.get("value", ""),
        "affectedServices": [alarm_name],
        "rawEvent": json.dumps(event),
        "createdAt": now,
        "updatedAt": now,
    }


def _from_health(event: dict, detail: dict) -> dict:
    service = detail.get("service", "unknown")
    event_type = detail.get("eventTypeCode", "unknown")
    now = datetime.now(UTC).isoformat()
    incident_id = str(ULID())

    return {
        "incidentId": incident_id,
        "orgId": os.environ.get("ORG_ID", "default"),
        "source": "AWS_HEALTH",
        "title": f"AWS Health: {service} — {event_type}",
        "description": detail.get("eventDescription", [{}])[0].get("latestDescription", ""),
        "severity": "HIGH",
        "status": "OPEN",
        "affectedServices": [service],
        "region": event.get("region", AWS_REGION),
        "rawEvent": json.dumps(event),
        "createdAt": now,
        "updatedAt": now,
    }


def _is_registered_target(alarm_name: str, account_id: str, log: structlog.BoundLogger) -> dict | None:
    """Return the target item if the alarm is registered, else None. Fail-open on error."""
    try:
        table = ddb.Table(TARGETS_TABLE)
        resp = table.query(
            IndexName="GSI1-account-alarmName-index",
            KeyConditionExpression="GSI1PK = :pk AND GSI1SK = :sk",
            ExpressionAttributeValues={
                ":pk": f"ACCOUNT#{account_id}",
                ":sk": alarm_name,
            },
            Limit=1,
        )
        items = resp.get("Items", [])
        return items[0] if items else None
    except Exception as exc:
        log.warning("Targets check failed — allowing event", error=str(exc))
        return {}  # fail-open: empty dict is truthy, won't break orgId lookup


def _alarm_severity(alarm_name: str) -> str:
    name_lower = alarm_name.lower()
    if any(k in name_lower for k in ("critical", "p1", "sev1")):
        return "CRITICAL"
    if any(k in name_lower for k in ("high", "p2", "sev2", "error")):
        return "HIGH"
    if any(k in name_lower for k in ("medium", "p3", "warn")):
        return "MEDIUM"
    return "HIGH"


def _save_incident(incident: dict) -> None:
    table = ddb.Table(INCIDENTS_TABLE)
    org_id = incident["orgId"]
    account_id = incident.get("linkedAccountId") or "NONE"
    table.put_item(Item={
        "PK": f"INCIDENT#{incident['incidentId']}",
        "SK": "METADATA",
        "GSI1PK": f"ORG#{org_id}",
        "GSI1SK": "STATUS#OPEN",
        "GSI2PK": f"ACCOUNT#{account_id}",
        "GSI2SK": incident["createdAt"],
        **incident,
    })


def _start_investigation(incident: dict) -> None:
    sfn.start_execution(
        stateMachineArn=SFN_ARN,
        name=f"{incident['incidentId']}-auto",
        input=json.dumps({
            "incidentId": incident["incidentId"],
            "orgId": incident["orgId"],
            "source": incident["source"],
            "title": incident["title"],
            "severity": incident["severity"],
        }),
    )
