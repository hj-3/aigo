# AIGO Incident Management — 데이터 모델

모든 테이블: `Product=IncidentManagement`, `Project=aigo` 태그.

---

## 테이블 목록 (10개)

| 테이블명 | 역할 |
|---------|------|
| `aigo-im-Incidents` | 인시던트 메인 레코드 |
| `aigo-im-InvestigationResults` | scope_agent 분석 결과 (근본 원인, 영향 범위, 조치 방안) |
| `aigo-im-Reports` | 생성된 장애보고서 메타데이터 |
| `aigo-im-RecoveryActions` | 실행된 조치 이력 |
| `aigo-im-InvestigationTargets` | 조사 대상 등록 (AWS 알람) |
| `aigo-im-ExternalIntegrations` | 외부 도구 연동 설정 (Zabbix 등) |
| `aigo-im-LinkedAccounts` | Linked AWS Account 등록 |
| `aigo-im-AllowedActions` | 허용 복구 작업 목록 (AllowList) |
| `aigo-im-RemediationSettings` | 자동 조치 모드 설정 (AllowList/All) |
| `aigo-im-SecurityEvents` | 보안 이벤트 및 플레이북 |
| `aigo-im-Conversations` | 리소스 진단 채팅 이력 |

---

## 1. `aigo-im-Incidents`

| 키 | 예시 |
|----|------|
| PK | `INCIDENT#inc_01J...` |
| SK | `METADATA` |
| GSI1PK | `ORG#org_abc` |
| GSI1SK | `{status}#{detectedAt}` |
| GSI2PK | `ACCOUNT#{awsAccountId}` |
| GSI2SK | `{detectedAt}` |

```
incidentId        string
orgId             string
awsAccountId      string    발생 계정 (Linked Account 포함)
title             string    "[P1] prod-api CPU 급등"
severity          enum      P1 | P2 | P3 | P4
status            enum      DETECTED → INVESTIGATING → SCOPE_ANALYZED
                            → REPORTED → MITIGATION_PENDING → MITIGATING
                            → RESOLVED → CLOSED
source            enum      CLOUDWATCH | AWS_HEALTH | EXTERNAL_TOOL | MANUAL
externalTool      string?   "zabbix" | "prometheus" | "grafana" (source=EXTERNAL_TOOL 시)
integrationId     string?   ExternalIntegrations 참조
targetId          string?   InvestigationTargets 참조
rawEvent          map       원본 이벤트 페이로드
normalizedEvent   map       정규화된 공통 포맷
region            string
detectedAt        string
sfnExecutionArn   string?
```

---

## 2. `aigo-im-InvestigationResults`

| 키 | 예시 |
|----|------|
| PK | `INCIDENT#inc_01J...` |
| SK | `SCOPE#METADATA` |

```
incidentId          string
rootCause           string    근본 원인 (한국어)
rootCauseDetail     string    상세 분석
affectedServices    list      영향받는 서비스 목록
affectedResources   list      [{ resourceId, resourceType, impact }]
blastRadius         string    영향 범위 요약
timeline            list      [{ time, event, source }]
metricsSnapshot     map       분석 시점 메트릭 스냅샷
mitigationOptions   list      조치 방안 목록 (아래 구조)
severity            enum      AI 재평가 심각도
confidence          number    분석 신뢰도 0~100
generatedAt         string
```

**mitigationOptions 항목**
```json
{
  "optionId": "opt_01",
  "order": 1,
  "title": "prod-api EC2 재부팅",
  "description": "OOM 상태 초기화. 재부팅 후 메모리 초기화로 즉시 복구.",
  "allowedActionKey": "EC2#RebootInstances",
  "params": { "InstanceIds": ["i-0abc123"] },
  "riskLevel": "LOW",
  "estimatedRecoveryTime": "3분",
  "requiresApproval": true
}
```

---

## 3. `aigo-im-Reports`

| 키 | 예시 |
|----|------|
| PK | `INCIDENT#inc_01J...` |
| SK | `REPORT#METADATA` |
| GSI1PK | `ORG#org_abc` |
| GSI1SK | `{generatedAt}` |

```
incidentId      string
orgId           string
s3Key           string    s3://aigo-im-reports-.../inc_01J.../report.md
presignedUrl    string?   15분 유효 (조회 시 생성)
summary         string    한국어 요약 (3~5줄)
emailSentTo     list
emailSentAt     string
generatedAt     string
```

---

## 4. `aigo-im-RecoveryActions`

실행된 조치 이력.

| 키 | 예시 |
|----|------|
| PK | `INCIDENT#inc_01J...` |
| SK | `ACTION#{actionId}` |

```
incidentId        string
actionId          string    ulid
optionId          string    mitigationOptions 참조
allowedActionKey  string    "EC2#RebootInstances"
params            map
status            enum      PENDING_APPROVAL | APPROVED | EXECUTING | COMPLETED | FAILED
approvedBy        string
executedBy        string    (system)
awsAccountId      string    실행 대상 계정 (Linked Account 포함)
assumedRoleArn    string?   Linked Account 시 사용된 Role ARN
ssmCommandId      string?
result            map
errorMessage      string?
rollbackParams    map
executedAt        string
completedAt       string
```

---

## 5. `aigo-im-InvestigationTargets`

"조사 대상 설정 → AWS 서비스" 탭에서 등록한 CloudWatch 알람 목록.

