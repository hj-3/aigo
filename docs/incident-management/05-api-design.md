# AIGO Incident Management — API 설계

## 기본 정보

- Base URL: `https://api.aigo.dev/im`
- 인증: Cognito JWT (기존 동일)
- 권한: MEMBER(읽기), ADMIN(승인), OWNER(실행·설정)

---

## Incidents

### `GET /im/summary`
대시보드 요약 카드용.

```json
{
  "active": 2,
  "investigating": 1,
  "recoveryPending": 1,
  "resolvedToday": 3,
  "avgResolutionMinutes": 28,
  "lastUpdatedAt": "2026-06-21T03:10:00Z"
}
```

### `GET /im/incidents`
**Query**: `status`, `severity`, `limit`, `cursor`

```json
{
  "items": [{
    "incidentId": "inc_01J...",
    "title": "[P1] prod-api CPU 급등",
    "severity": "P1",
    "status": "INVESTIGATING",
    "affectedService": "EC2",
    "detectedAt": "2026-06-21T03:00:00Z"
  }],
  "nextCursor": "inc_01J..."
}
```

### `GET /im/incidents/:id`
인시던트 상세 + 타임라인.

### `GET /im/incidents/:id/scope`
scope_agent 분석 결과.

```json
{
  "rootCause": "메모리 누수로 인한 OOM 발생. 트래픽 급증과 맞물려 GC 과부하.",
  "affectedServices": ["EC2", "API Gateway", "RDS"],
  "affectedResources": ["i-0abc123", "prod-db"],
  "blastRadius": "API 전체 응답 불가, DB 연결 포화",
  "timeline": [
    { "time": "2026-06-21T02:58:00Z", "event": "트래픽 3배 급증", "source": "CloudWatch" },
    { "time": "2026-06-21T02:59:00Z", "event": "CPU 95% 초과", "source": "CloudWatch Alarm" }
  ],
  "recoveryOptions": [{
    "optionId": "opt_01",
    "title": "EC2 인스턴스 재부팅",
    "riskLevel": "LOW",
    "estimatedRecoveryTime": "3분",
    "allowedActionId": "act_EC2_RebootInstances"
  }],
  "confidence": 87,
  "generatedAt": "2026-06-21T03:05:00Z"
}
```

### `GET /im/incidents/:id/report`
보고서 메타데이터 + S3 presigned URL (15분 유효).

```json
{
  "incidentId": "inc_01J...",
  "summary": "prod-api 서버 OOM으로 인한 서비스 중단. 3분 내 재부팅으로 복구.",
  "downloadUrl": "https://s3.../report.md?X-Amz-Signature=...",
  "emailSentTo": ["oncall@example.com"],
  "generatedAt": "2026-06-21T03:08:00Z"
}
```

### `GET /im/incidents/:id/recovery`
복구 방안 목록 + 실행 현황.

### `POST /im/incidents/:id/recovery/:optionId/approve`
ADMIN 이상. 복구 방안 승인 → `status=APPROVED`.

### `POST /im/incidents/:id/recovery/:optionId/execute`
OWNER 전용. action_executor Lambda 호출.

**Response 202**
```json
{ "actionId": "act_01J...", "status": "EXECUTING" }
```

### `PATCH /im/incidents/:id/status`
수동 상태 변경 (RESOLVED, CLOSED).

```json
{ "status": "RESOLVED", "resolvedNote": "재부팅 후 정상 복구 확인" }
```

---

## Chat

### `POST /im/chat`
chat_agent 호출, 인시던트 컨텍스트 기반 Q&A.

**Request**
```json
{
  "incidentId": "inc_01J...",
  "message": "이 장애가 DB 연결 문제랑 연관이 있어?",
  "convId": "conv_01J..."
}
```

**Response**
```json
{
  "response": "네, 분석 데이터에 따르면 EC2 OOM으로 API 서버가 응답 불가 상태가 되면서 RDS 연결이 timeout되지 않고 누적되었습니다. 현재 연결 수 482/500으로 포화 직전입니다.",
  "convId": "conv_01J..."
}
```

### `GET /im/chat`
**Query**: `incidentId` — 특정 인시던트 대화 이력 목록.

---

## Settings

### `GET /im/settings/allowed-actions`
허용 복구 작업 목록.

```json
{
  "items": [{
    "allowedActionId": "act_EC2_RebootInstances",
    "service": "EC2",
    "operation": "RebootInstances",
    "displayName": "EC2 인스턴스 재부팅",
    "riskLevel": "LOW",
    "isActive": true
  }]
}
```

### `POST /im/settings/allowed-actions`
OWNER 전용. 신규 복구 작업 등록.

```json
{
  "service": "EC2",
  "operation": "RebootInstances",
  "displayName": "EC2 인스턴스 재부팅",
  "description": "OOM, 행 상태 등 인스턴스 문제 복구",
  "riskLevel": "LOW",
  "allowedParams": ["InstanceIds"]
}
```

### `PATCH /im/settings/allowed-actions/:id/toggle`
활성화/비활성화 토글.

### `DELETE /im/settings/allowed-actions/:id`
삭제 (진행 중인 복구에서 참조 중이면 거부).

---

## 에러 응답

```json
{ "error": "NOT_APPROVED",     "message": "승인되지 않은 복구 방안입니다." }
{ "error": "ACTION_NOT_ALLOWED","message": "허용 목록에 없거나 비활성화된 작업입니다." }
{ "error": "SCOPE_NOT_READY",  "message": "원인 분석이 아직 진행 중입니다." }
{ "error": "ALREADY_EXECUTING","message": "이미 실행 중인 복구 작업이 있습니다." }
```
