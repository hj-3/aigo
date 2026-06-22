"""IM Scope Agent Lambda entry point."""

from __future__ import annotations

import json

import structlog

logger = structlog.get_logger(__name__)


def lambda_handler(event: dict, context: object) -> dict:
    incident_id = event.get("incidentId", "")
    org_id = event.get("orgId", "")
    incident_data = event.get("incidentData", event)

    logger.bind(incident_id=incident_id).info("Scope agent invoked")

    try:
        from src.agent import run_scope_analysis  # noqa: PLC0415
        result = run_scope_analysis(incident_id, org_id, incident_data)
        return {"statusCode": 200, "body": json.dumps(result)}
    except Exception as exc:
        logger.exception("Scope Lambda failed", error=str(exc))
        return {"statusCode": 500, "body": json.dumps({"error": str(exc)})}
