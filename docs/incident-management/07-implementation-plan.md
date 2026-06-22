# AIGO Incident Management — 구현 계획

## 전제

- CM(`infra/terraform/envs/prod/`) 코드 변경 없음
- IM은 `services/incident-management/` 하위에 완전 독립 구성
- 프런트엔드는 `apps/dashboard/`에 탭 추가만

---

## 추가/수정 파일 전체 목록

```
# IM 백엔드 (신규, CM과 무관)
services/incident-management/
  api/                           im-api Lambda (Node.js, Hono)
  agents/
    im-supervisor/               Strands supervisor
    im-scope/                    Strands scope 분석
    im-summary/                  Strands 보고서 생성
    im-security/                 Strands 보안 플레이북
    im-chat/                     Strands 리소스 진단
  workers/
    im-normalize-event/          이벤트 정규화
    im-webhook-receiver/         외부 도구 Webhook
    im-security-event-handler/   보안 이벤트 처리
    im-action-executor/          조치 실행
  infra/terraform/
    envs/prod/
      main.tf                    IM 전체 리소스 + data source 참조
      variables.tf
      outputs.tf
      backend.tf                 aigo-tf-state / services/im/prod/
    modules/im-core/             Lambda, DDB 등 IM 전용 모듈

# CI/CD (신규)
.github/workflows/im-deploy.yml

# 프런트엔드 (기존 파일 최소 수정)
apps/dashboard/src/
  router.tsx                     /im/* 라우트 추가
  components/Layout.tsx          사이드바 IM 섹션 추가
  pages/im/
    DashboardPage.tsx
    IncidentsPage.tsx
    RemediationPage.tsx
    ResourceDiagPage.tsx
    SecurityPage.tsx
    MonitoringPage.tsx
    ManagePage.tsx
.env.production                  VITE_IM_API_URL=https://im-api.seolphung.com 추가
```

---

## Phase A — IM Terraform 인프라

**작업 위치**: `services/incident-management/infra/terraform/envs/prod/`

```hcl
# backend.tf
terraform {
  backend "s3" {
    bucket         = "aigo-tf-state"
    key            = "services/im/prod/terraform.tfstate"
    region         = "ap-northeast-2"
    dynamodb_table = "aigo-tf-locks"
    encrypt        = true
  }
}
```

**생성 리소스**
```
API Gateway REST API (aigo-im-api)
  Custom Domain: im-api.seolphung.com
  Route53 A record: im-api.seolphung.com
  Cognito Authorizer → 기존 aigo-user-pool 참조

EventBridge Bus: aigo-im-event-bus
  Rule: CloudWatch ALARM (enabled=false, 검증 후 활성화)
  Rule: AWS Health Event (enabled=false)
  Rule: GuardDuty findings (enabled=true)

Step Functions: aigo-im-investigation

S3: aigo-im-reports-{accountId} (365일 lifecycle)

DynamoDB × 11 (aigo-im-* 네이밍, 모두 PAY_PER_REQUEST)

IAM Role × 10 (Lambda별 + Step Functions)

Lambda × 10 (placeholder 코드, 이후 Phase에서 실제 배포)
```

**완료 기준**: `terraform apply` 성공, `im-api.seolphung.com` DNS 응답 확인
**상태**: ⬜ 미시작

---

## Phase B — im-api Lambda (REST API 핸들러)

**위치**: `services/incident-management/api/`  
**런타임**: Node.js 22.x, Hono 프레임워크 (dashboard-api와 동일 패턴)

```typescript
// src/index.ts
const app = new Hono()
app.use('*', cognitoAuthMiddleware)   // 동일 JWT 검증

app.route('/incidents',    incidentsRouter)
app.route('/targets',      targetsRouter)
app.route('/remediations', remediationsRouter)
app.route('/security',     securityRouter)
app.route('/chat',         chatRouter)
app.route('/accounts',     accountsRouter)
app.route('/settings',     settingsRouter)
app.route('/webhook',      webhookRouter)   // 인증 제외
app.get('/summary',        summaryHandler)
```

**완료 기준**: `GET https://im-api.seolphung.com/summary` 200 응답
**상태**: ⬜ 미시작

---

## Phase C — im-normalize-event + im-webhook-receiver

**목표**: 모든 입력 경로 → 공통 인시던트 생성

**normalize-event 핵심**
```python
def lambda_handler(event, context):
    normalized = normalize(event)  # CW Alarm 또는 Health Event

    # InvestigationTargets 확인 (등록된 알람만 처리)
    if not is_registered_target(normalized['awsAccountId'], normalized['alarmName']):
        return

    incident_id = create_incident(normalized)     # DDB PutItem
    start_investigation(incident_id)              # SFN StartExecution
```

