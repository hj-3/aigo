"""im-poll-investigation: Step Functions task — kicks off async investigation.

Called by Step Functions as the first task in the investigation state machine.
Responsibilities:
  1. Update DDB Incidents status → INVESTIGATING
  2. Invoke im-supervisor-agent Lambda asynchronously (InvocationType=Event)
  3. Return immediately — Step Functions polls DDB every 60s until REPORTED/FAILED
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime

import boto3
import structlog

logger = structlog.get_logger(__name__)

AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-2")
INCIDENTS_TABLE = os.environ["IM_INCIDENTS_TABLE"]
SUPERVISOR_FUNCTION = os.environ.get("IM_SUPERVISOR_FUNCTION", "aigo-im-supervisor-agent:live")

ddb = boto3.resource("dynamodb", region_name=AWS_REGION)
lambda_client = boto3.client("lambda", region_name=AWS_REGION)


def _update_status(incident_id: str, status: str) -> None:
    table = ddb.Table(INCIDENTS_TABLE)
    table.update_item(
        Key={"PK": f"INCIDENT#{incident_id}", "SK": "METADATA"},
        UpdateExpression="SET #s = :s, updatedAt = :t",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":s": status,
            ":t": datetime.now(UTC).isoformat(),
        },
    )


def lambda_handler(event: dict, context: object) -> dict:
    incident_id = event.get("incidentId", "")
    log = logger.bind(incident_id=incident_id)

    if not incident_id:
        log.error("Missing incidentId in event")
        raise ValueError("incidentId is required")

    log.info("poll_investigation started")

    _update_status(incident_id, "INVESTIGATING")
    log.info("Status updated to INVESTIGATING")

    # Invoke supervisor asynchronously — SFN will poll DDB until REPORTED/FAILED
    lambda_client.invoke(
        FunctionName=SUPERVISOR_FUNCTION,
        InvocationType="Event",
        Payload=json.dumps(event).encode(),
    )
    log.info("Supervisor invoked async", function=SUPERVISOR_FUNCTION)

    return {"status": "STARTED", "incidentId": incident_id}
