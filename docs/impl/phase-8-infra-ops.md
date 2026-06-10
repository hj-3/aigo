# Phase 8: Monitoring, Security, Tests

## 개요
CloudWatch 관측성·WAF·GuardDuty·CloudTrail 보안 제어를 Terraform 모듈로 구현하고,
Python 에이전트 코드에 대한 pytest 기반 테스트 인프라를 구축한다.

---

## modules/monitoring

### 리소스

| 리소스 | 상세 |
|--------|------|
| `aws_cloudwatch_log_group.lambda` | Lambda 함수별 `/aws/lambda/{fn_name}`, 보존 90일, KMS 암호화 |
| `aws_cloudwatch_metric_alarm.lambda_errors` | Lambda 에러율 알람 — `100 * errors / MAX([errors, invocations])` > 1%, 2회 연속 평가 |
| `aws_cloudwatch_metric_alarm.dlq` | DLQ 가시 메시지 수 > 0 즉시 알람 |
| `aws_cloudwatch_metric_alarm.api_5xx` | API Gateway 5xx > 10/5분 |
| `aws_cloudwatch_metric_alarm.api_latency_p99` | API Gateway p99 IntegrationLatency > 10,000ms |
| `aws_cloudwatch_dashboard.overview` | 4-위젯 대시보드 (Lambda 호출수, Lambda duration p95, SQS 깊이, API 요청/에러) |

### 모듈 입력 변수

| 변수 | 설명 |
|------|------|
| `lambda_function_names` | 알람·로그 그룹 생성 대상 Lambda 함수 이름 목록 |
| `sqs_dlq_names` | DLQ 알람 대상 큐 이름 목록 |
| `api_gateway_id` | API Gateway ID (5xx, latency 알람) |
| `sns_alarm_arn` | 알람 발생 시 알림 SNS 토픽 ARN |

### 에러율 알람 수식
```hcl
metric_query {
  id         = "errors"
  metric { ... MetricName = "Errors" }
}
metric_query {
  id         = "invocations"
  metric { ... MetricName = "Invocations" }
}
metric_query {
  id          = "error_rate"
  expression  = "100 * errors / MAX([errors, invocations])"
  return_data = true
}
```
`MAX([errors, invocations])` — 호출 횟수가 0일 때 제로 나누기 방지.

### envs/prod/main.tf 연동
기존 단일 `aws_cloudwatch_metric_alarm.analysis_dlq` 리소스를 제거하고
`module.monitoring` 호출로 교체:

```hcl
module "monitoring" {
  source                = "../../modules/monitoring"
  lambda_function_names = [
    "connector-github", "connector-slack", "connector-aws-event",
    "connector-dashboard-cmd", "worker-lightweight", "dashboard-api"
  ]
  sqs_dlq_names = [
    "analysis-dlq", "fix-dlq", "incident-dlq",
    "notification-dlq", "command-dlq"
  ]
  ...
}
```

---

## modules/security

### 리소스

| 리소스 | 상세 |
|--------|------|
| `aws_guardduty_detector.main` | S3 로그 보호 + EBS 맬웨어 보호 활성화 |
| `aws_wafv2_web_acl.api` | REGIONAL, 4개 관리형 규칙 |
| `aws_wafv2_web_acl_association.api_gateway` | `var.api_gateway_arn != ""` 조건부 연결 |
| `aws_s3_bucket_policy.cloudtrail` | AWSCloudTrailAclCheck + AWSCloudTrailWrite (SourceArn 조건) |
| `aws_cloudtrail.main` | 전체 관리 이벤트 + `{project}-` S3 데이터 이벤트, KMS 암호화, 파일 검증 |
| `aws_cloudwatch_event_rule.guardduty_high` | severity ≥ 7 발견사항 → SNS |

### WAF WebACL 규칙 (우선순위순)

| 우선순위 | 규칙 | 액션 |
|---------|------|------|
| 10 | `AWSManagedRulesCommonRuleSet` | Block |
| 20 | `AWSManagedRulesKnownBadInputsRuleSet` | Block |
| 30 | `AWSManagedRulesSQLiRuleSet` | Block |
| 40 | Rate limit: 동일 IP 5분 내 2,000 요청 초과 | Block |

### API Gateway ARN 형식 (HTTP API v2)
```hcl
api_gateway_arn = "arn:aws:apigateway:${var.aws_region}::/apis/${module.api_gateway.api_id}/stages/prod"
```
HTTP API(v2)는 REST API(v1)와 ARN 포맷이 다르다.  
`/restapis/` 대신 `/apis/`를 사용해야 WAF 연결이 정상 동작한다.

### CloudTrail 설정
- `is_multi_region_trail = false` — 단일 리전(ap-northeast-2) 운영 범위
- `enable_log_file_validation = true` — 로그 무결성 검증 필수
- `include_global_service_events = true` — IAM 등 글로벌 이벤트 포함

---

## 테스트 인프라

### 설정 (`pyproject.toml`)

```toml
[dependency-groups]
dev = [
  "pytest>=8.3.0",
  "pytest-asyncio>=0.24.0",
  "pytest-mock>=3.14.0",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
```

CI 실행: `uv run --group dev pytest tests/`

### 공통 Fixture (`tests/conftest.py`)

`autouse=True` fixture로 모든 테스트에서 AWS 자격증명과 필수 환경변수를 monkeypatch로 주입한다.
실제 AWS 리소스에 접근하지 않으며, 목 클라이언트로 단위 테스트를 수행한다.

```
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION
BEDROCK_KB_ID / GITHUB_SECRET_ARN / SLACK_SECRET_ARN
```

### 테스트 파일 구성

| 파일 | 테스트 수 | 대상 |
|------|-----------|------|
| `tests/test_finding_schema.py` | 10 | Finding, AgentReport Pydantic 스키마 검증 |
| `tests/test_kb_tools.py` | 5 | `kb_tools.py` (Knowledge Base 검색 + filter_tag) |
| `tests/test_ddb_tools.py` | 7 | `ddb_tools.py` (DynamoDB 저장·조회·상태 업데이트) |

### test_finding_schema.py 주요 케이스

| 테스트 | 검증 내용 |
|--------|----------|
| `test_finding_valid` | 정상 Finding 생성 |
| `test_finding_empty_title_raises` | 빈 title → ValidationError |
| `test_finding_confidence_out_of_range_raises` | confidence 0~1 범위 검증 |
| `test_compute_risk_level` | 점수 → 위험 레벨 매핑 (8 케이스) |
| `test_compute_merge_recommendation` | 위험 레벨 → 병합 권고 (6 케이스) |
| `test_agent_report_round_trip` | JSON 직렬화/역직렬화 |

### test_kb_tools.py 주요 케이스

`@patch("kb_tools._kb_client")`으로 Bedrock SDK 호출을 목킹한다.

| 테스트 | 검증 내용 |
|--------|----------|
| `test_search_kb_passes_filter_tag` | `filter_tag="security"` 전달 시 `{"filter": {"equals": {"key": "category", "value": "security"}}}` 포함 여부 |
| `test_search_kb_no_filter_when_tag_is_none` | `filter_tag=None` 시 filter 키 미포함 |

### test_ddb_tools.py 주요 케이스

| 테스트 | 검증 내용 |
|--------|----------|
| `test_save_findings_uses_correct_pk` | PK가 `FINDING#JOB-XYZ`로 시작하는지 검증 |
| `test_update_job_status_writes_correct_keys` | `Key == {"PK": "JOB#...", "SK": "METADATA"}` 검증 |