**webhook-receiver 핵심**
```python
def lambda_handler(event, context):
    integration_id = event['pathParameters']['integrationId']
    api_key = event['headers'].get('x-integration-key', '')

    integration = get_integration(integration_id)
    if not verify_key(api_key, integration['apiKeyHash']):
        return { 'statusCode': 401 }

    # toolType별 정규화 (ZABBIX / PROMETHEUS / GRAFANA)
    normalized = normalize_external(event['body'], integration['toolType'],
                                    integration['fieldMapping'])
    incident_id = create_incident(normalized, source='EXTERNAL_TOOL',
                                  integration_id=integration_id)
    start_investigation(incident_id)
```

**완료 기준**:
- CloudWatch 알람 수동 트리거 → 등록된 알람이면 DDB 생성, 미등록이면 무시
- Postman으로 Zabbix 포맷 POST → DDB 인시던트 생성
**상태**: ⬜ 미시작

---

## Phase D — im-scope-agent (Strands)

**목표**: 근본 원인 분석, 영향 범위, mitigationOptions 생성

**Linked Account 지원**
```python
def get_client(service, account_id, region='ap-northeast-2'):
    if account_id != CURRENT_ACCOUNT_ID:
        linked = get_linked_account(account_id)
        sts = boto3.client('sts')
        creds = sts.assume_role(
            RoleArn=linked['crossAccountRoleArn'],
            RoleSessionName='aigo-im-scope'
        )['Credentials']
        return boto3.client(service, region_name=region,
            aws_access_key_id=creds['AccessKeyId'],
            aws_secret_access_key=creds['SecretAccessKey'],
            aws_session_token=creds['SessionToken'])
    return boto3.client(service, region_name=region)
```

**완료 기준**: 테스트 인시던트 → DDB im-InvestigationResults 저장 확인
**상태**: ⬜ 미시작

---

## Phase E — im-summary-agent (Strands)

**목표**: 한국어 장애보고서 생성 → S3 저장 → SES 이메일

**이메일 발신**: `noreply@seolphung.com` (기존 SES Identity 재사용)

**보고서 형식** (외부 공유 가능)
```
1. 장애 개요 (발생 시각, 심각도, 영향 서비스)
2. 근본 원인 분석
3. 영향 범위
4. 이벤트 타임라인
5. 현재 상태 및 조치 방안
6. 재발 방지 권고사항
```

**완료 기준**: S3 파일 존재 + `noreply@seolphung.com` 발신 이메일 수신
**상태**: ⬜ 미시작

---

## Phase F — im-poll-investigation + im-supervisor + Step Functions 통합

**목표**: poll_investigation으로 조사 시작 → 폴링 패턴으로 완료 확인

**Step Functions 폴링 패턴**:
```
StartInvestigation (poll_investigation Lambda, 30s)
    → WaitForInvestigation (60s 대기)
    → CheckStatus (DDB GetItem)
    → EvaluateStatus (Choice)
        REPORTED         → Done
        INVESTIGATION_FAILED → Fail
        (그 외)          → WaitForInvestigation (반복)
```

**poll_investigation Lambda 로직**:
```python
def lambda_handler(event, context):
    incident_id = event["incidentId"]
    _update_status(incident_id, "INVESTIGATING")   # DDB status 갱신
    lambda_client.invoke(
        FunctionName="aigo-im-supervisor-agent:live",
        InvocationType="Event",                   # 비동기 호출 — 즉시 반환
        Payload=json.dumps(event),
    )
    return {"status": "STARTED", "incidentId": incident_id}
```

**supervisor Lambda 완료 후**:
```python
# scope + summary 병렬 실행 완료 후
_update_status(incident_id, "REPORTED", result_summary)
# INVESTIGATION_FAILED는 finally 블록에서 예외 시 업데이트
```

**완료 기준**: CloudWatch 알람 E2E → SFN 그래프 완료(폴링 2~14 사이클), DDB status=REPORTED
**상태**: ⬜ 미시작

---

## Phase G — im-security-event-handler + im-security-agent

**완료 기준**: GuardDuty 테스트 finding → DDB im-SecurityEvents + 플레이북 저장
**상태**: ⬜ 미시작

---

## Phase H — im-action-executor

**목표**: AllowList/All 모드 + Linked Account AssumeRole + 실행

**완료 기준**: AllowList 모드 + 활성 액션 실행 → AuditLogs 기록, Linked Account 조치 확인
**상태**: ⬜ 미시작

