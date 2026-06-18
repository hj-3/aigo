# API 설계

## 설계 원칙

- **HTTP API (API Gateway)**: REST API 대신 HTTP API 사용 (저비용, 저지연)
- **JWT 인증**: 대시보드 API는 모두 Cognito JWT 필수. 웹훅은 HMAC 서명 검증
- **표준 응답 형식**: 모든 API는 동일한 Envelope 형식 사용
- **ULID 기반 ID**: 시간 정렬 가능한 ULID 사용 (`01HN5X...` 형식)
- **페이지네이션**: Cursor 기반 (DynamoDB LastEvaluatedKey)
- **에러 코드**: HTTP 상태 코드 + 서비스별 에러 코드

---

## 공통 응답 Envelope

### 성공 응답

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "01HN5X...",
    "timestamp": "2026-06-09T10:00:00Z"
  }
}
```

### 목록 응답 (페이지네이션)

```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "nextCursor": "eyJyZXBv...",
    "hasMore": true,
    "count": 20
  },
  "meta": {
    "requestId": "01HN5X...",
    "timestamp": "2026-06-09T10:00:00Z"
  }
}
```

### 에러 응답

```json
{
  "success": false,
  "error": {
    "code": "REPORT_NOT_FOUND",
    "message": "Report with id '01HN5X...' does not exist.",
    "detail": {}
  },
  "meta": {
    "requestId": "01HN5X...",
    "timestamp": "2026-06-09T10:00:00Z"
  }
}
```

### 에러 코드 목록

| HTTP | 코드 | 설명 |
|------|------|------|
| 400 | `INVALID_REQUEST` | 요청 파라미터 오류 |
| 401 | `UNAUTHORIZED` | 인증 토큰 없음 또는 만료 |
| 403 | `FORBIDDEN` | 권한 없음 |
| 404 | `REPORT_NOT_FOUND` | 리소스 없음 |
| 409 | `ALREADY_APPROVED` | 중복 승인 |
| 409 | `FIX_IN_PROGRESS` | Fix 이미 진행 중 |
| 422 | `INVALID_SIGNATURE` | Webhook 서명 검증 실패 |
| 429 | `RATE_LIMITED` | 요청 한도 초과 |
| 500 | `INTERNAL_ERROR` | 서버 오류 |

---

## Webhook API

인증: HMAC-SHA256 서명 검증 (Lambda 내부 처리, JWT 없음)

### POST /webhooks/github

GitHub PR 이벤트 수신.

**Headers**:
```
X-Hub-Signature-256: sha256={signature}
X-GitHub-Event: pull_request
X-GitHub-Delivery: {uuid}
```

**처리하는 이벤트**:

| action | 처리 |
|--------|------|
| `opened` | 신규 분석 Job 생성 |
| `synchronize` | 재분석 Job 생성 (새 commit push) |
| `closed` (merged) | Session Memory 완료 처리 |
| `closed` (not merged) | Job 취소 처리 |

**Response** (즉시 반환, 분석은 비동기):
```json
{
  "success": true,
  "data": {
    "jobId": "01HN5X...",
    "status": "PENDING"
  }
}
```

---

### POST /webhooks/slack

Slack Slash Command 수신.

**Headers**:
```
X-Slack-Signature: v0={signature}
X-Slack-Request-Timestamp: {epoch}
```

**Body** (Slack 표준 form-encoded):
```
command=/investigate
text=prod-api latency
user_id=U123456
channel_id=C123456
response_url=https://hooks.slack.com/...
```

**처리 명령**:

| 명령 | 처리 |
|------|------|
| `/investigate {service} {issue}` | Incident 조사 Job 생성 |
| `/approve {reportId}` | 빠른 승인 (REVIEWER 이상 권한) |
| `/reject {reportId} {reason}` | 빠른 거절 |

**Response** (3초 이내 응답 필요, 상세 결과는 response_url로 비동기 전송):
```json
{
  "response_type": "in_channel",
  "text": "조사를 시작했습니다. 완료되면 스레드에 알려드릴게요. 대시보드: https://app.{domain}/incidents/01HN5X..."
}
```

---

## Reports API

### GET /reports

리포트 목록 조회.

**Query Parameters**:

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `repoId` | string | - | 레포 필터 |
| `approvalStatus` | string | - | `NEEDS_REVIEW\|APPROVED\|REJECTED` |
| `riskLevel` | string | - | `LOW\|MEDIUM\|HIGH\|CRITICAL` |
| `limit` | number | 20 | 최대 100 |
| `cursor` | string | - | 페이지네이션 커서 |

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "reportId": "01HN5X...",
      "orgId": "01HN5X...",
      "repoId": "mzc-dev/api",
      "prNumber": 27,
      "prTitle": "Add payment webhook",
      "commitSha": "a1b2c3d",
      "riskScore": 84,
      "riskLevel": "HIGH",
      "mergeRecommendation": "BLOCK",
      "approvalStatus": "NEEDS_REVIEW",
      "summary": "...",
      "createdAt": "2026-06-09T10:00:00Z"
    }
  ],
  "pagination": {
    "nextCursor": "eyJ...",
    "hasMore": true,
    "count": 20
  }
}
```

