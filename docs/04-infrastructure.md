# 인프라 아키텍처

## 리전 구성

| 구분 | 리전 | 용도 |
|------|------|------|
| Primary | `ap-northeast-2` (Seoul) | 모든 서비스 운영 |
| DR | `ap-northeast-1` (Tokyo) | DynamoDB Global Tables, S3 CRR, ECR 복제 |

---

## VPC 설계

### CIDR 할당

```
VPC: 10.0.0.0/16

Public Subnets (인터넷 접근 가능)
├── 10.0.0.0/20    AZ-a  ← NAT Gateway
├── 10.0.16.0/20   AZ-b  ← NAT Gateway
└── 10.0.32.0/20   AZ-c  ← NAT Gateway

Private Subnets (인터넷 접근 불가, AWS 서비스는 VPC Endpoint)
├── 10.0.64.0/20   AZ-a  ← ECS Fargate, Private Lambda
├── 10.0.80.0/20   AZ-b
└── 10.0.96.0/20   AZ-c

Isolated Subnets (향후 RDS/OpenSearch 용도 예약)
├── 10.0.128.0/20  AZ-a
├── 10.0.144.0/20  AZ-b
└── 10.0.160.0/20  AZ-c
```

### NAT Gateway

- **AZ당 1개** (총 3개, Multi-AZ)
- **용도**: GitHub API, Slack API 등 외부 SaaS 호출 전용
- AWS 내부 서비스 호출은 모두 VPC Endpoint 경유

### 보안 그룹 구성

```
sg-alb              → 0.0.0.0/0:443 허용 (CloudFront IP만 허용 권장)
sg-ecs-fargate      → sg-alb에서 인바운드 / 아웃바운드 VPC Endpoint, NAT
sg-private-lambda   → 아웃바운드 VPC Endpoint만
sg-vpc-endpoint     → Private Subnet 보안 그룹에서 443 허용
```

---

## VPC Endpoint 구성

### Gateway Endpoints (비용 없음, 우선 적용)

| 서비스 | 적용 서브넷 | 용도 |
|--------|-------------|------|
| S3 | Private + Isolated | ECS/Lambda → S3 접근 |
| DynamoDB | Private + Isolated | ECS/Lambda → DynamoDB 접근 |

### Interface Endpoints (Private Subnet에 ENI 생성)

| 서비스 | Endpoint 이름 | 용도 |
|--------|---------------|------|
| ECR API | `com.amazonaws.ap-northeast-2.ecr.api` | ECS 이미지 메타데이터 |
| ECR Docker | `com.amazonaws.ap-northeast-2.ecr.dkr` | ECS 이미지 Pull |
| CloudWatch Logs | `com.amazonaws.ap-northeast-2.logs` | Lambda/ECS 로그 |
| CloudWatch | `com.amazonaws.ap-northeast-2.monitoring` | 메트릭 수집 |
| Secrets Manager | `com.amazonaws.ap-northeast-2.secretsmanager` | 시크릿 조회 |
| KMS | `com.amazonaws.ap-northeast-2.kms` | 암호화 작업 |
| STS | `com.amazonaws.ap-northeast-2.sts` | IAM Role AssumeRole |
| SQS | `com.amazonaws.ap-northeast-2.sqs` | 큐 발행/소비 |
| EventBridge | `com.amazonaws.ap-northeast-2.events` | 이벤트 발행 |
| SSM | `com.amazonaws.ap-northeast-2.ssm` | 파라미터 조회 |
| X-Ray | `com.amazonaws.ap-northeast-2.xray` | 트레이스 전송 |
| Bedrock Runtime | `com.amazonaws.ap-northeast-2.bedrock-runtime` | Agent 모델 호출 |

> Interface Endpoint는 각 AZ 서브넷에 ENI를 생성한다. 3 AZ × 11개 서비스 = ENI 33개.
> 비용 = 약 $0.01/hr × 33 = $330/월 → VPC 내 AWS 트래픽 비용 절감과 보안으로 상쇄.