---

## Phase I — im-chat-agent (리소스 진단)

**완료 기준**: EC2 선택 → "최근 CPU 급등 원인" 채팅 → CloudWatch 기반 응답
**상태**: ⬜ 미시작

---

## Phase J — 프런트엔드 탭 추가

**수정 파일** (최소)
```
apps/dashboard/src/router.tsx            /im/* 라우트 추가
apps/dashboard/src/components/Layout.tsx 사이드바 Incident Management 섹션 추가
apps/dashboard/.env.production           VITE_IM_API_URL=https://im-api.seolphung.com
```

**신규 페이지**
```
apps/dashboard/src/pages/im/
  DashboardPage.tsx       활성 인시던트 요약 카드
  IncidentsPage.tsx       목록 + 상세 + 장애보고서 + Mitigation Plan
  RemediationPage.tsx     조치 현황 + 순차 실행
  ResourceDiagPage.tsx    서비스 선택 + AI 채팅 (리소스 진단)
  SecurityPage.tsx        보안 이벤트 + 플레이북
  MonitoringPage.tsx      CloudWatch 메트릭 현황
  ManagePage.tsx          계정 관리 + 자동 조치 설정
    ├── AccountsTab.tsx   Linked Account 목록 + 추가
    └── SettingsTab.tsx   AllowList/All 모드 + 허용 액션 관리
```

**조사 대상 설정** 탭은 ManagePage 또는 별도 페이지로 구성:
```
  TargetsPage.tsx
    ├── AwsServicesTab.tsx   알람 등록 목록 + "알람 등록" 버튼
    └── ExternalToolsTab.tsx 연동 목록 + "연동 추가" 버튼 (Webhook URL 발급)
```

**완료 기준**: `app.seolphung.com/im` 접속, 기존 CM 탭 정상 동작 유지
**상태**: ⬜ 미시작

---

## Phase K — CI/CD 워크플로

**파일**: `.github/workflows/im-deploy.yml`

```yaml
name: IM Deploy
on:
  push:
    branches: [main]
    paths:
      - 'services/incident-management/**'

jobs:
  deploy-infra:
    # terraform apply (services/im/prod/)
  deploy-lambdas:
    # IM Lambda 빌드 + S3 업로드 + 배포
    needs: deploy-infra
```

CM CI/CD(`cd-deploy.yml`)와 완전히 분리된 별도 워크플로.
`services/incident-management/**` 경로 변경 시에만 트리거.

**완료 기준**: `services/incident-management/` 코드 push → IM만 배포, CM 영향 없음
**상태**: ⬜ 미시작

---

## 구현 현황

| Phase | 내용 | 상태 | 완료일 |
|-------|------|------|--------|
| A | IM Terraform (im-api.seolphung.com + 전체 리소스) | ⬜ 미시작 | |
| B | im-api Lambda (Hono REST API) | ⬜ 미시작 | |
| C | im-normalize-event + im-webhook-receiver | ⬜ 미시작 | |
| D | im-scope-agent (Linked Account 지원) | ⬜ 미시작 | |
| E | im-summary-agent + SES | ⬜ 미시작 | |
| F | im-supervisor + Step Functions | ⬜ 미시작 | |
| G | im-security-event-handler + im-security-agent | ⬜ 미시작 | |
| H | im-action-executor (AllowList/All + AssumeRole) | ⬜ 미시작 | |
| I | im-chat-agent (리소스 진단) | ⬜ 미시작 | |
| J | 프런트엔드 7개 탭 | ⬜ 미시작 | |
| K | CI/CD 워크플로 분리 | ⬜ 미시작 | |

---

## 외부 설정 필요 사항

```
Linked Account (각 대상 계정에서 1회)
  IAM Role 생성: aigo-im-cross-account
  Trust Principal: arn:aws:iam::{aigo계정ID}:role/aigo-im-action-executor-role
  Permission: CloudWatch:Get*, EC2:Describe*/Reboot*/Stop*/Start*, SSM:SendCommand 등

GuardDuty
  대상 계정에 GuardDuty 활성화 (보안 이벤트 탭 전제 조건)

SSM Agent
  복구 대상 EC2에 SSM Agent 설치 + EC2 Instance Profile에 AmazonSSMManagedInstanceCore 연결

조사 대상 설정 (운영 초기)
  대시보드 → 조사 대상 설정 → AWS 서비스 탭 → 알람 등록
  대시보드 → 관리 → 자동 조치 설정 → AllowList 등록 + 활성화
```
