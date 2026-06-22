"""IM Summary Agent — Korean incident report generation + S3 upload + SES email."""

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
REPORTS_TABLE = os.environ["IM_REPORTS_TABLE"]
REPORTS_BUCKET = os.environ["IM_REPORTS_BUCKET"]
SETTINGS_TABLE = os.environ["IM_SETTINGS_TABLE"]
SES_FROM_ADDRESS = os.environ.get("SES_FROM_ADDRESS", "noreply@seolphung.com")


SUMMARY_SYSTEM_PROMPT = """당신은 AIGO IM 요약 에이전트입니다. 장애보고서를 한국어로 작성하는 전문가입니다.

주어진 장애 정보를 바탕으로:
1. 장애 개요 (제목, 발생시간, 영향도, 심각도)
2. 근본 원인 분석 (Root Cause Analysis)
3. 영향 범위 (Blast Radius, 영향받은 서비스)
4. 조치 사항 (즉각 조치, 복구 과정)
5. 재발 방지 대책 (Prevention)

를 포함한 장애보고서를 작성하고 save_report 도구로 저장하세요.

보고서는 명확하고 구체적으로 작성하며, 기술적 내용을 경영진도 이해할 수 있도록 정리하세요.
"""


@tool
def get_incident_details(incident_id: str) -> str:
    """Fetch incident and investigation data from DynamoDB."""
    import boto3
    ddb = boto3.resource("dynamodb", region_name=AWS_REGION)

    incidents_table = ddb.Table(os.environ["IM_INCIDENTS_TABLE"])
    investigation_table = ddb.Table(os.environ["IM_INVESTIGATION_TABLE"])

    try:
        incident = incidents_table.get_item(
            Key={"PK": f"INCIDENT#{incident_id}", "SK": "METADATA"}
        ).get("Item", {})

        scope_result = investigation_table.get_item(
            Key={"PK": f"INCIDENT#{incident_id}", "SK": "SCOPE_RESULT"}
        ).get("Item", {})

        return json.dumps({
            "incident": incident,
            "scopeResult": scope_result,
        }, default=str)
    except Exception as exc:
        return json.dumps({"error": str(exc)})


@tool
def save_report(
    incident_id: str,
    org_id: str,
    title: str,
    summary: str,
    root_cause: str,
    affected_services: str,
    mitigation: str,
    prevention: str,
) -> str:
    """Save the incident report to S3 and DynamoDB."""
    import boto3
    from datetime import UTC, datetime
    from python_ulid import ULID

    report_id = str(ULID())
    now = datetime.now(UTC).isoformat()
    s3_key = f"reports/{org_id}/{incident_id}/{report_id}.md"

    report_content = f"""# 장애 보고서

**보고서 ID**: {report_id}
**장애 ID**: {incident_id}
**작성일시**: {now}

## 1. 장애 개요
{summary}

## 2. 근본 원인 분석
{root_cause}

## 3. 영향 범위
**영향받은 서비스**: {affected_services}

## 4. 조치 사항
{mitigation}

## 5. 재발 방지 대책
{prevention}
"""

    try:
        s3 = boto3.client("s3", region_name=AWS_REGION)
        s3.put_object(
            Bucket=REPORTS_BUCKET,
            Key=s3_key,
            Body=report_content.encode("utf-8"),
            ContentType="text/markdown; charset=utf-8",
        )

        ddb = boto3.resource("dynamodb", region_name=AWS_REGION)
        table = ddb.Table(REPORTS_TABLE)
        table.put_item(Item={
            "PK": f"REPORT#{report_id}",
            "SK": "METADATA",
            "reportId": report_id,
            "incidentId": incident_id,
            "orgId": org_id,
            "title": title,
            "s3Key": s3_key,
            "s3Bucket": REPORTS_BUCKET,
            "generatedAt": now,
            "GSI1PK": f"ORG#{org_id}",
            "GSI1SK": now,
        })

        # Send notification email if configured in org settings
        _send_report_notification(org_id, report_id, title, summary)

        return json.dumps({"reportId": report_id, "s3Key": s3_key})
    except Exception as exc:
        return json.dumps({"error": str(exc)})


