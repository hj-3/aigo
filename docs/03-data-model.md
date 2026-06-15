# 데이터 모델

## DynamoDB 설계 원칙

- **멀티 테이블**: 도메인별 테이블 분리 (단일 테이블보다 접근 패턴이 명확)
- **PK 형식**: `{ENTITY_TYPE}#{id}` — 엔티티 타입을 PK에 포함해 scan 없이 타입 구분
- **ID 형식**: ULID — 시간 정렬 가능 + UUID 수준 유일성 (lexicographic 정렬)
- **암호화**: KMS CMK (고객 관리 키), 테이블별 별도 키
- **용량 모드**: PAY_PER_REQUEST
- **PITR**: 모든 테이블 항상 활성화
- **GSI 원칙**: 필요한 접근 패턴만, 최대 3개/테이블

---

## 테이블 설계

### Organizations

**목적**: 서비스를 사용하는 조직(회사/팀) 단위 정보

| 키 | 형식 | 예시 |
|----|------|------|
| PK | `ORG#{orgId}` | `ORG#01HN5X...` |

```
Attributes:
  orgId        String   ULID
  name         String   조직 이름
  plan         String   FREE | PRO | ENTERPRISE
  status       String   ACTIVE | SUSPENDED
  settings     Map      분석 정책, 알림 설정
  createdAt    String   ISO 8601
  updatedAt    String   ISO 8601
```

---

### Users

**목적**: 대시보드 사용자 정보 및 권한

| 키 | 형식 | 예시 |
|----|------|------|
| PK | `USER#{userId}` | `USER#01HN5X...` |
| GSI1 PK | `orgId` | `01HN5X...` |
| GSI1 SK | `email` | `user@example.com` |

```
Attributes:
  userId       String   Cognito sub 또는 ULID
  orgId        String   소속 조직 ID
  email        String
  name         String
  role         String   OWNER | ADMIN | REVIEWER | VIEWER
  preferences  Map      리뷰 형식, 알림 설정
  lastLoginAt  String
  createdAt    String
```

**접근 패턴**:
- 사용자 단건 조회: PK → `USER#{userId}`
- 조직별 사용자 목록: GSI1 → `orgId`

---

### Repositories

**목적**: 연결된 GitHub 레포지터리 정보

| 키 | 형식 | 예시 |
|----|------|------|
| PK | `REPO#{repoId}` | `REPO#mzc-dev#api` |
| GSI1 PK | `orgId` | `01HN5X...` |
| GSI1 SK | `provider#repoId` | `github#mzc-dev#api` |

```
Attributes:
  repoId           String   {owner}/{repo}
  orgId            String
  provider         String   github (향후 gitlab, bitbucket)
  fullName         String   mzc-dev/api
  installationId   String   GitHub App Installation ID
  defaultBranch    String   main
  settings         Map      분석 활성화, 알림 채널, 엄격도
  createdAt        String
```

**접근 패턴**:
- 레포 단건 조회: PK
- 조직별 레포 목록: GSI1

---

### AnalysisJobs

**목적**: PR 분석 작업 추적 (write 많음)

| 키 | 형식 |
|----|------|
| PK | `JOB#{jobId}` |
| GSI1 PK | `repoId` |
| GSI1 SK | `createdAt` |
| GSI2 PK | `orgId#status` (예: `01HN5X#RUNNING`) |
| GSI2 SK | `createdAt` |

```
Attributes:
  jobId          String   ULID
  orgId          String
  repoId         String
  prNumber       Number
  prTitle        String
  commitSha      String
  status         String   PENDING | RUNNING | COMPLETED | FAILED
  jobType        String   PR_ANALYSIS | REANALYSIS
  agentRunIds    List     AgentRun ID 목록
  idempotencyKey String   {repoId}#{prNumber}#{commitSha}
  startedAt      String
  completedAt    String
  createdAt      String
  ttl            Number   90일 후 자동 삭제 (Epoch)
```

