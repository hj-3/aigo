"""IM Security Agent — GuardDuty finding analysis + playbook via Strands."""

from __future__ import annotations

import json
import os

import structlog
from botocore.config import Config as BotoConfig
from strands import Agent, tool
from strands.models import BedrockModel

logger = structlog.get_logger(__name__)

MODEL_ID = os.environ.get("MODEL_ID", "us.anthropic.claude-sonnet-4-6-20250514-v1:0")
AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-2")
SECURITY_EVENTS_TABLE = os.environ["IM_SECURITY_EVENTS_TABLE"]
ALLOWED_ACTIONS_TABLE = os.environ["IM_ALLOWED_ACTIONS_TABLE"]


SECURITY_SYSTEM_PROMPT = """당신은 AIGO IM 보안 에이전트입니다. AWS GuardDuty 발견 사항을 분석하는 보안 전문가입니다.

주어진 GuardDuty Finding을 분석하여:
1. 위협 유형 파악 (공격 벡터, 위험도)
2. 영향받은 리소스에 대한 CloudTrail 이벤트 확인
3. IAM 리소스인 경우 권한 확인
4. 단계별 대응 플레이북 작성

update_security_event 호출 시 playbook 파라미터는 반드시 아래 JSON 배열 형식이어야 합니다:
[
  {
    "step": 1,
    "title": "즉각 격리",
    "action": "영향받은 EC2 인스턴스의 보안 그룹을 deny-all로 교체하여 네트워크 격리",
    "command": "aws ec2 modify-instance-attribute --instance-id i-xxxx --groups sg-deny-all",
    "risk": "LOW"
  },
  {
    "step": 2,
    "title": "증거 수집",
    "action": "CloudTrail 로그와 VPC Flow Logs를 S3로 내보내기",
    "risk": "LOW"
  }
]

각 플레이북 단계의 risk는 해당 조치를 수행했을 때의 위험도입니다 (LOW/MEDIUM/HIGH).
command 필드는 실행 가능한 AWS CLI 또는 쉘 명령어가 있을 때만 포함하세요.
"""


@tool
def get_cloudtrail_for_resource(resource_arn: str, start_time: str, end_time: str) -> str:
    """Find CloudTrail events related to the compromised resource."""
    import boto3
    from datetime import datetime
    ct = boto3.client("cloudtrail", region_name=AWS_REGION)
    try:
        response = ct.lookup_events(
            LookupAttributes=[{"AttributeKey": "ResourceName", "AttributeValue": resource_arn}],
            StartTime=datetime.fromisoformat(start_time),
            EndTime=datetime.fromisoformat(end_time),
            MaxResults=20,
        )
        events = response.get("Events", [])
        return json.dumps([{
            "eventTime": str(e.get("EventTime", "")),
            "eventName": e.get("EventName", ""),
            "username": e.get("Username", ""),
        } for e in events])
    except Exception as exc:
        return json.dumps({"error": str(exc)})


@tool
def check_iam_policy(resource_arn: str) -> str:
    """Check IAM policies attached to a role or user (for privilege escalation detection)."""
    import boto3
    iam = boto3.client("iam", region_name=AWS_REGION)
    try:
        name = resource_arn.split("/")[-1]
        if ":role/" in resource_arn:
            policies = iam.list_attached_role_policies(RoleName=name)
            return json.dumps(policies.get("AttachedPolicies", []))
        elif ":user/" in resource_arn:
            policies = iam.list_attached_user_policies(UserName=name)
            return json.dumps(policies.get("AttachedPolicies", []))
        return json.dumps({"error": "Unknown resource type"})
    except Exception as exc:
        return json.dumps({"error": str(exc)})


@tool
def update_security_event(
    security_event_id: str,
    threat_type: str,
    risk_level: str,
    analysis: str,
    playbook: str,
    auto_remediated: bool = False,
) -> str:
    """Update the security event record with analysis results and playbook steps.

    playbook: JSON array of {step, title, action, command?, risk}
    """
    import boto3
    from datetime import UTC, datetime
    ddb = boto3.resource("dynamodb", region_name=AWS_REGION)
    table = ddb.Table(SECURITY_EVENTS_TABLE)
    try:
        parsed_playbook = json.loads(playbook) if playbook else []
        if not isinstance(parsed_playbook, list):
            parsed_playbook = []

        table.update_item(
            Key={"PK": f"SECEVENT#{security_event_id}", "SK": "METADATA"},
            UpdateExpression=(
                "SET threatType = :tt, riskLevel = :rl, analysis = :a, "
                "playbook = :pb, autoRemediated = :ar, analyzedAt = :ts, #st = :s"
            ),
            ExpressionAttributeNames={"#st": "status"},
            ExpressionAttributeValues={
                ":tt": threat_type,
                ":rl": risk_level,
                ":a": analysis,
                ":pb": parsed_playbook,
                ":ar": auto_remediated,
                ":ts": datetime.now(UTC).isoformat(),
                ":s": "ANALYZED",
            },
        )
        return json.dumps({"updated": True, "playbookSteps": len(parsed_playbook)})
    except Exception as exc:
        return json.dumps({"error": str(exc)})


def build_agent() -> Agent:
    model = BedrockModel(
        model_id=MODEL_ID,
        region_name=AWS_REGION,
        max_tokens=8192,
        temperature=0.0,
        boto_client_config=BotoConfig(retries={"max_attempts": 5, "mode": "adaptive"}),
    )
    return Agent(
        model=model,
        system_prompt=SECURITY_SYSTEM_PROMPT,
        tools=[get_cloudtrail_for_resource, check_iam_policy, update_security_event],
    )


def run_security_analysis(security_event_id: str, org_id: str, finding: dict) -> dict:
    log = logger.bind(security_event_id=security_event_id)
    log.info("Security agent starting")

    agent = build_agent()
    finding_type = finding.get("type", "")
    resource = json.dumps(finding.get("resource", {}))
    region = finding.get("region", AWS_REGION)
    created_at = finding.get("createdAt", "")

    prompt = f"""GuardDuty 발견 사항을 분석하세요:

보안 이벤트 ID: {security_event_id}
발견 유형: {finding_type}
발생 리전: {region}
발생 시간: {created_at}
영향받은 리소스: {resource}

## 분석 지시사항
1. 발견 유형({finding_type})이 의미하는 공격 벡터와 위험도를 설명하세요
2. 영향받은 리소스에 대한 CloudTrail 이벤트를 확인하세요 (발생 1시간 전후)
3. IAM 리소스인 경우 attached policies를 확인하세요
4. 위협 수준을 평가하세요: CRITICAL / HIGH / MEDIUM / LOW
5. 단계별 대응 플레이북을 3-5단계로 작성하세요 (시스템 프롬프트 형식 참고)
6. update_security_event를 호출하여 분석 결과와 플레이북을 저장하세요

playbook 파라미터에는 JSON 배열 형식으로 플레이북 단계를 전달하세요.
"""
    try:
        agent(prompt)
        log.info("Security analysis completed")
        return {"status": "completed", "securityEventId": security_event_id}
    except Exception as exc:
        log.exception("Security analysis failed", error=str(exc))
        return {"error": str(exc)}