---

### GET /reports/{reportId}

리포트 상세 조회 (Finding 포함).

**Response**:
```json
{
  "success": true,
  "data": {
    "reportId": "01HN5X...",
    "repoId": "mzc-dev/api",
    "prNumber": 27,
    "prTitle": "Add payment webhook",
    "commitSha": "a1b2c3d",
    "riskScore": 84,
    "riskLevel": "HIGH",
    "mergeRecommendation": "BLOCK",
    "approvalStatus": "NEEDS_REVIEW",
    "summary": "...",
    "requiredActions": ["..."],
    "agentSummaries": {
      "code": "...",
      "infra": "...",
      "security": "...",
      "risk": "..."
    },
    "findings": [
      {
        "findingId": "01HN5X...",
        "agent": "infra_reviewer",
        "severity": "HIGH",
        "category": "IAM",
        "file": "infra/iam.tf",
        "line": 42,
        "title": "Wildcard IAM permission",
        "description": "...",
        "evidence": "...",
        "impact": "...",
        "recommendation": "...",
        "fixable": true,
        "confidence": 0.92
      }
    ],
    "agentRuns": [
      {
        "runId": "01HN5X...",
        "agentType": "ORCHESTRATOR",
        "status": "COMPLETED",
        "latencyMs": 12500,
        "inputTokens": 4200,
        "outputTokens": 1800
      }
    ],
    "reportUrl": "https://aigo-reports.s3.../reports/01HN5X.../report.md",
    "createdAt": "2026-06-09T10:00:00Z"
  }
}
```

---

### POST /reports/{reportId}/approve

리포트 승인.

**권한**: `REVIEWER` 이상

**Request**:
```json
{
  "note": "위험 감수 후 승인. 다음 스프린트에 IAM 수정 예정."
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "approvalId": "01HN5X...",
    "reportId": "01HN5X...",
    "decision": "APPROVED",
    "approvedBy": "userId",
    "approvedAt": "2026-06-09T10:05:00Z"
  }
}
```

**사이드 이펙트**:
- DynamoDB Report `approvalStatus` → `APPROVED`
- DynamoDB Approval 레코드 생성
- DynamoDB AuditLog 기록
- GitHub Check Run → `success`
- Slack 알림 전송

---

### POST /reports/{reportId}/reject

리포트 거절.

**권한**: `REVIEWER` 이상

**Request**:
```json
{
  "reason": "IAM wildcard permission은 머지 전 반드시 수정 필요.",
  "requiredFindings": ["01HN5X...", "01HN5Y..."]
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "approvalId": "01HN5X...",
    "decision": "REJECTED",
    "reason": "IAM wildcard...",
    "rejectedBy": "userId",
    "rejectedAt": "2026-06-09T10:05:00Z"
  }
}
```

**사이드 이펙트**:
- DynamoDB Report `approvalStatus` → `REJECTED`
- GitHub Check Run → `failure`
- GitHub PR Comment 추가 (거절 사유 포함)
- Slack 알림 전송

---

## Fix API

### POST /reports/{reportId}/fix

Fix 요청 생성.

**권한**: `ADMIN` 이상

**Request**:
```json
{
  "findingIds": ["01HN5X...", "01HN5Y..."],
  "note": "IAM 권한과 webhook 검증 모두 수정 요청"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "fixId": "01HN5X...",
    "status": "PENDING",
    "findingIds": ["01HN5X...", "01HN5Y..."],
    "message": "Fix 생성을 시작했습니다. 완료되면 알림을 드립니다."
  }
}
```