**접근 패턴**:
- Job 단건: PK
- 레포별 최근 Job: GSI1 (repoId, createdAt 역순)
- 대시보드 상태별 필터: GSI2 (orgId#RUNNING)

---

### AgentRuns

**목적**: 각 Agent 실행 기록 및 성능 추적

| 키 | 형식 |
|----|------|
| PK | `RUN#{runId}` |
| GSI1 PK | `jobId` |
| GSI1 SK | `agentType` |

```
Attributes:
  runId          String   ULID
  jobId          String
  agentType      String   ORCHESTRATOR | CODE_REVIEWER | INFRA_REVIEWER |
                          RISK_REVIEWER | SECURITY_AGENT | INCIDENT_AGENT | FIX_AGENT
  status         String   RUNNING | COMPLETED | FAILED
  model          String   claude-sonnet-4-x
  promptVersion  String   v1
  inputTokens    Number
  outputTokens   Number
  latencyMs      Number
  toolCalls      List     [{tool, input, output, durationMs}]
  rawOutputS3Key String   agent-outputs/{orgId}/{runId}/{agentType}.json
  error          Map      code, message (실패 시)
  startedAt      String
  completedAt    String
```

---

### Reports

**목적**: 분석 결과 리포트 (read 많음, 대시보드 핵심)

| 키 | 형식 | 예시 |
|----|------|------|
| PK | `REPORT#{reportId}` | `REPORT#01HN5X...-report` |
| GSI1 PK | `JOB#{jobId}` | `JOB#01HN5X...` |
| GSI1 SK | `createdAt` | ISO 8601 |
| GSI2 PK | `REPO#{repoId}` | `REPO#myorg/api` |
| GSI2 SK | `createdAt` | ISO 8601 |
| GSI3 PK | `ORG#{orgId}` | `ORG#01HN5X...` ← dashboard-api가 이 형식으로 쿼리 |
| GSI3 SK | `{approvalStatus}#{createdAt}` | `PENDING#2026-06-12T10:00:00Z` |

```
Attributes:
  reportId            String   {jobId}-report
  orgId               String
  repoId              String   {owner}/{repo}
  jobId               String
  riskScore           Number   0–100  (CRITICAL×25 + HIGH×10 + MEDIUM×3 + LOW×1, max 100)
  riskLevel           String   LOW | MEDIUM | HIGH | CRITICAL
  mergeRecommendation String   APPROVE | REQUEST_CHANGES | BLOCK
  approvalStatus      String   PENDING | APPROVED | REJECTED
  summary             String   전체 요약 (2–3 문장)
  findingsBySeverity  Map      {CRITICAL: N, HIGH: N, MEDIUM: N, LOW: N, INFO: N}
  reportS3Key         String   Optional S3 key for full report JSON
  createdAt           String
  updatedAt           String
```

**접근 패턴**:
- 리포트 단건: PK
- Job의 리포트: GSI1 (`JOB#{jobId}`)
- 레포별 최근 리포트: GSI2 (`REPO#{repoId}`)
- 대시보드 org별 최근 리포트: GSI3 (`ORG#{orgId}`, createdAt 역순)

> **주의**: GSI3PK는 `ORG#{orgId}` 형식이며, `dashboard-api`가 쿼리하는 인덱스 이름은 `GSI3-orgApprovalStatus-createdAt-index`

---

### Findings

**목적**: Agent가 발견한 개별 이슈 항목

| 키 | 형식 |
|----|------|
| PK | `FINDING#{findingId}` |
| GSI1 PK | `reportId` |
| GSI1 SK | `severity#findingId` |
| GSI2 PK | `repoId#category` |
| GSI2 SK | `createdAt` |

```
Attributes:
  findingId      String   ULID
  reportId       String
  repoId         String
  agent          String   code_reviewer | infra_reviewer | ...
  severity       String   INFO | LOW | MEDIUM | HIGH | CRITICAL
  category       String   IAM | SECRET | BUG | TEST | COST | COMPLIANCE | ...
  file           String   infra/iam.tf
  line           Number   42
  title          String   Wildcard IAM permission
  description    String
  evidence       String   Diff 근거
  impact         String
  recommendation String
  fixable        Boolean
  confidence     Number   0.0–1.0
  fixRequestId   String   (Fix 요청 시 연결)
  createdAt      String
```

**Finding Schema는 모든 Agent가 동일한 형식을 따른다.**

---

### Approvals

**목적**: 승인/거절 기록 (Audit용)

| 키 | 형식 |
|----|------|
| PK | `APPROVAL#{approvalId}` |
| GSI1 PK | `reportId` |
| GSI2 PK | `orgId` |
| GSI2 SK | `createdAt` |

```
Attributes:
  approvalId   String   ULID
  reportId     String
  orgId        String
  actorId      String   userId
  actorName    String
  decision     String   APPROVED | REJECTED
  reason       String   거절 사유 (거절 시 필수)
  channel      String   DASHBOARD | SLACK
  createdAt    String
```

---

### FixRequests

**목적**: Fix 요청 및 생성 상태 추적

| 키 | 형식 |
|----|------|
| PK | `FIX#{fixId}` |
| GSI1 PK | `reportId` |
| GSI1 SK | `status` |
| GSI2 PK | `orgId#status` |
| GSI2 SK | `createdAt` |

```
Attributes:
  fixId          String   ULID
  orgId          String
  reportId       String
  findingIds     List     대상 Finding ID 목록
  status         String   PENDING | GENERATING | PREVIEW_READY | APPROVED | PR_CREATED | FAILED
  requestedBy    String   userId
  patchS3Key     String   patches/{orgId}/{fixId}/fix.patch
  previewDiff    String   (짧은 diff) 또는 S3 key
  testResult     Map      {passed, failed, output}
  fixBranch      String   pullpilot/fix/pr-{prNumber}-{category}
  fixPrUrl       String   생성된 Fix PR URL
  fixPrNumber    Number
  createdAt      String
  completedAt    String
```

---

### Incidents

**목적**: 장애 조사 및 RCA 기록

| 키 | 형식 |
|----|------|
| PK | `INCIDENT#{incidentId}` |
| GSI1 PK | `orgId` |
| GSI1 SK | `createdAt` |
| GSI2 PK | `serviceId#status` |
| GSI2 SK | `createdAt` |

```
Attributes:
  incidentId         String   ULID
  orgId              String
  serviceId          String   prod-api, payment-service 등
  trigger            String   ALARM | SLACK | MANUAL | EVENTBRIDGE
  triggerDetail      Map      alarm 이름, command 내용 등
  status             String   INVESTIGATING | RESOLVED | CLOSED
  severity           String   P1 | P2 | P3
  summary            String
  timeline           List     [{time, event, source}]
  rootCauses         List     근본 원인 후보 목록
  relatedPrIds       List     관련 PR 번호
  relatedDeployments List     관련 배포 이벤트
  recommendedActions List
  rollbackSuggestion String
  confidence         Number   0.0–1.0
  rcaS3Key           String   incidents/{orgId}/{incidentId}/rca.md
  agentRunId         String
  createdAt          String
  resolvedAt         String
```

---

### AuditLogs

**목적**: 모든 사용자 행동 기록 (Append-only, 법적 보존 목적)

| 키 | 형식 |
|----|------|
| PK | `LOG#{logId}` (ULID) |
| GSI1 PK | `orgId` |
| GSI1 SK | `createdAt` |
| GSI2 PK | `actorId` |
| GSI2 SK | `createdAt` |

```
Attributes:
  logId        String   ULID
  orgId        String
  actorId      String   userId 또는 system
  actorType    String   USER | SYSTEM | AGENT
  action       String   APPROVE | REJECT | FIX_REQUEST | FIX_APPROVE | LOGIN | ...
  resource     String   REPORT | FIX | INCIDENT | SETTING
  resourceId   String
  detail       Map      변경 전/후, 추가 컨텍스트
  ip           String
  userAgent    String
  createdAt    String
  ttl          Number   90일 TTL (S3 Export 후 DynamoDB 자동 삭제)
```

**AuditLogs는 DynamoDB Streams → Lambda → S3로 실시간 Export해 장기 보존.**

---

### UsageRecords

**목적**: 조직별 월간 사용량 집계 (과금 기준)

| 키 | 형식 |
|----|------|
| PK | `USAGE#{orgId}#{yearMonth}` (예: `USAGE#01HN5X#2026-06`) |

```
Attributes:
  orgId            String
  yearMonth        String   2026-06
  analysisCount    Number   PR 분석 횟수
  fixCount         Number   Fix PR 생성 횟수
  incidentCount    Number   Incident 조사 횟수
  inputTokens      Number   총 입력 토큰
  outputTokens     Number   총 출력 토큰
  estimatedCost    Number   USD (Bedrock 비용 추정)
  updatedAt        String
```

---

### Integrations

**목적**: 조직별 GitHub App 설치 및 Slack 워크스페이스 연동 정보

| 키 | 형식 | 예시 |
|----|------|------|
| PK | `ORG#{orgId}` | `ORG#01HN5X` |
| SK | `INTEGRATION#GITHUB` 또는 `INTEGRATION#SLACK` | |
| GSI1 PK | `ORG#{orgId}` | |
| GSI1 SK | `INTEGRATION#GITHUB` | |
| GSI2 PK | `INSTALLATION#{installationId}` (GitHub) 또는 `SLACK_TEAM#{teamId}` (Slack) | `INSTALLATION#12345678` |

```
GitHub 연동 Attributes:
  type             String   GITHUB
  installationId   String   GitHub App installation ID
  accountLogin     String   GitHub 계정/조직명
  status           String   ACTIVE | UNINSTALLED | SUSPENDED
  createdAt        String
  updatedAt        String

Slack 연동 Attributes:
  type             String   SLACK
  slackTeamId      String   Slack workspace team ID
  slackTeamName    String   Slack workspace name
  botUserId        String   Bot user ID
  scope            String   OAuth scopes
  status           String   ACTIVE | DISCONNECTED
  createdAt        String
  updatedAt        String
```

**Slack Bot Token 저장 위치 (SSM Parameter Store)**:
```
/{project}/integrations/slack/{orgId}/bot-token  (SecureString)
```

**조회 패턴**:
- 조직의 GitHub 연동 상태: `PK = ORG#{orgId}`, `SK = INTEGRATION#GITHUB`
- installationId → orgId 역조회: `GSI2` `INSTALLATION#{installationId}`
- Slack teamId → orgId 역조회: `GSI2` `SLACK_TEAM#{teamId}`

---

### OrgInvitations

**목적**: 조직 팀원 초대 관리 (TTL 7일)

| 키 | 형식 | 예시 |
|----|------|------|
| PK | `ORG#{orgId}` | `ORG#01HN5X` |
| SK | `INVITATION#{invitationId}` | `INVITATION#01HN5XABC` |
| GSI1 PK | `EMAIL#{email}` | `EMAIL#user@company.com` |
| GSI1 SK | `createdAt` | ISO 8601 |

```
Attributes:
  invitationId  String   ULID
  orgId         String
  email         String   초대받는 이메일
  role          String   ADMIN | REVIEWER | VIEWER
  status        String   PENDING | ACCEPTED | EXPIRED
  invitedBy     String   초대한 userId
  createdAt     String
  ttl           Number   Unix timestamp (7일 후)
```

---

## Finding 표준 Schema

모든 Reviewer Agent는 동일한 Finding schema를 반환한다.

```json
{
  "agent": "infra_reviewer",
  "severity": "HIGH",
  "category": "IAM",
  "file": "infra/iam.tf",
  "line": 42,
  "title": "Wildcard IAM permission detected",
  "description": "The IAM policy grants dynamodb:* on Resource: *, allowing unintended access.",
  "evidence": "Diff shows '+ Action = [\"dynamodb:*\"]' and '+ Resource = \"*\"'",
  "impact": "Any principal with this policy can access all DynamoDB tables in the account.",
  "recommendation": "Restrict actions to required operations and scope Resource to specific table ARNs.",
  "fixable": true,
  "confidence": 0.92
}
```

## Risk Reviewer 최종 출력 Schema

```json
{
  "riskScore": 84,
  "riskLevel": "HIGH",
  "mergeRecommendation": "BLOCK",
  "summary": "PR introduces broad IAM permissions and lacks webhook signature validation, creating significant security risk.",
  "requiredActions": [
    "Restrict IAM policy to specific actions and resource ARNs",
    "Add webhook signature validation before processing payloads"
  ],
  "agentSummaries": {
    "code": "Missing input validation in webhook handler. No unit tests for error paths.",
    "infra": "IAM wildcard detected. Resource scoping required.",
    "security": "Webhook signature verification absent. Potential SSRF vector in redirect logic.",
    "risk": "Combined risk of over-permissioned IAM and unvalidated webhook is HIGH. Block merge."
  }
}
```

---

## S3 버킷 구조

### 버킷 목록

| 버킷 이름 | 용도 | 버전 관리 | 암호화 |
|-----------|------|-----------|--------|
| `aigo-frontend` | 대시보드 정적 파일 (CloudFront OAC) | OFF | SSE-S3 |
| `aigo-artifacts` | Lambda ZIP, 빌드 산출물 | ON | SSE-KMS |
| `aigo-diffs` | GitHub PR diff 파일 | OFF | SSE-KMS |
| `aigo-reports` | 생성된 마크다운 리포트 | ON | SSE-KMS |
| `aigo-agent-outputs` | Agent raw JSON 출력 | OFF | SSE-KMS |
| `aigo-patches` | Fix 패치 파일 | ON | SSE-KMS |
| `aigo-incidents` | Incident RCA 리포트 | ON | SSE-KMS |
| `aigo-kb` | Knowledge Base 문서 | ON | SSE-KMS |
| `aigo-logs` | 액세스 로그, CloudWatch export | OFF | SSE-KMS |
| `aigo-backup` | DynamoDB export, 백업 | ON | SSE-KMS |
| `aigo-tf-state` | Terraform 원격 상태 | ON | SSE-KMS |

### S3 키 네이밍

```
diffs/{orgId}/{repoId}/pr-{prNumber}/{commitSha}.diff
reports/{orgId}/{reportId}/report.md
agent-outputs/{orgId}/{runId}/{agentType}.json
patches/{orgId}/{fixId}/fix.patch
incidents/{orgId}/{incidentId}/rca.md
kb/aws-best-practices/{category}/{docId}.md
kb/org-policies/{orgId}/{policyId}.md
backup/dynamodb/{tableName}/{date}/export.json
```

### S3 Lifecycle 정책

| 버킷 | 30일 | 90일 | 365일 |
|------|------|------|-------|
| diffs | → Infrequent Access | → Glacier IR | 삭제 |
| agent-outputs | → IA | → Glacier | 삭제 |
| reports | - | → IA | → Glacier |
| patches | → IA | 삭제 | - |
| incidents | - | → IA | → Glacier |
| logs | → IA | → Glacier | 삭제 |

### 블록 퍼블릭 액세스

모든 버킷은 `BlockPublicAcls = true`, `BlockPublicPolicy = true`, `IgnorePublicAcls = true`, `RestrictPublicBuckets = true`.

대시보드 버킷은 CloudFront OAC(Origin Access Control)로만 접근.

---

## Bedrock Knowledge Base

### 구성

- **Vector Store**: Amazon OpenSearch Serverless (또는 초기에 Bedrock 관리형 벡터 DB)
- **Embedding Model**: Amazon Titan Embeddings
- **문서 소스**: S3 `aigo-kb/`

### 문서 범주

| 경로 | 내용 |
|------|------|
| `kb/aws-best-practices/iam/` | IAM 최소 권한, 역할 설계 패턴 |
| `kb/aws-best-practices/iac/` | Terraform, CloudFormation 모범 사례 |
| `kb/aws-best-practices/security/` | AWS 보안 가이드라인 |
| `kb/aws-best-practices/cost/` | 비용 최적화 패턴 |
| `kb/org-policies/{orgId}/` | 조직별 커스텀 정책 문서 |
| `kb/incident-patterns/` | 과거 장애 패턴 (일반화) |

### kb_tools 검색 방식

Agent가 `kb_tools`를 통해 벡터 유사도 검색으로 관련 문서 조회. 직접 S3 접근 금지.

---

## AgentMemory Table (Table #15)

에이전트의 장기 기억 저장소. PR 분석 결과, 인시던트 RCA, 개발자 패턴, 인간 승인 피드백을 90일~1년 보관.

| 필드 | 타입 | 설명 |
|------|------|------|
| PK | String | `MEMORY#{type}#ORG#{orgId}#{entityKey}` |
| SK | String | ISO8601 타임스탬프 (시간순 정렬) |
| memoryType | String | `PR_ANALYSIS` / `INCIDENT` / `APPROVAL_FEEDBACK` |
| orgId | String | 조직 ID |
| GSI1PK | String | `ORG#{orgId}#REPO#{repoId}` 또는 `ORG#{orgId}#SERVICE#{service}` |
| GSI1SK | String | 타임스탬프 |
| GSI2PK | String | `ORG#{orgId}#AUTHOR#{authorLogin}` 또는 `ORG#{orgId}#APPROVALS` |
| GSI2SK | String | 타임스탬프 |
| ttl | Number | 만료 Unix timestamp (PR: 90일, Incident: 1년) |

**인덱스:**
- `GSI1-repo-time-index`: repo/service별 최근 분석 조회 → Orchestrator 사전 컨텍스트 조회
- `GSI2-author-time-index`: 개발자별 패턴 조회 → 반복 실수 탐지

**메모리 활용 흐름:**
1. PR 분석 시작 → `get_repo_memory` + `get_developer_memory` 호출로 과거 이력 조회
2. 분석 완료 → `save_pr_analysis_memory` 호출로 결과 저장
3. 인시던트 발생 → `get_incident_memory` 호출로 유사 과거 장애 조회
4. 인시던트 해결 → `save_incident_memory` 호출로 RCA 저장
5. 사용자 승인/거절 → `POST /reports/:id/approve` → AgentMemory에 인간 피드백 기록