---

## AWS 서비스별 구성

### CloudFront + S3 (Frontend)

```
Route 53 → CloudFront Distribution
              ├── Origin: S3 (aigo-frontend) [OAC]
              ├── Cache Behavior: /* → S3
              ├── 404 → /index.html (SPA)
              ├── WAF ACL 연결
              ├── ACM 인증서 (us-east-1)
              └── 커스텀 도메인: app.{domain}
```

**설정 포인트**:
- Origin Access Control (OAC) 사용 (OAI deprecated)
- Cache-Control 헤더: HTML은 `no-cache`, 정적 에셋은 1년
- HTTPS 강제 리다이렉트
- HTTP/2 + HTTP/3 활성화

---

### API Gateway

**타입**: HTTP API (REST API 대신 — 더 저렴하고 빠름)

```
HTTP API
├── JWT Authorizer (Cognito)
│
├── Routes:
│   ├── POST /webhooks/github          → github-connector Lambda (no auth)
│   ├── POST /webhooks/slack           → slack-connector Lambda (no auth)
│   ├── POST /commands/dashboard       → dashboard-cmd-connector Lambda (JWT)
│   │
│   ├── GET    /reports                → dashboard-api Lambda (JWT)
│   ├── GET    /reports/{reportId}     → dashboard-api Lambda (JWT)
│   ├── POST   /reports/{reportId}/approve → approval-api Lambda (JWT)
│   ├── POST   /reports/{reportId}/reject  → approval-api Lambda (JWT)
│   ├── POST   /reports/{reportId}/fix     → fix-api Lambda (JWT)
│   │
│   ├── GET    /fixes/{fixId}          → fix-api Lambda (JWT)
│   ├── POST   /fixes/{fixId}/approve  → fix-api Lambda (JWT)
│   │
│   ├── GET    /jobs                   → dashboard-api Lambda (JWT)
│   ├── GET    /incidents              → dashboard-api Lambda (JWT)
│   ├── GET    /agent-runs             → dashboard-api Lambda (JWT)
│   └── GET/PUT /settings             → settings-api Lambda (JWT)
│
├── CORS: app.{domain} 만 허용
├── Throttling: 1000 req/s (burst 2000)
└── CloudWatch Logs 활성화
```

**웹훅 라우트는 JWT 인증 없음** — 대신 Lambda 내부에서 HMAC 서명 검증.

---

### Lambda 함수 목록

| 함수 이름 | 런타임 | 메모리 | 타임아웃 | VPC | 트리거 |
|-----------|--------|--------|----------|-----|--------|
| `github-connector` | Node.js 22.x | 512 MB | 30s | 없음 | API GW |
| `slack-connector` | Node.js 22.x | 512 MB | 30s | 없음 | API GW |
| `dashboard-cmd-connector` | Node.js 22.x | 512 MB | 30s | 없음 | API GW |
| `aws-event-connector` | Node.js 22.x | 512 MB | 30s | 없음 | EventBridge |
| `dashboard-api` | Node.js 22.x | 1024 MB | 30s | 없음 | API GW |
| `approval-api` | Node.js 22.x | 512 MB | 30s | 없음 | API GW |
| `fix-api` | Node.js 22.x | 512 MB | 30s | 없음 | API GW |
| `settings-api` | Node.js 22.x | 512 MB | 30s | 없음 | API GW |
| `lightweight-worker` | Node.js 22.x | 1024 MB | 300s | Private | SQS |
| `notification-worker` | Node.js 22.x | 512 MB | 60s | 없음 | SQS |
| `audit-exporter` | Node.js 22.x | 512 MB | 300s | 없음 | DDB Stream |

**Lambda 공통 설정**:
- Powertools for Lambda: Logger, Tracer, Metrics
- X-Ray Tracing: Active
- Dead Letter Queue 연결 (모든 비동기 호출)
- Reserved Concurrency: connector는 100, worker는 50
- Provisioned Concurrency: `dashboard-api` 10개 (콜드스타트 방지)

---

### SQS 큐 구성

| 큐 이름 | 타입 | 가시성 타임아웃 | 최대 수신 | DLQ |
|---------|------|----------------|-----------|-----|
| `analysis-queue` | Standard | 900s (15분) | 3회 | `analysis-dlq` |
| `fix-queue` | Standard | 1800s (30분) | 3회 | `fix-dlq` |
| `incident-queue` | Standard | 900s | 3회 | `incident-dlq` |
| `command-queue` | Standard | 300s | 3회 | `command-dlq` |
| `notification-queue` | Standard | 60s | 5회 | `notification-dlq` |

**DLQ 알람**: 메시지 수 > 0 → CloudWatch Alarm → SNS → 이메일/Slack

---

### EventBridge Custom Bus

**버스 이름**: `aigo-events`

| 이벤트 패턴 | 소스 | 타겟 |
|-------------|------|------|
| `PR_ANALYSIS_REQUESTED` | `github-connector` | `analysis-queue` |
| `COMMAND_RECEIVED` | `slack-connector` | `command-queue` |
| `INCIDENT_DETECTED` | `aws-event-connector` | `incident-queue` |
| `REPORT_CREATED` | `lightweight-worker` | `notification-queue` |
| `APPROVAL_SUBMITTED` | `approval-api` | `notification-queue` |
| `FIX_REQUESTED` | `fix-api` | `fix-queue` |
| `FIX_PR_CREATED` | `fix-agent` | `notification-queue` |

---

### ECS Fargate — Heavy Worker

**클러스터**: `aigo-heavy-workers`  
**실행 방식**: RunTask (항상 떠 있는 Service 아님)

```
Task Definition: aigo-heavy-worker
  Family: aigo-heavy-worker
  CPU: 2048 (2 vCPU)
  Memory: 4096 MB
  Network Mode: awsvpc
  Subnets: Private (3 AZ)
  Security Group: sg-ecs-fargate

Container: worker
  Image: {ECR}/{repo}/heavy-worker:{tag}
  Command: ["python", "src/main.py"]
  Environment:
    - 모든 설정값은 Secrets Manager / SSM Parameter Store 참조
    - 하드코딩 없음
  Logging: CloudWatch Logs (/ecs/aigo-heavy-worker)
  Read-only root filesystem: true
  Non-root user: appuser (UID 1000)
```

**RunTask 트리거**: `lightweight-worker` Lambda가 SQS 메시지 분석 후 ECS `RunTask` API 호출.

---

### Cognito

**User Pool**: `aigo-users`

```
Password Policy:
  - 최소 12자
  - 대소문자, 숫자, 특수문자 필수

MFA:
  - OPTIONAL (조직 설정으로 REQUIRED 가능)
  - TOTP 또는 SMS

Token Validity:
  - Access Token: 1시간
  - Refresh Token: 30일
  - ID Token: 1시간

User Pool Groups:
  - OWNER
  - ADMIN
  - REVIEWER
  - VIEWER

App Client:
  - Implicit grant 비활성화
  - Auth Code Flow + PKCE 사용
  - Callback URL: https://app.{domain}/auth/callback
```

---

### KMS 키 구성

| 키 별칭 | 용도 | 로테이션 |
|---------|------|----------|
| `alias/aigo-s3` | S3 버킷 암호화 | 연간 자동 |
| `alias/aigo-dynamodb` | DynamoDB 암호화 | 연간 자동 |
| `alias/aigo-secrets` | Secrets Manager | 연간 자동 |
| `alias/aigo-logs` | CloudWatch Logs | 연간 자동 |

---

### Secrets Manager

