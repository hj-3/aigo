"""IM Supervisor Lambda — pure Python coordinator (NOT a Strands Agent).
Invokes scope_agent + summary_agent in parallel, then updates incident status.
"""

from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime

import boto3
import structlog

logger = structlog.get_logger(__name__)

INCIDENTS_TABLE = os.environ["IM_INCIDENTS_TABLE"]
SCOPE_AGENT_FUNCTION = os.environ.get("IM_SCOPE_AGENT_FUNCTION", "aigo-im-scope-agent")
SUMMARY_AGENT_FUNCTION = os.environ.get("IM_SUMMARY_AGENT_FUNCTION", "aigo-im-summary-agent")
AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-2")

ddb = boto3.resource("dynamodb", region_name=AWS_REGION)
lambda_client = boto3.client("lambda", region_name=AWS_REGION)


def lambda_handler(event: dict, context: object) -> dict:
    incident_id = event.get("incidentId", "")
    org_id = event.get("orgId", "")
    log = logger.bind(incident_id=incident_id, org_id=org_id)
    log.info("Supervisor invoked")

    try:
        # Fetch full incident data (poll_investigation already set status=INVESTIGATING)
        table = ddb.Table(INCIDENTS_TABLE)
        response = table.get_item(Key={"PK": f"INCIDENT#{incident_id}", "SK": "METADATA"})
        incident = response.get("Item", event)

        payload = json.dumps({
            "incidentId": incident_id,
            "orgId": org_id,
            "incidentData": incident,
        }).encode()

        # Invoke scope + summary in parallel
        with ThreadPoolExecutor(max_workers=2) as executor:
            scope_future = executor.submit(_invoke, SCOPE_AGENT_FUNCTION, payload)
            summary_future = executor.submit(_invoke, SUMMARY_AGENT_FUNCTION, payload)

            scope_result = scope_future.result(timeout=600)
            summary_result = summary_future.result(timeout=600)

        _update_status(incident_id, "REPORTED", {
            "rootCause": scope_result.get("rootCause", ""),
            "reportId": summary_result.get("reportId", ""),
        })

        log.info("Supervisor completed")
        return {
            "statusCode": 200,
            "body": json.dumps({
                "incidentId": incident_id,
                "status": "REPORTED",
                "scopeResult": scope_result,
                "summaryResult": summary_result,
            }),
        }

    except Exception as exc:
        log.exception("Supervisor failed", error=str(exc))
        _update_status(incident_id, "INVESTIGATION_FAILED")
        return {"statusCode": 500, "body": json.dumps({"error": str(exc)})}


def _invoke(function_name: str, payload: bytes) -> dict:
    try:
        response = lambda_client.invoke(
            FunctionName=function_name,
            InvocationType="RequestResponse",
            Payload=payload,
        )
        result = json.loads(response["Payload"].read())
        body = result.get("body", "{}")
        return json.loads(body) if isinstance(body, str) else body
    except Exception as exc:
        logger.exception("Sub-Lambda invocation failed", function=function_name, error=str(exc))
        return {"error": str(exc)}


def _update_status(incident_id: str, status: str, extra: dict | None = None) -> None:
    table = ddb.Table(INCIDENTS_TABLE)
    updates = ["#st = :s", "updatedAt = :now", "GSI1SK = :gsi1sk"]
    attr_values: dict = {
        ":s": status,
        ":now": datetime.now(UTC).isoformat(),
        ":gsi1sk": f"STATUS#{status}",
    }
    if extra:
        for k, v in extra.items():
            updates.append(f"{k} = :{k}")
            attr_values[f":{k}"] = v

    table.update_item(
        Key={"PK": f"INCIDENT#{incident_id}", "SK": "METADATA"},
        UpdateExpression=f"SET {', '.join(updates)}",
        ExpressionAttributeNames={"#st": "status"},
        ExpressionAttributeValues=attr_values,
    )
