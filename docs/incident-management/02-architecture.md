# AIGO Incident Management — 아키텍처

## 서비스 분리 구조

```
┌─ 사용자 ──────────────────────────────────────────────────────────┐
│                                                                   │
│            브라우저: app.seolphung.com                            │
│                      │                                            │
│         ┌────────────┴────────────┐                              │
│         │                         │                              │
│  Change Management 탭    Incident Management 탭                   │
│         │                         │                              │
│         ▼                         ▼                              │
│  api.seolphung.com        im-api.seolphung.com                   │
│  (기존 백엔드)             (신규 별도 백엔드)                       │
└───────────────────────────────────────────────────────────────────┘

공유: Cognito User Pool — 동일 JWT 토큰, 각 API GW가 독립 검증
```

---

## URL 구조

| 서비스 | URL | 비고 |
|--------|-----|------|
| 대시보드 (프런트엔드) | `app.seolphung.com` | CloudFront, 기존 |
| Change Management API | `api.seolphung.com` | API GW, 기존 |
| **Incident Management API** | `im-api.seolphung.com` | API GW, **신규** |
| Webhook 수신 (외부 도구) | `im-api.seolphung.com/webhook/{id}` | 인증 없음, API Key 헤더 |

`*.seolphung.com` 와일드카드 ACM 인증서가 이미 존재 → `im-api.seolphung.com`에 추가 인증서 발급 없이 적용 가능.

---

## IM 백엔드 전체 흐름

```
┌─ INPUT SOURCES ──────────────────────────────────────────────────┐
│                                                                  │
│  CloudWatch Alarm    AWS Health Event                            │
│         └──────────────────┘                                     │
│                    │                                             │
│           EventBridge (aigo-im-event-bus)                        │
│                    │                                             │
│  Zabbix / Prometheus / Grafana                                   │
│         → im-api.seolphung.com/webhook/{integrationId}           │
│                                                                  │
│  GuardDuty / CloudTrail                                          │
│         → EventBridge (aws.guardduty / aws.cloudtrail)          │
└──────────────────────────────────────────────────────────────────┘
                     │
┌─ EVENT PROCESSING ───────────────────────────────────────────────┐
│                     │                                            │
│  Lambda: im-normalize-event                                      │
│    - InvestigationTargets 조회 (등록된 알람인지 확인)             │
│    - DDB: im-Incidents PutItem (status=OPEN)                     │
│    - EventBridge: im-Incidents 이벤트 기록                       │
│    - Step Functions: StartExecution                              │
│                                                                  │
│  Lambda: im-webhook-receiver                                     │
│    - API Key 검증 → 포맷 정규화 → normalize와 동일 처리           │
│                                                                  │
│  Lambda: im-security-event-handler                               │
│    - DDB: im-SecurityEvents PutItem                              │
│    - im-security-agent 비동기 호출                               │
└──────────────────────────────────────────────────────────────────┘
                     │
┌─ AI INVESTIGATION (Step Functions: aigo-im-investigation) ───────┐
│                                                                  │
│  [1] StartInvestigation                                          │
│      Lambda: im-poll-investigation (30s)                         │
│        - DDB status → INVESTIGATING                              │
│        - im-supervisor-agent 비동기(Event) 호출 후 즉시 반환     │
│                                                                  │
│  [2] WaitForInvestigation (60s 대기 후 DDB 상태 확인 반복)       │
│      DDB GetItem: im-Incidents status 조회                       │
│      Choice: REPORTED → Done / INVESTIGATION_FAILED → Fail       │
│                                                                  │
│  [async] Lambda: im-supervisor-agent (840s, 병렬 조율자)         │
│               ├── im-scope-agent Lambda (Strands, 600s)          │
│               │       └─ DDB: im-InvestigationResults            │
│               └── im-summary-agent Lambda (Strands, 300s)        │
│                       ├─ S3: 장애보고서 (aigo-im-reports)        │
│                       ├─ SES: noreply@seolphung.com              │
│                       └─ DDB: im-Reports                         │
│      완료 후 supervisor: DDB status → REPORTED                   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                     │
                     │  대시보드 "Mitigation Plan" → 승인 후
                     ▼
┌─ REMEDIATION ────────────────────────────────────────────────────┐
│                                                                  │
│  Lambda: im-action-executor                                      │
│    - im-RemediationSettings 조회 (AllowList / All 모드)          │
│    - AllowList: im-AllowedActions isActive 확인                  │
│    - 동일 계정: 직접 AWS API                                     │
│    - Linked Account: STS AssumeRole → 대상 계정 AWS API          │
│    - DDB: im-RecoveryActions + aigo-AuditLogs                   │
└──────────────────────────────────────────────────────────────────┘

┌─ 리소스 진단 / CHAT ─────────────────────────────────────────────┐
│                                                                  │
│  im-api.seolphung.com/chat                                       │
│    → Lambda: im-chat-agent (Strands)                            │
│    ↕ Bedrock Claude 3.5 + CloudWatch / EC2 / RDS 도구           │
│    → DDB: im-Conversations                                       │
└──────────────────────────────────────────────────────────────────┘
```

