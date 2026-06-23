# Incident Management — 사용자 흐름 가이드

## 전체 흐름 개요

```
[설정] 조사 대상 등록 → 연동 설정 → 계정 등록
         ↓
[탐지] CloudWatch ALARM → EventBridge → normalize-event Lambda
         ↓
[인시던트] 자동 생성 또는 수동 생성 (POST /incidents)
         ↓
[조사] 조사 시작 → Step Functions → Supervisor/Scope/Summary Agent
         ↓
[결과] 근본 원인 + 조치 방안 보고서
         ↓
[조치] Mitigation Plan 생성 → 조치 실행 (action-executor)
         ↓
[종료] 인시던트 RESOLVED 처리
```

---

## 기능별 사용자 흐름

### 1. 조사 대상 설정 (`/im/targets`)

**목적**: 어떤 CloudWatch 알람이 울렸을 때 IM을 작동시킬지 등록한다.

#### 1-1. AWS 서비스 알람 등록

**UI 경로**: 조사 대상 설정 → AWS 서비스 탭 → 알람 등록 버튼

**입력 필드**:
| 필드 | 예시 | 설명 |
|------|------|------|
| AWS Account ID | `440744256869` | 12자리 계정 ID |
| AWS 서비스 | `EC2` | 서비스명 (자유 입력) |
| CloudWatch 알람명 | `prod-api-cpu-high` | 정확한 알람명 |
| 리전 | `ap-northeast-2` | 기본값 서울 |

**API**: `POST /targets`
```json
{
  "accountId": "440744256869",
  "serviceName": "EC2",
  "alarmName": "prod-api-cpu-high",
  "region": "ap-northeast-2"
}
```

**성공 결과**: 테이블에 ACTIVE 상태로 등록. EventBridge rule이 이 alarmName으로 오는 알람을 캐치하면 자동으로 인시던트 생성.

**주의**: 알람명은 CloudWatch에 등록된 것과 정확히 일치해야 한다. normalize-event Lambda가 알람명으로 타겟을 조회한다.

---

#### 1-2. 외부 도구 연동 (Webhook)

**UI 경로**: 조사 대상 설정 → 외부 도구 탭 → 연동 추가 버튼

**입력 필드**:
| 필드 | 선택지 | 설명 |
|------|--------|------|
| 도구 유형 | SLACK, PAGERDUTY, OPSGENIE, WEBHOOK | 연동 유형 |
| 연동 이름 | `prod-pagerduty` | 식별용 이름 |

**API**: `POST /integrations`
```json
{
  "type": "WEBHOOK",
  "name": "prod-pagerduty",
  "config": {}
}
```

**성공 결과**: `webhookToken`이 발급됨. 외부 도구가 이 토큰을 `POST /webhook/{integrationId}` 헤더에 실어서 이벤트를 전송한다.

---

### 2. 모니터링 (`/im/monitoring`)

**목적**: 등록된 알람들의 현재 CloudWatch 상태를 실시간으로 확인한다.

**동작 방식**:
1. `/monitoring` GET 요청
2. 백엔드가 DDB에서 등록된 targets 목록 조회
3. 각 accountId별로 (필요시 Cross-Account Role AssumeRole) CloudWatch API 호출
4. 알람 상태 반환

**표시 데이터**:
| 컬럼 | 설명 |
|------|------|
| 서비스 | 등록 시 입력한 serviceName |
| 알람명 | CloudWatch 알람명 |
| 계정 | AWS Account ID |
| 임계값 | CloudWatch threshold |
| 상태 | OK / ALARM / INSUFFICIENT_DATA |

**필터**: ALL / ALARM / OK 버튼으로 필터링 가능. 60초마다 자동 갱신.

**ALARM이 표시되면**: 이미 normalize-event가 실행되어 인시던트가 자동 생성되었을 가능성이 높다.

---

### 3. 인시던트 조사 (`/im/incidents`)

#### 3-1. 인시던트 목록

**표시 컬럼**:
| 컬럼 | 데이터 필드 |
|------|------------|
| 심각도 | `severity` (CRITICAL/HIGH/MEDIUM/LOW) |
| 발생 시각 | `createdAt` |
| 제목 | `title` |
| 영향 서비스 | `affectedServices[]` |
| 설명 | `description` |
| 상태 | `status` |

**상태 흐름**:
```
OPEN → INVESTIGATING → REPORTED → CLOSED
                    ↘ INVESTIGATION_FAILED
```

#### 3-2. 수동 인시던트 생성

인시던트는 두 가지 방법으로 생성된다:
1. **자동**: CloudWatch ALARM → EventBridge → normalize-event Lambda → Step Functions
2. **수동**: API `POST /incidents`로 직접 생성 (현재 대시보드 UI에서는 목록만 표시)

수동 생성 API:
```json
POST /incidents
{
  "title": "prod DB CPU 급증",
  "description": "RDS CPU 90% 이상 지속",
  "severity": "HIGH",
  "affectedServices": ["RDS", "API"],
  "linkedAccountId": "440744256869"
}
```

#### 3-3. 인시던트 상세 / 조사 시작

**UI 경로**: 인시던트 행 클릭 → 오른쪽 드로어 열림