---

### GET /fixes/{fixId}

Fix 상세 조회 (Preview 포함).

**Response**:
```json
{
  "success": true,
  "data": {
    "fixId": "01HN5X...",
    "status": "PREVIEW_READY",
    "findingIds": ["01HN5X..."],
    "previewDiff": "--- a/infra/iam.tf\n+++ b/infra/iam.tf\n...",
    "affectedFiles": ["infra/iam.tf"],
    "testResult": {
      "passed": 24,
      "failed": 0,
      "output": "All tests passed."
    },
    "createdAt": "2026-06-09T10:00:00Z"
  }
}
```

---

### POST /fixes/{fixId}/create-pr

승인 후 Fix PR 생성.

**권한**: `ADMIN` 이상

**Request**:
```json
{
  "branchName": "pullpilot/fix/pr-27-iam-webhook"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "fixId": "01HN5X...",
    "status": "PR_CREATED",
    "fixBranch": "pullpilot/fix/pr-27-iam-webhook",
    "fixPrUrl": "https://github.com/mzc-dev/api/pull/28",
    "fixPrNumber": 28
  }
}
```

---

## Jobs API

### GET /jobs

분석 Job 목록 조회.

**Query Parameters**: `repoId`, `status`, `limit`, `cursor`

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "jobId": "01HN5X...",
      "repoId": "mzc-dev/api",
      "prNumber": 27,
      "prTitle": "Add payment webhook",
      "status": "COMPLETED",
      "startedAt": "2026-06-09T10:00:00Z",
      "completedAt": "2026-06-09T10:02:30Z",
      "reportId": "01HN5X..."
    }
  ]
}
```

---

### GET /agent-runs

Agent 실행 기록 조회.

**Query Parameters**: `jobId`, `agentType`, `limit`, `cursor`

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "runId": "01HN5X...",
      "jobId": "01HN5X...",
      "agentType": "CODE_REVIEWER",
      "status": "COMPLETED",
      "model": "claude-sonnet-4-x",
      "promptVersion": "v1",
      "inputTokens": 4200,
      "outputTokens": 1800,
      "latencyMs": 8200,
      "toolCallCount": 5,
      "startedAt": "2026-06-09T10:00:30Z",
      "completedAt": "2026-06-09T10:01:00Z"
    }
  ]
}
```

---

## Incidents API

### GET /incidents

Incident 목록 조회.

**Query Parameters**: `serviceId`, `status`, `limit`, `cursor`

### GET /incidents/{incidentId}

Incident 상세 (RCA 포함).

**Response**:
```json
{
  "success": true,
  "data": {
    "incidentId": "01HN5X...",
    "serviceId": "prod-api",
    "trigger": "ALARM",
    "status": "INVESTIGATING",
    "severity": "P1",
    "summary": "prod-api 5xx 급증, 14:02 배포 이후 시작",
    "timeline": [
      {"time": "2026-06-09T14:00:00Z", "event": "배포 시작", "source": "CloudTrail"},
      {"time": "2026-06-09T14:03:00Z", "event": "5xx 급증", "source": "CloudWatch"}
    ],
    "rootCauses": [
      {"cause": "PR #27 webhook validation 누락", "confidence": 0.87}
    ],
    "relatedPrIds": [27],
    "recommendedActions": ["PR #27 롤백"],
    "rollbackSuggestion": "git revert a1b2c3d",
    "confidence": 0.85,
    "rcaUrl": "https://aigo-incidents.s3.../incidents/01HN5X.../rca.md",
    "createdAt": "2026-06-09T14:05:00Z"
  }
}
```

---

## Settings API

### GET /settings

조직 및 레포 설정 조회.

**Response**:
```json
{
  "success": true,
  "data": {
    "orgId": "01HN5X...",
    "notifications": {
      "slack": {
        "enabled": true,
        "channel": "#devops-alerts",
        "notifyOn": ["HIGH", "CRITICAL"]
      }
    },
    "repositories": [
      {
        "repoId": "mzc-dev/api",
        "analysisEnabled": true,
        "strictMode": true,
        "blockThreshold": "HIGH",
        "requireApproval": true
      }
    ],
    "agentSettings": {
      "promptVersion": "v1",
      "model": "claude-sonnet-4-x"
    }
  }
}
```

### PUT /settings

