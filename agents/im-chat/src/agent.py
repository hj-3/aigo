"""IM Chat Agent — Strands Agent for incident Q&A powered by Bedrock Claude.

User chats with the agent about a specific incident.
Agent has access to incident data, investigation results, and real-time metrics.
Conversation history is persisted in aigo-im-Conversations DynamoDB table.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime

import boto3
import structlog
from botocore.config import Config as BotoConfig
from python_ulid import ULID
from strands import Agent, tool
from strands.models import BedrockModel

logger = structlog.get_logger(__name__)

MODEL_ID = os.environ.get("MODEL_ID", "us.anthropic.claude-sonnet-4-6-20250514-v1:0")
AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-2")
INCIDENTS_TABLE = os.environ["IM_INCIDENTS_TABLE"]
INVESTIGATION_TABLE = os.environ["IM_INVESTIGATION_TABLE"]
CONVERSATIONS_TABLE = os.environ["IM_CONVERSATIONS_TABLE"]

ddb = boto3.resource("dynamodb", region_name=AWS_REGION)


CHAT_SYSTEM_PROMPT = """당신은 AIGO 인시던트 관리 어시스턴트입니다.
주어진 인시던트에 대한 질문에 답변하는 전문 AI입니다.

역할:
- 인시던트 데이터, 조사 결과, CloudWatch 메트릭을 기반으로 답변
- 한국어로 명확하고 간결하게 답변
- 불확실한 내용은 추측하지 않고 데이터 조회 후 답변
- 복구 방안 제안 시 반드시 근거 제시

사용 가능한 도구:
- get_incident_summary: 인시던트 기본 정보 조회
- get_scope_analysis: 근본 원인 분석 결과 조회
- get_metrics_at_time: 특정 시점 CloudWatch 메트릭 조회
- get_recovery_status: 현재 복구 작업 현황
"""


@tool
def get_incident_summary(incident_id: str) -> str:
    """인시던트 기본 정보와 현재 상태를 조회합니다."""
    table = ddb.Table(INCIDENTS_TABLE)
    try:
        item = table.get_item(
            Key={"PK": f"INCIDENT#{incident_id}", "SK": "METADATA"}
        ).get("Item", {})
        return json.dumps({
            "incidentId": incident_id,
            "title": item.get("title", ""),
            "status": item.get("status", ""),
            "severity": item.get("severity", ""),
            "source": item.get("source", ""),
            "affectedServices": item.get("affectedServices", []),
            "createdAt": item.get("createdAt", ""),
            "updatedAt": item.get("updatedAt", ""),
            "rootCause": item.get("rootCause", "분석 중"),
            "resolution": item.get("resolution", ""),
        }, default=str)
    except Exception as exc:
        return json.dumps({"error": str(exc)})


@tool
def get_scope_analysis(incident_id: str) -> str:
    """scope_agent가 수행한 근본 원인 분석 결과를 조회합니다."""
    table = ddb.Table(INVESTIGATION_TABLE)
    try:
        item = table.get_item(
            Key={"PK": f"INCIDENT#{incident_id}", "SK": "SCOPE_RESULT"}
        ).get("Item", {})
        if not item:
            return json.dumps({"message": "분석 결과 없음 — 아직 조사 진행 중이거나 분석이 수행되지 않았습니다."})
        return json.dumps(item, default=str)
    except Exception as exc:
        return json.dumps({"error": str(exc)})


@tool
def get_metrics_at_time(
    namespace: str,
    metric_name: str,
    resource_id: str,
    timestamp: str,
    window_minutes: int = 30,
) -> str:
    """특정 시점 전후의 CloudWatch 메트릭을 조회합니다."""
    import boto3
    from datetime import timedelta
    cw = boto3.client("cloudwatch", region_name=AWS_REGION)
    try:
        end_time = datetime.fromisoformat(timestamp)
        start_time = end_time - timedelta(minutes=window_minutes)
        response = cw.get_metric_statistics(
            Namespace=namespace,
            MetricName=metric_name,
            Dimensions=[{"Name": "InstanceId", "Value": resource_id}],
            StartTime=start_time,
            EndTime=end_time,
            Period=60,
            Statistics=["Average", "Maximum"],
        )
        datapoints = sorted(
            response.get("Datapoints", []),
            key=lambda x: x.get("Timestamp", ""),
        )
        return json.dumps([{
            "timestamp": str(dp.get("Timestamp", "")),
            "average": dp.get("Average", 0),
            "maximum": dp.get("Maximum", 0),
        } for dp in datapoints[-10:]])
    except Exception as exc:
        return json.dumps({"error": str(exc)})


@tool
def get_recovery_status(incident_id: str) -> str:
    """현재 복구 작업 현황을 조회합니다."""
    from boto3.dynamodb.conditions import Key
    recovery_table = os.environ["IM_RECOVERY_ACTIONS_TABLE"]
    table = ddb.Table(recovery_table)
    try:
        response = table.query(
            KeyConditionExpression=Key("PK").eq(f"INCIDENT#{incident_id}"),
        )
        return json.dumps(response.get("Items", []), default=str)
    except Exception as exc:
        return json.dumps({"error": str(exc)})


def build_agent() -> Agent:
    model = BedrockModel(
        model_id=MODEL_ID,
        region_name=AWS_REGION,
        max_tokens=4096,
        temperature=0.1,
        boto_client_config=BotoConfig(retries={"max_attempts": 5, "mode": "adaptive"}),
    )
    return Agent(
        model=model,
        system_prompt=CHAT_SYSTEM_PROMPT,
        tools=[get_incident_summary, get_scope_analysis, get_metrics_at_time, get_recovery_status],
    )


def run_chat(incident_id: str, org_id: str, user_id: str, message: str, conv_id: str | None) -> dict:
    log = logger.bind(incident_id=incident_id, user_id=user_id)
    log.info("Chat agent invoked")

    agent = build_agent()
    now = datetime.now(UTC).isoformat()
    new_conv_id = conv_id or str(ULID())
    ttl = int(datetime.now(UTC).timestamp()) + 30 * 24 * 60 * 60

    prompt = f"""인시던트 ID: {incident_id}
사용자 질문: {message}

위 인시던트에 대해 질문에 답변하세요. 필요하면 도구를 사용해 최신 데이터를 조회하세요."""

    try:
        response = agent(prompt)
        reply = str(response)

        # Persist both turns to DynamoDB
        table = ddb.Table(CONVERSATIONS_TABLE)
        for role, content in [("user", message), ("assistant", reply)]:
            msg_id = str(ULID())
            table.put_item(Item={
                "PK": f"CONV#{new_conv_id}",
                "SK": f"MSG#{msg_id}",
                "convId": new_conv_id,
                "incidentId": incident_id,
                "orgId": org_id,
                "userId": user_id,
                "role": role,
                "content": content[:4096],
                "createdAt": now,
                "ttl": ttl,
                "GSI1PK": f"INCIDENT#{incident_id}#ORG#{org_id}",
                "GSI1SK": now,
            })

        log.info("Chat response generated")
        return {"response": reply, "convId": new_conv_id}

    except Exception as exc:
        log.exception("Chat agent failed", error=str(exc))
        return {"error": str(exc), "response": "죄송합니다. 답변을 생성하는 중 오류가 발생했습니다."}
