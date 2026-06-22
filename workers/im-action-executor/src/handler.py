"""Execute approved remediation actions (Lambda invoke, ECS restart, SSM command)."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime

import boto3
import structlog
from python_ulid import ULID

logger = structlog.get_logger(__name__)

RECOVERY_ACTIONS_TABLE = os.environ["IM_RECOVERY_ACTIONS_TABLE"]
ALLOWED_ACTIONS_TABLE = os.environ["IM_ALLOWED_ACTIONS_TABLE"]
SETTINGS_TABLE = os.environ["IM_SETTINGS_TABLE"]
INCIDENTS_TABLE = os.environ["IM_INCIDENTS_TABLE"]
AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-2")

ddb = boto3.resource("dynamodb", region_name=AWS_REGION)
sts = boto3.client("sts", region_name=AWS_REGION)


def lambda_handler(event: dict, context: object) -> dict:
    action_id = event.get("actionId", str(ULID()))
    log = logger.bind(action_id=action_id, action_type=event.get("actionType"))
    log.info("Action executor invoked")

    try:
        if not _is_allowed(event):
            log.warning("Action not in allowed list — rejected")
            _record_action(event, action_id, "REJECTED", "Action not permitted")
            return {"statusCode": 403, "error": "ACTION_NOT_ALLOWED"}

        result = _execute(event, log)
        _record_action(event, action_id, "COMPLETED", json.dumps(result))
        log.info("Action completed", result=result)
        return {"statusCode": 200, "actionId": action_id, "result": result}

    except Exception as exc:
        log.exception("Action executor failed", error=str(exc))
        _record_action(event, action_id, "FAILED", str(exc))
        return {"statusCode": 500, "error": str(exc)}


def _is_allowed(event: dict) -> bool:
    action_type = event.get("actionType", "")
    org_id = event.get("orgId", "")

    # Check org remediation mode first — ALL mode bypasses the allowlist
    settings_table = ddb.Table(SETTINGS_TABLE)
    settings_resp = settings_table.get_item(Key={"PK": f"ORG#{org_id}", "SK": "SETTINGS"})
    mode = settings_resp.get("Item", {}).get("mode", "ALLOWLIST")
    if mode == "ALL":
        return True

    allowed_table = ddb.Table(ALLOWED_ACTIONS_TABLE)
    result = allowed_table.get_item(Key={"PK": f"ORG#{org_id}", "SK": f"ACTION#{action_type}"})
    return bool(result.get("Item", {}).get("isEnabled", False))


def _execute(event: dict, log: structlog.BoundLogger) -> dict:
    action_type = event.get("actionType", "")
    params = event.get("params", {})
    cross_account_role = event.get("crossAccountRoleArn")

    session = _get_session(cross_account_role) if cross_account_role else boto3

    if action_type == "RESTART_ECS_SERVICE":
        return _restart_ecs(session, params)
    elif action_type == "INVOKE_LAMBDA":
        return _invoke_lambda(session, params)
    elif action_type == "SSM_RUN_COMMAND":
        return _run_ssm(session, params)
    else:
        raise ValueError(f"Unknown action type: {action_type}")


def _get_session(role_arn: str) -> object:
    creds = sts.assume_role(
        RoleArn=role_arn,
        RoleSessionName="im-action-executor",
        ExternalId="aigo-im-monitoring",
    )["Credentials"]
    return boto3.Session(
        aws_access_key_id=creds["AccessKeyId"],
        aws_secret_access_key=creds["SecretAccessKey"],
        aws_session_token=creds["SessionToken"],
    )


def _restart_ecs(session: object, params: dict) -> dict:
    client = session.client("ecs", region_name=params.get("region", AWS_REGION))
    client.update_service(
        cluster=params["cluster"],
        service=params["service"],
        forceNewDeployment=True,
    )
    return {"action": "ECS_RESTARTED", "service": params["service"]}


def _invoke_lambda(session: object, params: dict) -> dict:
    client = session.client("lambda", region_name=params.get("region", AWS_REGION))
    response = client.invoke(
        FunctionName=params["functionName"],
        InvocationType=params.get("invocationType", "RequestResponse"),
        Payload=json.dumps(params.get("payload", {})).encode(),
    )
    return {"action": "LAMBDA_INVOKED", "statusCode": response["StatusCode"]}


def _run_ssm(session: object, params: dict) -> dict:
    client = session.client("ssm", region_name=params.get("region", AWS_REGION))
    response = client.send_command(
        InstanceIds=params["instanceIds"],
        DocumentName=params.get("documentName", "AWS-RunShellScript"),
        Parameters=params.get("parameters", {}),
    )
    return {"action": "SSM_COMMAND_SENT", "commandId": response["Command"]["CommandId"]}


def _record_action(event: dict, action_id: str, status: str, result: str) -> None:
    try:
        now = datetime.now(UTC).isoformat()
        table = ddb.Table(RECOVERY_ACTIONS_TABLE)
        table.put_item(Item={
            "PK": f"INCIDENT#{event.get('incidentId', 'UNKNOWN')}",
            "SK": f"ACTION#{action_id}",
            "actionId": action_id,
            "incidentId": event.get("incidentId", ""),
            "orgId": event.get("orgId", ""),
            "actionType": event.get("actionType", ""),
            "params": json.dumps(event.get("params", {})),
            "status": status,
            "result": result[:2000],
            "executedAt": now,
        })
    except Exception:
        pass  # Best effort
