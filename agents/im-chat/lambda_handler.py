"""IM Chat Agent Lambda entry point — invoked by im-api POST /chat/{incidentId}."""

from __future__ import annotations

import json

import structlog

logger = structlog.get_logger(__name__)


def lambda_handler(event: dict, context: object) -> dict:
    incident_id = event.get("incidentId", "")
    org_id = event.get("orgId", "")
    user_id = event.get("userId", "")
    message = event.get("message", "")
    conv_id = event.get("convId")

    log = logger.bind(incident_id=incident_id, user_id=user_id)
    log.info("Chat Lambda invoked")

    if not message.strip():
        return {"statusCode": 400, "body": json.dumps({"error": "message is required"})}

    try:
        from src.agent import run_chat  # noqa: PLC0415
        result = run_chat(incident_id, org_id, user_id, message, conv_id)
        return {"statusCode": 200, "body": json.dumps(result)}
    except Exception as exc:
        log.exception("Chat Lambda failed", error=str(exc))
        return {"statusCode": 500, "body": json.dumps({"error": str(exc)})}
