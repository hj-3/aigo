"""Receive webhook payloads from external monitoring tools (PagerDuty, OpsGenie, etc.)."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from datetime import UTC, datetime

import boto3
import structlog
from python_ulid import ULID

logger = structlog.get_logger(__name__)

INCIDENTS_TABLE = os.environ["IM_INCIDENTS_TABLE"]
INTEGRATIONS_TABLE = os.environ["IM_INTEGRATIONS_TABLE"]
SFN_ARN = os.environ["IM_SFN_ARN"]
AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-2")

ddb = boto3.resource("dynamodb", region_name=AWS_REGION)
sfn = boto3.client("stepfunctions", region_name=AWS_REGION)


def lambda_handler(event: dict, context: object) -> dict:
    log = logger.bind(path=event.get("rawPath", ""))
    log.info("Webhook receiver invoked")

    try:
        path_params = event.get("pathParameters", {}) or {}
        integration_id = path_params.get("integrationId", "")
        body_raw = event.get("body", "") or ""
        headers = {k.lower(): v for k, v in (event.get("headers", {}) or {}).items()}

        integration = _get_integration(integration_id)
        if not integration:
            return _response(404, {"error": "NOT_FOUND"})

        token = headers.get("x-webhook-token", "")
        if not _verify_token(integration, token):
            return _response(403, {"error": "FORBIDDEN"})

        payload = json.loads(body_raw) if body_raw else {}
        incident = _normalize_payload(integration, payload)
        _save_incident(incident)
        _start_investigation(incident)

        log.info("Webhook incident created", incident_id=incident["incidentId"])
        return _response(200, {"received": True, "incidentId": incident["incidentId"]})

    except Exception as exc:
        log.exception("Webhook receiver failed", error=str(exc))
        return _response(500, {"error": str(exc)})


def _get_integration(integration_id: str) -> dict | None:
    table = ddb.Table(INTEGRATIONS_TABLE)
    # Scan for matching integrationId (small table — acceptable for now)
    result = table.scan(
        FilterExpression="integrationId = :id AND enabled = :t",
        ExpressionAttributeValues={":id": integration_id, ":t": True},
        Limit=1,
    )
    items = result.get("Items", [])
    return items[0] if items else None


def _verify_token(integration: dict, provided_token: str) -> bool:
    expected = integration.get("webhookToken", "")
    if not expected:
        return False
    return hmac.compare_digest(str(expected), str(provided_token))


def _normalize_payload(integration: dict, payload: dict) -> dict:
    integration_type = integration.get("type", "WEBHOOK")
    org_id = integration["orgId"]
    now = datetime.now(UTC).isoformat()
    incident_id = str(ULID())

    if integration_type == "PAGERDUTY":
        message = payload.get("messages", [{}])[0] if payload.get("messages") else payload
        title = message.get("event", {}).get("description", "PagerDuty incident")
        severity = message.get("event", {}).get("data", {}).get("severity", "HIGH").upper()
    elif integration_type == "OPSGENIE":
        title = payload.get("title", "OpsGenie alert")
        severity = payload.get("priority", "P2").replace("P1", "CRITICAL").replace("P2", "HIGH").replace("P3", "MEDIUM")
    else:
        title = str(payload.get("title", payload.get("summary", "Webhook incident")))
        severity = str(payload.get("severity", "HIGH")).upper()

    return {
        "incidentId": incident_id,
        "orgId": org_id,
        "source": f"WEBHOOK_{integration_type}",
        "integrationId": integration.get("integrationId", ""),
        "title": title,
        "severity": severity if severity in ("CRITICAL", "HIGH", "MEDIUM", "LOW") else "HIGH",
        "status": "OPEN",
        "affectedServices": payload.get("affectedServices", []),
        "rawEvent": json.dumps(payload),
        "createdAt": now,
        "updatedAt": now,
    }


def _save_incident(incident: dict) -> None:
    table = ddb.Table(INCIDENTS_TABLE)
    org_id = incident["orgId"]
    table.put_item(Item={
        "PK": f"INCIDENT#{incident['incidentId']}",
        "SK": "METADATA",
        "GSI1PK": f"ORG#{org_id}",
        "GSI1SK": "STATUS#OPEN",
        "GSI2PK": "ACCOUNT#NONE",
        "GSI2SK": incident["createdAt"],
        **incident,
    })


def _start_investigation(incident: dict) -> None:
    sfn.start_execution(
        stateMachineArn=SFN_ARN,
        name=f"{incident['incidentId']}-webhook",
        input=json.dumps({
            "incidentId": incident["incidentId"],
            "orgId": incident["orgId"],
        }),
    )


def _response(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }
