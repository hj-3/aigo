# 보안 설계

## 보안 원칙

- **Zero Trust**: 모든 요청은 기본적으로 신뢰하지 않는다. 명시적 인증·인가 필수
- **최소 권한 (Least Privilege)**: 각 컴포넌트는 필요한 권한만 보유
- **Defense in Depth**: 단일 보안 계층에 의존하지 않음. 계층별 독립 방어
- **시크릿 Zero**: 코드·환경변수·CI 설정에 시크릿 직접 없음. Secrets Manager 참조만
- **감사 추적**: 모든 행동은 기록된다. 삭제 불가

---

## 인증 (Authentication)

### 사용자 인증 — Cognito

```
흐름:
1. 사용자 → app.{domain}/login
2. Cognito Hosted UI (또는 커스텀 로그인 페이지)
3. Authorization Code Flow + PKCE
4. Cognito → JWT 발급 (Access Token + ID Token + Refresh Token)
5. Frontend: JWT를 메모리에 보관 (localStorage 금지)
6. API 요청: Authorization: Bearer {accessToken}
7. API Gateway JWT Authorizer: Cognito Public Key로 서명 검증

토큰 유효기간:
  Access Token:  1시간
  ID Token:      1시간
  Refresh Token: 30일

토큰 갱신:
  Access Token 만료 전 자동 갱신 (Amplify Auth 처리)
  Refresh Token 만료 시 재로그인
```

**JWT 페이로드 구조**:
```json
{
  "sub": "userId",
  "cognito:groups": ["REVIEWER"],
  "orgId": "01HN5X...",
  "email": "user@example.com",
  "iss": "https://cognito-idp.ap-northeast-2.amazonaws.com/{poolId}",
  "exp": 1749999999
}
```

### Webhook 인증 — HMAC

**GitHub Webhook 검증**:
```
1. X-Hub-Signature-256 헤더 추출
2. HMAC-SHA256(body, webhookSecret) 계산
3. 타이밍 공격 방지: hmac.compare_digest() 또는 timingSafeEqual()
4. X-GitHub-Delivery 헤더로 재전송 공격 방지 (idempotency key)
5. 검증 실패 → 즉시 403 반환, CloudWatch Alarm 트리거
```

**Slack Command 검증**:
```
1. X-Slack-Signature 헤더 추출
2. X-Slack-Request-Timestamp 확인 (5분 이상 오래된 요청 거부)
3. v0:{timestamp}:{rawBody} 문자열에 HMAC-SHA256 계산
4. 서명 일치 확인
5. 검증 실패 → 즉시 403
```

---

## 인가 (Authorization)

### RBAC 매트릭스

| 액션 | VIEWER | REVIEWER | ADMIN | OWNER |
|------|--------|----------|-------|-------|
| 리포트 조회 | ✅ | ✅ | ✅ | ✅ |
| 리포트 승인/거절 | ❌ | ✅ | ✅ | ✅ |
| Fix 요청 | ❌ | ❌ | ✅ | ✅ |
| Fix PR 생성 | ❌ | ❌ | ✅ | ✅ |
| Incident 조사 | ❌ | ✅ | ✅ | ✅ |
| 설정 변경 | ❌ | ❌ | ✅ | ✅ |
| 멤버 관리 | ❌ | ❌ | ❌ | ✅ |
| 조직 설정 | ❌ | ❌ | ❌ | ✅ |
| Agent 재실행 | ❌ | ✅ | ✅ | ✅ |

### 권한 검증 위치

1. **API Gateway**: JWT Authorizer → 토큰 유효성 검증
2. **Lambda Middleware**: `orgId` 검증 (요청자가 해당 조직 멤버인지)
3. **Lambda Handler**: 역할 기반 액션 허용 여부 확인
4. **DynamoDB**: `orgId` 조건부 쿼리 (다른 조직 데이터 원천 차단)

---

## API 보안

### WAF (Web Application Firewall)

**적용 위치**: CloudFront + API Gateway (각각 별도 WAF ACL)

**규칙 구성**:

| 규칙 | 설명 | 액션 |
|------|------|------|
| AWSManagedRulesCommonRuleSet | 일반 웹 취약점 방어 | Block |
| AWSManagedRulesKnownBadInputsRuleSet | 알려진 악성 입력 | Block |
| AWSManagedRulesSQLiRuleSet | SQL Injection | Block |
| IP Rate Limit | IP당 분당 100 요청 | Block |
| GitHub Webhook IP | hooks.github.com 대역만 허용 | Allow (나머지 Block) |
| Slack IP | Slack 서버 IP 대역만 허용 | Allow (나머지 Block) |
| Geo Block | 필요 시 특정 국가 차단 | Block |

**웹훅 전용 경로 (`/webhooks/*`)**:
- Cognito JWT 인증 없음
- WAF에서 GitHub/Slack IP만 허용
- Lambda 내부 HMAC 서명 검증

### Rate Limiting

| 엔드포인트 | 제한 | 구간 |
|-----------|------|------|
| `/webhooks/github` | 1000 req | 분당 |
| `/webhooks/slack` | 100 req | 분당 |
| `/reports` (GET) | 200 req | 분당 |
| `/reports/{id}/approve` | 10 req | 분당 |
| `/fixes` | 20 req | 분당 |

### CORS

```
허용 Origin: https://app.{domain} 만
허용 Methods: GET, POST, PUT, DELETE, OPTIONS
허용 Headers: Authorization, Content-Type, X-Request-ID
Credentials: true
Max-Age: 86400
```

---

## 데이터 보안

### 암호화 (At Rest)

| 데이터 | 암호화 방식 | 키 |
|--------|-------------|-----|
| DynamoDB | AWS KMS CMK | `alias/aigo-dynamodb` |
| S3 (모든 버킷) | SSE-KMS | `alias/aigo-s3` |
| Secrets Manager | AWS KMS CMK | `alias/aigo-secrets` |
| CloudWatch Logs | AWS KMS CMK | `alias/aigo-logs` |
| ECS 임시 파일시스템 | ECS encrypted storage | AWS managed |

### 암호화 (In Transit)

- API Gateway: TLS 1.2+ 강제 (TLS 1.0/1.1 비활성화)
- CloudFront: TLSv1.2_2021 Policy
- Lambda → AWS 서비스: HTTPS (AWS SDK 기본값)
- ECS → AWS 서비스: HTTPS via VPC Endpoint

### 데이터 분류

| 분류 | 예시 | 처리 기준 |
|------|------|-----------|
| 기밀 | API 키, 인증서, GitHub 개인키 | Secrets Manager, KMS 암호화, 접근 로그 필수 |
| 민감 | PR diff, 분석 리포트, 장애 RCA | KMS 암호화, 접근 권한 제한 |
| 내부 | DynamoDB 운영 데이터, 설정 | KMS 암호화 |
| 공개 | Dashboard 정적 파일 | CloudFront 배포 |

---

## IAM 보안

### Lambda 실행 역할 원칙

```
각 Lambda는 독립적인 IAM Role 보유.
Role 명명: aigo-{function-name}-role

허용 원칙:
  - 특정 리소스 ARN만 지정 (wildcard Resource 금지)
  - 필요한 Action만 열거 (wildcard Action 금지)
  - 조건 키 사용 (aws:RequestedRegion, aws:SourceVpc 등)
```

**예시 — github-connector-role**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["sqs:SendMessage"],
      "Resource": "arn:aws:sqs:ap-northeast-2:{acct}:aigo-analysis-queue"
    },
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:ap-northeast-2:{acct}:secret:aigo/github/webhook-secret-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:ap-northeast-2:{acct}:log-group:/aws/lambda/aigo-github-connector:*"
    },
    {
      "Effect": "Allow",
      "Action": ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
      "Resource": "*"
    }
  ]
}
```

### AgentCore Runtime 역할

```
AgentCore는 내부적으로 Agent 실행에 필요한 역할을 사용.
Agent가 직접 AWS 자격증명을 보유하지 않음.
모든 AWS 접근은 AgentCore Gateway Tool을 통해서만.

AgentCore Runtime Role 권한:
  - bedrock:InvokeModel (특정 모델 ARN만)
  - bedrock:ApplyGuardrail
  - (Memory, Gateway는 AgentCore 내부 관리)
```

---

## Agent 보안

### Prompt Injection 방어 (다층)

```
Layer 1: Security Agent 선실행
  - PR diff 내용을 원시 텍스트로 취급
  - 의심 패턴 탐지: "ignore previous instructions", "SYSTEM:", "```python exec"
  - 발견 시 → 분석 중단, CRITICAL Finding 생성, 즉시 Slack 알림