| Secret 이름 | 내용 | 로테이션 |
|-------------|------|----------|
| `aigo/github/app-private-key` | GitHub App 개인키 | 수동 |
| `aigo/github/webhook-secret` | GitHub Webhook HMAC 시크릿 | 연간 |
| `aigo/slack/signing-secret` | Slack 서명 시크릿 | 연간 |
| `aigo/slack/bot-token` | Slack Bot OAuth 토큰 | 수동 |
| `aigo/stripe/secret-key` | Stripe API 키 | 수동 |
| `aigo/cognito/client-secret` | Cognito App Client Secret | 연간 |

---

### CloudWatch 모니터링

**대시보드**: `aigo-operations`

**핵심 알람**:

| 알람 이름 | 조건 | 액션 |
|-----------|------|------|
| `DLQ-analysis-alarm` | DLQ 메시지 > 0 | SNS → Slack |
| `DLQ-fix-alarm` | DLQ 메시지 > 0 | SNS → Slack |
| `Lambda-error-rate` | 에러율 > 5% | SNS → Slack |
| `API-p99-latency` | p99 > 3000ms | SNS → Slack |
| `Agent-failure-rate` | 실패율 > 10% | SNS → Slack |
| `DynamoDB-throttle` | Throttle > 0 | SNS → Slack |

**로그 그룹 보존**:

| 로그 그룹 | 보존 기간 |
|-----------|-----------|
| `/aws/lambda/github-connector` | 90일 |
| `/aws/lambda/lightweight-worker` | 90일 |
| `/ecs/aigo-heavy-worker` | 180일 |
| `/aws/apigateway/aigo` | 30일 |

---

### AgentCore Runtime

**플랫폼**: Amazon Bedrock AgentCore Runtime  
**배포 방식**: Python ZIP (S3) 또는 컨테이너 이미지 (ECR)  
**모델**: Claude Sonnet 4.x (`claude-sonnet-4-x`)

**Runtime 구성**:

```
AgentCore Runtime: aigo-orchestrator
  Entry: orchestrator/agent.py
  Artifacts: S3 aigo-artifacts/agents/orchestrator/{version}.zip
  IAM Role: aigo-agentcore-runtime-role
  Memory: AgentCore Memory 연결 (SDK)
  Timeout: 300s
  Concurrency: 10

AgentCore Runtime: aigo-code-reviewer
AgentCore Runtime: aigo-infra-reviewer
AgentCore Runtime: aigo-risk-reviewer
AgentCore Runtime: aigo-security-agent
AgentCore Runtime: aigo-incident-agent
AgentCore Runtime: aigo-fix-agent
```

**AgentCore Gateway**:
- Tool Lambda들을 AgentCore Gateway에 등록
- 각 Agent에 허용된 Tool 목록 명시적 설정
- Tool 스키마(OpenAPI/MCP)로 자동 검증

---

## Terraform 상태 관리

```
Backend: S3 + DynamoDB Lock

S3 버킷: aigo-tf-state
  - 버전 관리: ON
  - 암호화: SSE-KMS
  - 퍼블릭 액세스: 차단

DynamoDB 테이블: aigo-tf-lock
  - Billing: PAY_PER_REQUEST
  - LockID: hash key
```

---

## 비용 최적화 포인트

| 항목 | 전략 |
|------|------|
| ECS Fargate | RunTask 방식 (분석 시간만 과금) |
| Lambda | PAY_PER_REQUEST (상시 대기 비용 없음) |
| DynamoDB | PAY_PER_REQUEST (트래픽 변동 대응) |
| S3 | Lifecycle → IA → Glacier (스토리지 계층화) |
| NAT Gateway | VPC Endpoint로 AWS 트래픽 우회, NAT는 외부 SaaS 전용 |
| Interface Endpoint | NAT 트래픽 비용 ($0.09/GB) → Endpoint ($0.01/GB) 절감 |
| Bedrock | Claude Sonnet 4.x (Opus 대비 비용 효율, 성능 충분) |