def _send_report_notification(org_id: str, report_id: str, title: str, summary: str) -> None:
    """Lookup org notification email from settings and send SES email. Best-effort."""
    try:
        import boto3
        ddb = boto3.resource("dynamodb", region_name=AWS_REGION)
        settings = ddb.Table(SETTINGS_TABLE).get_item(
            Key={"PK": f"ORG#{org_id}", "SK": "SETTINGS"}
        ).get("Item", {})

        email = settings.get("notificationEmail", "")
        if not email:
            return

        ses = boto3.client("ses", region_name=AWS_REGION)
        ses.send_email(
            Source=SES_FROM_ADDRESS,
            Destination={"ToAddresses": [email]},
            Message={
                "Subject": {
                    "Data": f"[AIGO IM] 장애보고서 생성완료: {title}",
                    "Charset": "UTF-8",
                },
                "Body": {
                    "Html": {
                        "Data": f"""<html><body>
<h2>장애보고서가 생성되었습니다</h2>
<p><strong>보고서 ID:</strong> {report_id}</p>
<p><strong>제목:</strong> {title}</p>
<hr/>
<h3>요약</h3>
<p>{summary.replace(chr(10), '<br/>')}</p>
<hr/>
<p>상세 내용은 AIGO 대시보드에서 확인하세요.</p>
</body></html>""",
                        "Charset": "UTF-8",
                    }
                },
            },
        )
    except Exception:
        pass  # best-effort — do not fail report generation on email error


@tool
def send_report_email(to_email: str, report_id: str, incident_title: str, summary: str) -> str:
    """Send incident report notification via SES."""
    import boto3
    ses = boto3.client("ses", region_name=AWS_REGION)
    try:
        ses.send_email(
            Source=SES_FROM_ADDRESS,
            Destination={"ToAddresses": [to_email]},
            Message={
                "Subject": {"Data": f"[AIGO IM] 장애 보고서: {incident_title}", "Charset": "UTF-8"},
                "Body": {
                    "Text": {
                        "Data": f"장애 보고서가 생성되었습니다.\n\n보고서 ID: {report_id}\n\n{summary}",
                        "Charset": "UTF-8",
                    }
                },
            },
        )
        return json.dumps({"sent": True})
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
        system_prompt=SUMMARY_SYSTEM_PROMPT,
        tools=[get_incident_details, save_report, send_report_email],
    )


def run_summary(incident_id: str, org_id: str, incident_data: dict) -> dict:
    log = logger.bind(incident_id=incident_id)
    log.info("Summary agent starting")

    agent = build_agent()
    prompt = f"""다음 장애에 대한 한국어 보고서를 작성하세요:

장애 ID: {incident_id}
조직 ID: {org_id}
제목: {incident_data.get("title", "")}
심각도: {incident_data.get("severity", "")}
발생시간: {incident_data.get("createdAt", "")}

## 지시사항
1. get_incident_details("{incident_id}")로 상세 정보와 근본 원인 분석 결과를 가져오세요
2. 가져온 정보를 바탕으로 한국어 장애보고서를 작성하세요
3. save_report를 호출하여 보고서를 저장하세요 (이메일 발송은 자동 처리됩니다)

보고서 작성 기준:
- summary: 장애 전체 요약 (발생 시각, 영향, 복구 완료 여부) 3-5줄
- root_cause: 근본 원인 상세 설명
- affected_services: 영향받은 서비스 목록 (쉼표 구분)
- mitigation: 취해진 조치 사항
- prevention: 재발 방지 대책 (3가지 이상)
"""
    try:
        agent(prompt)
        log.info("Summary completed")
        return {"status": "completed", "incidentId": incident_id}
    except Exception as exc:
        log.exception("Summary failed", error=str(exc))
        return {"error": str(exc)}