Layer 2: Bedrock Guardrails
  - PII 감지 및 필터
  - 금지 주제 설정 (시스템 명령 실행, 자격증명 누출 등)
  - 프롬프트 공격 탐지

Layer 3: 입력 샌드박싱
  - PR diff는 별도 파싱 후 구조화된 객체로 변환
  - 원시 문자열이 시스템 프롬프트에 직접 삽입되지 않음

Layer 4: 출력 검증
  - Agent 출력은 Finding Schema로 파싱 검증
  - 스키마 불일치 시 Agent Run 실패 처리
```

### Fix Agent 격리

```
Fix Agent 실행 환경:
  - ECS Fargate 별도 Task (네트워크 격리)
  - AWS 자격증명 없음 (patch 파일만 생성)
  - 아웃바운드 네트워크: 차단 (S3 업로드만 VPC Endpoint 경유)
  - Root 파일시스템: Read-only
  - Non-root 사용자로 실행

Fix 대상 제한:
  - 승인된 findingId 목록만 처리
  - main/master 브랜치 직접 쓰기 권한 없음
  - github_tools는 feature 브랜치 생성만 허용
```

---

## 보안 모니터링

### GuardDuty

- 모든 AWS 계정에 활성화
- 탐지 항목: IAM 이상 행동, EC2/ECS 암호화폐 채굴, S3 비정상 접근
- 발견 사항 → Security Hub 집계 → SNS → Slack 알림

### Security Hub

- CIS AWS Foundations Benchmark
- AWS Foundational Security Best Practices
- PCI DSS (향후 필요 시)
- 발견 사항 심각도별 알림

### CloudTrail

```
설정:
  - 모든 리전 활성화
  - 관리 이벤트: 읽기 + 쓰기
  - S3 데이터 이벤트: aigo-* 버킷 (쓰기만)
  - Lambda 데이터 이벤트: aigo-* 함수

보존:
  - CloudTrail → S3 (aigo-logs/cloudtrail/)
  - 보존: 365일
  - 로그 파일 무결성 검증 활성화
```

### 이상 감지 알람

| 알람 | 조건 | 대응 |
|------|------|------|
| Webhook 서명 검증 실패 | 분당 5회 이상 | Slack 알림, 소스 IP 차단 검토 |
| JWT 인증 실패 | 분당 20회 이상 | Slack 알림, 계정 잠금 검토 |
| AgentCore 이상 종료 | 연속 3회 | Slack 알림, Agent 비활성화 |
| S3 비정상 접근 | GuardDuty 탐지 | 즉시 Slack + 이메일 |
| IAM 권한 변경 | CloudTrail + Config | 즉시 Slack |
| DLQ 메시지 발생 | 메시지 > 0 | Slack 알림 |

---

## 보안 감사 (Audit)

### AuditLog 기록 항목

```
모든 사용자 행동 → AuditLogs 테이블 기록

기록 항목:
  - 로그인 / 로그아웃
  - 리포트 승인 / 거절
  - Fix 요청 / 승인 / 거절
  - Fix PR 생성
  - 설정 변경
  - 멤버 추가 / 제거
  - 레포 연결 / 해제
  - Incident 조사 시작
  - Agent 재실행
```

### AuditLog 보호

- DynamoDB → S3 실시간 Export (DynamoDB Streams)
- S3 버킷 버전 관리 활성화
- S3 오브젝트 Lock (COMPLIANCE 모드, 90일) — 삭제 불가
- 읽기 권한만 제공 (삭제 권한 없음)
- 보존: 최소 2년 (규정 준수 요건)

---

## 취약점 관리

### 의존성 취약점 검사

```
Python:
  - uv pip audit (CI 실행)
  - Dependabot 자동 PR

Node.js:
  - pnpm audit (CI 실행)
  - Dependabot 자동 PR

컨테이너:
  - ECR 이미지 스캔 (push 시 자동)
  - Trivy (CI 선택적 실행)
```

### 침투 테스트

- 연 1회 외부 보안 전문 기관 침투 테스트
- 분기 1회 내부 보안 점검
- 발견 사항: Critical은 24시간 이내, High는 1주 이내 수정

### 보안 패치 정책

| 심각도 | 패치 기한 |
|--------|----------|
| Critical | 24시간 이내 (hotfix 배포) |
| High | 1주 이내 |
| Medium | 다음 정기 배포 |
| Low | 분기 내 |