| 키 | 예시 |
|----|------|
| PK | `ORG#org_abc` |
| SK | `TARGET#{targetId}` |
| GSI1PK | `ACCOUNT#{awsAccountId}` |
| GSI1SK | `{alarmName}` |

```
orgId           string
targetId        string    ulid
awsAccountId    string    알람이 있는 계정 (Linked Account 가능)
region          string
service         string    EC2 | RDS | LAMBDA | API_GW | ECS ...
alarmName       string    CloudWatch 알람명 (exact match)
displayName     string    사용자 지정 표시명
severity        enum      P1 | P2 | P3 | P4 (이 알람의 기본 심각도)
isActive        boolean
registeredBy    string
createdAt       string
```

normalize_event Lambda가 이벤트 수신 시 `GSI1: ACCOUNT#{id}`로 조회해 등록 여부 확인.

---

## 6. `aigo-im-ExternalIntegrations`

"조사 대상 설정 → 외부 도구" 탭에서 등록한 외부 모니터링 연동.

| 키 | 예시 |
|----|------|
| PK | `ORG#org_abc` |
| SK | `INTEGRATION#{integrationId}` |

```
orgId           string
integrationId   string    ulid (Webhook URL에 포함)
toolType        enum      ZABBIX | PROMETHEUS | GRAFANA | CUSTOM
displayName     string    "Production Zabbix"
webhookUrl      string    https://api.aigo.dev/im/webhook/{integrationId}
apiKeyHash      string    bcrypt hash (원본은 생성 시 1회만 반환)
fieldMapping    map       각 툴의 알람 필드 → 공통 포맷 매핑 규칙
isActive        boolean
registeredBy    string
createdAt       string
```

---

## 7. `aigo-im-LinkedAccounts`

"관리 → 계정 관리" 탭에서 등록한 멀티 계정.

| 키 | 예시 |
|----|------|
| PK | `ORG#org_abc` |
| SK | `ACCOUNT#{awsAccountId}` |

```
orgId           string
awsAccountId    string    12자리 AWS Account ID
displayName     string    "Production Account"
crossAccountRoleArn string  "arn:aws:iam::123456789012:role/aigo-im-cross-account"
status          enum      ACTIVE | INACTIVE | CONNECTION_ERROR
lastVerifiedAt  string    AssumeRole 마지막 성공 시각
registeredBy    string
createdAt       string
```

---

## 8. `aigo-im-AllowedActions`

"관리 → 자동 조치 설정" AllowList 모드에서 관리하는 허용 액션 목록.

| 키 | 예시 |
|----|------|
| PK | `ORG#org_abc` |
| SK | `ACTION#{service}#{operation}` |

```
orgId             string
allowedActionKey  string    "EC2#RebootInstances" (SK와 동일)
service           string    EC2 | RDS | ECS | SSM | LAMBDA
operation         string    RebootInstances | StopInstances | ...
displayName       string    "EC2 인스턴스 재부팅"
description       string
allowedParams     list      파라미터 화이트리스트
riskLevel         enum      LOW | MEDIUM | HIGH
isActive          boolean   AllowList 모드에서 이게 false면 실행 불가
registeredBy      string
createdAt         string
```

**기본 제공 (isActive=false)**
```
EC2#RebootInstances      EC2 재부팅
EC2#StopInstances        EC2 중지
EC2#StartInstances       EC2 시작
RDS#RebootDBInstance     RDS 재부팅
ECS#UpdateService        ECS desired count 변경
SSM#SendCommand          커스텀 SSM 스크립트
```

---

## 9. `aigo-im-RemediationSettings`

"관리 → 자동 조치 설정" 탭의 모드 설정.

| 키 | 예시 |
|----|------|
| PK | `ORG#org_abc` |
| SK | `SETTINGS#REMEDIATION` |

```
orgId           string
mode            enum      ALLOWLIST | ALL
updatedBy       string    OWNER 권한만 변경 가능
updatedAt       string
```

---

## 10. `aigo-im-SecurityEvents`

"보안 이벤트" 탭 전용.

| 키 | 예시 |
|----|------|
| PK | `SECURITY#sec_01J...` |
| SK | `METADATA` |
| GSI1PK | `ORG#org_abc` |
| GSI1SK | `{severity}#{detectedAt}` |

```
securityEventId   string
orgId             string
awsAccountId      string
source            enum      GUARDDUTY | CLOUDTRAIL | MANUAL
eventType         string    "UnauthorizedAccess:EC2/TorIPCaller" 등
severity          enum      CRITICAL | HIGH | MEDIUM | LOW
title             string
description       string
affectedResources list
playbook          map       대응 플레이북 (단계별 절차)
status            enum      OPEN | IN_PROGRESS | CONTAINED | CLOSED
detectedAt        string
```

---

## 11. `aigo-im-Conversations`

"리소스 진단" 채팅 이력. 30일 TTL.

| 키 | 예시 |
|----|------|
| PK | `CONV#conv_01J...` |
| SK | `MSG#{timestamp}` |
| GSI1PK | `ORG#org_abc` |
| GSI1SK | `{userId}#{timestamp}` |

```
convId        string
orgId         string
userId        string
selectedService string   진단 대상 서비스 (EC2 등)
selectedResourceId string? 특정 리소스 ID
role          enum      USER | ASSISTANT
content       string
toolCalls     list?
createdAt     string
ttl           number    Unix epoch
```