설정 업데이트. **권한**: `ADMIN` 이상

---

## API 응답 시간 목표 (SLA)

| API 그룹 | p50 | p99 | 최대 |
|---------|-----|-----|------|
| Webhook 수신 (즉시 반환) | < 100ms | < 500ms | 3s |
| 리포트 조회 | < 200ms | < 800ms | 3s |
| 승인/거절 | < 300ms | < 1000ms | 3s |
| Fix 요청 생성 | < 200ms | < 800ms | 3s |
| Agent 분석 (비동기) | - | - | 5분 |
| Fix 생성 (비동기) | - | - | 15분 |
| Incident 조사 (비동기) | - | - | 5분 |

---

## 변경 이력

### 2026-06-15 — approve/reject 단일 엔드포인트 통합

**변경 내용**: `POST /reports/{reportId}/approve`와 `POST /reports/{reportId}/reject`가 별도 라우트로 설계되어 있으나, 실제 구현은 **`POST /reports/{reportId}/approve` 단일 엔드포인트**가 `decision` 필드로 양쪽 처리.

```json
// 승인
{ "decision": "APPROVED", "comment": "LGTM" }

// 거절
{ "decision": "REJECTED", "comment": "보안 취약점 수정 필요" }
```

**사이드 이펙트 (실제)**:
- DynamoDB `aigo-Reports.approvalStatus` 업데이트
- DynamoDB `aigo-Approvals` 레코드 생성
- `aigo-notification-queue` (Standard)에 `REVIEW_SUBMITTED` 메시지 전송 (FIFO 파라미터 없음)
- `notification-worker`가 메시지 소비:
  - GitHub PR Review 제출 (`APPROVE` 또는 `REQUEST_CHANGES`)
  - APPROVED 시: `PUT /repos/{owner}/{repo}/pulls/{n}/merge` (PR 머지)
  - REJECTED 시: `PATCH /repos/{owner}/{repo}/pulls/{n}` `{state: 'closed'}` (PR 닫기)

---

### 2026-06-15 — 별도 API Lambda 미배포 (통합 dashboard-api)

**변경 내용**: 문서에 기재된 `approval-api`, `fix-api`, `settings-api`는 별도 Lambda로 배포되지 않음. 모두 `aigo-dashboard-api` (Hono 단일 Lambda)의 라우트.

**실제 라우트 (dashboard-api 처리)**:

| 메서드 | 경로 | 설명 |
|-------|------|------|
| POST | /reports/{id}/approve | 승인·거절 (decision 필드) |
| POST | /fix | Fix 요청 생성 |
| GET | /fix | Fix 목록 (`?status=` 필터) |
| GET | /fix/{fixId} | Fix 상세 |
| GET | /settings | 조직 설정 |
| PATCH | /settings | 조직 설정 변경 (ADMIN 이상, slackChannel → SSM 동기화) |
| DELETE | /reports/{id} | 리포트 삭제 (soft-delete, ADMIN 이상) |
| GET | /jobs/active | IN_PROGRESS + PENDING 잡 병합 조회 (3~5초 폴링) |
| GET | /jobs/agent-runs | 특정 Job의 Agent 실행 목록 |
| GET | /integrations | GitHub/Slack 연동 상태 |
| DELETE | /integrations/slack | Slack 연결 해제 |
| GET | /team/members | 팀원 목록 |
| POST | /team/invite | 초대 발송 |
| GET | /team/invite/{token} | 초대 토큰 조회 (no auth — 공개 라우트) |
| POST | /team/accept-invite | 초대 수락 |

---

### 2026-06-15 — Settings riskThreshold 타입

**변경 내용**: `PATCH /settings`의 `riskThreshold` 필드 타입이 정수가 아닌 **문자열**.

```json
// 가능한 값
{ "riskThreshold": "NONE" }   // 자동 머지 없음
{ "riskThreshold": "LOW" }    // risk_score < 20
{ "riskThreshold": "MEDIUM" } // risk_score < 40
{ "riskThreshold": "HIGH" }   // risk_score < 75 (기본값)
{ "riskThreshold": "CRITICAL" } // 모두 자동 머지
```

내부 임계값 변환: `orchestrator`의 `THRESHOLD_MAP = {'NONE': -1, 'LOW': 19, 'MEDIUM': 39, 'HIGH': 74, 'CRITICAL': 100}`.

