"""IM Security Agent Lambda entry point — invoked by im-security-event worker."""

from __future__ import annotations

import json

import structlog

logger = structlog.get_logger(__name__)


def lambda_handler(event: dict, context: object) -> dict:
    security_event_id = event.get("securityEventId", "")
    org_id = event.get("orgId", "")
    finding = event.get("finding", {})

    logger.bind(security_event_id=security_event_id).info("Security agent invoked")

    try:
        from src.agent import run_security_analysis  # noqa: PLC0415
        result = run_security_analysis(security_event_id, org_id, finding)
        return {"statusCode": 200, "body": json.dumps(result)}
    except Exception as exc:
        logger.exception("Security Lambda failed", error=str(exc))
        return {"statusCode": 500, "body": json.dumps({"error": str(exc)})}