---

## Lambda 함수 목록

| Lambda명 | 역할 | 트리거 |
|----------|------|--------|
| `aigo-im-api` | REST API 핸들러 (Hono, Node.js) | API GW (im-api) |
| `aigo-im-normalize-event` | 이벤트 정규화, 인시던트 생성, SFN 시작 | EventBridge |
| `aigo-im-webhook-receiver` | 외부 도구 Webhook 수신 | API GW (im-api) |
| `aigo-im-security-event-handler` | 보안 이벤트 처리 | EventBridge (guardduty) |
| `aigo-im-poll-investigation` | SFN Task: status→INVESTIGATING, supervisor 비동기 호출 | Step Functions |
| `aigo-im-supervisor-agent` | scope + summary 병렬 조율 (비동기 실행) | poll_investigation (async) |
| `aigo-im-scope-agent` | 근본 원인·영향 범위 분석 (Strands) | supervisor |
| `aigo-im-summary-agent` | 한국어 보고서 생성, S3, SES (Strands) | supervisor |
| `aigo-im-security-agent` | 보안 분석, 플레이북 생성 (Strands) | security-event-handler |
| `aigo-im-chat-agent` | 리소스 진단 AI 채팅 (Strands) | API GW (im-api) |
| `aigo-im-action-executor` | 조치 실행, AssumeRole, SSM | API GW (im-api) |

---

## 공유 인프라 참조 방식

IM Terraform은 CM Terraform이 생성한 리소스를 `data` source로만 참조합니다.
State 간 직접 의존 없음 → CM과 IM 배포가 완전히 독립.

| 리소스 | 참조 방식 | 비고 |
|--------|---------|------|
| VPC | `data.aws_vpc` (tag: Project=aigo) | 서브넷, NAT GW 포함 |
| Cognito User Pool | `data.aws_cognito_user_pools` (name: aigo-user-pool) | API GW Authorizer 설정용 |
| Route53 Zone | `data.aws_route53_zone` (name: seolphung.com) | im-api.seolphung.com 레코드 추가 |
| ACM 인증서 | `data.aws_acm_certificate` (domain: *.seolphung.com) | 와일드카드 기존 인증서 재사용 |
| SES Identity | `data.aws_ses_domain_identity` (domain: seolphung.com) | noreply@seolphung.com 발신 |
| Lambda SG | `data.aws_security_group` (name: aigo-lambda-sg) | 기존 보안 그룹 재사용 |
| Private Subnets | `data.aws_subnets` (filter: vpc-id + tag Tier=private) | Lambda VPC 배치 |

---

## 프런트엔드 API 연결

```typescript
// apps/dashboard/.env.production
VITE_CM_API_URL=https://api.seolphung.com       // 기존 (변경 없음)
VITE_IM_API_URL=https://im-api.seolphung.com    // 신규 추가

// IM 탭 전용 axios 인스턴스
const imApi = axios.create({
  baseURL: import.meta.env.VITE_IM_API_URL,
})
imApi.interceptors.request.use((config) => {
  const token = getJwtToken()  // 기존 Cognito 토큰 재사용
  config.headers.Authorization = `Bearer ${token}`
  return config
})
```