**드로어 내 정보**:
- 계정 / 영향 서비스 / 심각도 / 상태 / 발생 원인 / 발생 시각
- 상태가 `OPEN`이면 "조사 시작" 버튼 표시

**"조사 시작" 버튼 클릭 시**:
1. `POST /incidents/{id}/investigate` 호출
2. 백엔드가 Step Functions 실행 시작
3. 인시던트 상태 → `INVESTIGATING`
4. 드로어에 "AI 조사 진행 중..." 표시

**Step Functions 내부 흐름**:
```
Start
  → supervisor-agent (조사 계획 수립)
  → scope-agent (영향 범위 + 근본 원인 분석, DDB에 SCOPE_RESULT 저장)
  → summary-agent (보고서 생성, S3에 저장)
End → 인시던트 상태 REPORTED
```

#### 3-4. 조사 결과 확인 (상태 = REPORTED)

드로어가 자동으로 갱신되면 결과 표시:
- **근본 원인** (rootCause)
- **영향 범위** (blastRadius)
- **이벤트 타임라인**

**"Mitigation Plan" 버튼** (REPORTED 상태일 때 표시):
- `POST /incidents/{id}/mitigation` 호출
- scope-agent가 남긴 `recoveryOptions`를 기반으로 조치 항목 생성
- 생성된 항목들이 조치 현황 탭에 나타남

**"장애보고서" 버튼** (reports가 있을 때 표시):
- S3 presigned URL로 보고서 다운로드

---

### 4. 조치 현황 (`/im/remediation`)

**목적**: Mitigation Plan에서 생성된 조치 항목들을 실행한다.

**표시 구조**: 인시던트별로 그룹화된 조치 목록

**조치 항목 컬럼**:
| 컬럼 | 설명 |
|------|------|
| 조치 내용 | description + actionType |
| 대상 리소스 | targetResource |
| 위험도 | riskLevel (LOW/MEDIUM/HIGH) |
| 예상 시간 | estimatedMinutes |
| 상태 | PENDING/RUNNING/COMPLETED/FAILED/SKIPPED |

**"실행" 버튼** (PENDING 상태):
1. `POST /remediations/{actionId}/execute` 호출
2. 백엔드가 action-executor Lambda를 비동기 호출
3. 상태 → RUNNING
4. action-executor가 완료 후 DDB 상태 업데이트

**HIGH 위험도** 조치 항목: ⚠ 아이콘 표시.

**조치 모드** (관리 탭에서 설정):
- `ALLOWLIST`: 허용 목록에 등록된 AWS API 조작만 실행 가능
- `ALL`: 모든 AWS API 실행 가능 (고위험)

---

### 5. 관리 (`/im/manage`)

#### 5-1. 계정 관리

**목적**: Cross-Account 조사를 위해 다른 AWS 계정을 연결한다.

**입력 필드**:
| 필드 | 예시 | 설명 |
|------|------|------|
| AWS Account ID | `123456789012` | 대상 계정 |
| 계정 별칭 | `prod-account` | 식별 이름 |
| Cross-Account Role ARN | `arn:aws:iam::123456789012:role/aigo-im-cross-account` | AssumeRole 대상 |

**API**: `POST /accounts`
```json
{
  "accountId": "123456789012",
  "accountAlias": "prod-account",
  "crossAccountRoleArn": "arn:aws:iam::123456789012:role/aigo-im-cross-account",
  "region": "ap-northeast-2"
}
```

**선행 작업**: 대상 계정에 IAM Role 생성 필요:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "AWS": "arn:aws:iam::440744256869:role/aigo-im-action-executor-role"
    },
    "Action": "sts:AssumeRole"
  }]
}
```

#### 5-2. 자동 조치 설정

**Remediation 모드**:
- **ALLOWLIST 모드**: 아래 허용 액션 목록 중 Enable된 것만 실행. 권장.
- **ALL 모드**: 모든 AWS API 실행 가능.

**허용 액션 목록**: `GET /settings/allowed-actions`에서 조회. 각 액션은 Toggle로 Enable/Disable.

---

## API 인증

모든 API(webhook, OPTIONS 제외)는 Cognito JWT 토큰 필요.

```
Authorization: Bearer <Cognito ID Token>
```

토큰의 필수 claims:
- `custom:orgId`: 조직 ID (데이터 격리 키)
- `custom:role`: OWNER/ADMIN/REVIEWER/VIEWER (쓰기 작업은 ADMIN 이상 필요)
- `cognito:username`: 작성자 기록용

---

## 알려진 제약사항

| 제약 | 내용 |
|------|------|
| 수동 인시던트 생성 UI | 현재 대시보드에 생성 폼 없음. API로만 가능. |
| 모니터링 실시간 수치 | CloudWatch GetMetricStatistics 미사용. threshold와 상태만 표시. |
| Webhook 수신 즉시 처리 | EventBridge rule이 DISABLED 상태. ENABLED로 전환 필요. |
| Cross-Account 역할 | 대상 계정에 IAM Role 수동 생성 선행 필요. |
| 인시던트 생성 대시보드 | 수동 생성 버튼 미구현 (API는 동작). |
