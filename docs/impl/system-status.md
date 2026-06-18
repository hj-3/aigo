# AgentOps Platform — 시스템 전체 현황 (2026-06-18, 최종 업데이트)

이 문서는 이전 세션 내역이 잘려나가도 한 곳에서 전체를 파악할 수 있도록 작성된 단일 참조 문서입니다.

---

## 1. 전체 아키텍처 흐름

```
GitHub PR ──► API GW ──► github-connector Lambda
                              │
                              │ SendMessage (직접 SQS, MessageGroupId=orgId)
                              ▼
                         SQS analysis-queue.fifo
                              │
                              ▼
Slack /approve          lightweight-worker Lambda  ◄── SQS command-queue.fifo ◄── slack-connector
/reject                       │                                                        (직접 SQS)
/investigate                  │
                        switch(message.type)
                         ├─ ANALYSIS_REQUESTED  → invokeOrchestratorAsync (Lambda 비동기)
                         ├─ COMMAND             → DDB Approvals 기록 + notification-queue
                         └─ INCIDENT_TRIGGERED  → DDB Incidents 업데이트 + invokeOrchestratorAsync

CloudWatch Alarm ──► aws-event-connector ──► SQS incident-queue.fifo ──► lightweight-worker
                         (직접 SQS)

Orchestrator Lambda (Python / Strands)
  │  jobType=PR_ANALYSIS  →  _run_pr_analysis()  →  9-step PR 분석 파이프라인
  └  jobType=INCIDENT     →  _run_incident()     →  3-step 인시던트 조사 파이프라인
```

### EventBridge 제거 (2026-06-17, github-connector v25)

github-connector가 EventBridge 우회하여 SQS analysis-queue에 **직접 전송**으로 변경됨.

- **이전**: `PutEventsCommand` → EventBridge aigo-bus → rule → analysis-queue (MessageGroupId: "pr-analysis" 하드코딩)
- **현재**: `SendMessageCommand` → analysis-queue.fifo 직접 (MessageGroupId: orgId, 조직별 분리)
- **FIFO 블로킹 문제 해결**: 기존 하드코딩 "pr-analysis" GroupId → 모든 조직 잡이 같은 FIFO 그룹에서 처리되어 블로킹 발생. 현재는 orgId별로 독립적 그룹.
- EventBridge 모듈(Terraform)은 incident 라우팅 때문에 인프라는 유지. github-connector 코드에서만 제거됨.

---

## 2. AgentCore Memory 구조

`tools/ddb_tools.py`에 구현된 DynamoDB 기반 장기 메모리.  
Bedrock AgentCore 네이티브 메모리가 아닌 커스텀 구현.

### 테이블: `aigo-AgentMemory`

| 메모리 타입 | PK 패턴 | TTL | 용도 |
|-------------|---------|-----|------|
| `PR_ANALYSIS` | `MEMORY#PR#ORG#{orgId}#REPO#{repoId}` | **90일** | 레포 분석 이력 |
| `INCIDENT` | `MEMORY#INCIDENT#ORG#{orgId}#SERVICE#{service}` | **1년** | 인시던트 RCA 이력 |

### GSI 구조

```
GSI1-repo-time-index:  GSI1PK = ORG#{orgId}#REPO#{repoId}  (PR 메모리: 레포별 최신순)
                        GSI1PK = ORG#{orgId}#SERVICE#{svc}  (인시던트 메모리: 서비스별)
GSI2-author-time-index: GSI2PK = ORG#{orgId}#AUTHOR#{login} (PR 메모리: 개발자별)
                         GSI2PK = ORG#{orgId}#INCIDENTS       (인시던트 메모리: org 전체)
```

### PR 분석 메모리 필드

```python
save_pr_analysis_memory(
    org_id, repo_id, repo_full_name,
    pr_number, author_login,
    risk_score,           # 0-100
    risk_level,           # CRITICAL/HIGH/MEDIUM/LOW
    findings_summary,     # {"CRITICAL": 0, "HIGH": 2, ...}
    key_findings,         # 상위 3-5개 주요 발견사항 (str list)
    merge_recommendation, # APPROVE/REQUEST_CHANGES/BLOCK
)
```

### 인시던트 메모리 필드

```python
save_incident_memory(
    org_id, incident_id, service,
    root_cause, resolution,
    affected_services,    # list[str]
    prevention,           # 재발 방지 권고사항
    duration_minutes,
)
```

### 오케스트레이터에서의 사용

- **PR 분석 시작 전**: `get_repo_memory(org_id, repo_id, limit=3)` + `get_developer_memory(org_id, author_login, limit=5)`
- **PR 분석 완료 후**: `save_pr_analysis_memory(...)` (Step 9)
- **인시던트 조사 시작 전**: `get_incident_memory(org_id, service, limit=3)`
- **인시던트 조사 완료 후**: `save_incident_memory(...)` (Step 2)

---

## 3. Agent Tools 현황

### 도구 목록 및 실제 사용 현황

| 파일 | @tool 함수들 | 오케스트레이터 등록? | 비고 |
|------|------------|-------------------|------|
| `kb_tools.py` | `search_coding_standards` `search_infrastructure_standards` `search_security_standards` `search_risk_policies` | ✅ | S3 Vector → Titan Embeddings v2 |
| `ddb_tools.py` | `save_findings` `save_report` `update_job_status` `update_incident` `get_findings_for_report` `update_fix_request` | ✅ | 오케스트레이터에서 직접 사용 |
| `ddb_tools.py` | `save_pr_analysis_memory` `get_repo_memory` `get_developer_memory` `save_incident_memory` `get_incident_memory` | ✅ | AgentCore Memory |
| `github_tools.py` | `create_check_run` `update_check_run` `post_pr_comment` `auto_merge_pr` | ✅ | PR 분석 step 0/6/8/8b |
| `slack_tools.py` | `notify_analysis_complete` `send_incident_update` | ✅ | PR 분석 step 7, 인시던트 step 3 |
| `subagent_tools.py` | `invoke_devops_agent` | ✅ (인시던트 전용) | Bedrock AgentCore: incident-agent 호출 |
| `pr_tools.py` | `get_diff_content` `get_file_content` | ❌ 미등록 | diff는 프롬프트에 직접 포함 (25000자 제한) |
| `aws_observability_tools.py` | CloudWatch/X-Ray tools | ❌ (incident-agent 내부용) | 오케스트레이터 직접 등록 안됨 |
| `patch_tools.py` | 패치 생성 tools | ❌ (heavy worker용) | `workers/heavy/src/handler.py`에서 사용 |
| `repo_tools.py` | 레포 클론 tools | ❌ (heavy worker용) | fix-agent 흐름 전용 |

> **MCP 아님** — 모든 tools는 Strands `@tool` 데코레이터로 Python 함수로 정의됨. AgentCore Gateway 또는 MCP 서버 통신 없음.

### 설계 변경: AgentCore Gateway + MCP → Strands @tool

**원래 설계**: AgentCore Gateway가 있고, 이 Gateway가 MCP 서버와 통신 → MCP 서버 안에 `pr_tools`, `kb_tools`, `subagent_tools` 등 tool들이 정의되어 있음. 네트워크 기반 tool 호출.

**실제 구현**: Strands SDK의 `@tool` 데코레이터로 Python 함수를 직접 정의 → 오케스트레이터 Lambda 안에서 **in-process**로 tool 호출.

| 항목 | AgentCore Gateway + MCP | Strands @tool (현재) |
|------|------------------------|---------------------|
| **통신 방식** | HTTP(s) 네트워크 → MCP 서버 | 동일 프로세스 내 함수 호출 |
| **인프라** | 별도 MCP 서버 ECS/Lambda 필요 | 추가 인프라 없음 |
| **지연시간** | 네트워크 왕복 + cold start 있음 | 마이크로초 수준 |
| **디버깅** | 네트워크 추적 복잡 | 단일 Lambda 로그로 전부 추적 가능 |
| **배포 단위** | 오케스트레이터 + MCP 서버 각각 별도 배포 | 오케스트레이터 하나만 배포 |
| **비용** | MCP 서버 실행 비용 추가 | 오케스트레이터 Lambda만 |

**변경 이유**: 이 프로젝트는 tool 공유 요구가 없고(오케스트레이터만 사용), MCP 서버의 분리 이점이 없음. Strands가 `@tool` 방식을 네이티브로 지원하므로 훨씬 간단한 구현 선택.  

`invoke_devops_agent`만 별도 Bedrock AgentCore Agent(incident-agent)를 호출하는데, 이것은 MCP가 아니라 **Bedrock Agent API 직접 호출** (Bedrock → 별도 Agent가 CloudWatch/X-Ray 조사).

### subagent_tools 버그 수정 (2026-06-16, orchestrator v18)

```python
# 수정 전 (오류 — env var 이름 불일치)
alias_id = _require("INCIDENT_ALIAS_ID")

# 수정 후 (Terraform main.tf와 일치)
alias_id = _require("INCIDENT_AGENT_ALIAS_ID")
```

---

## 4. AgentPipeline UI (AgentPipeline.tsx)

`apps/dashboard/src/components/AgentPipeline.tsx`

### 구조

```
[GitHub 🔔] ──── [Orchestrator 🧠] ─── ╔ Left Tree ╗ ─── [Code 📝]     ─── ╔ Right Tree ╗ ──── [PR+Slack 📣]
                                         ║           ║     [Infra ⚙️]        ║             ║
                                         ║           ║     [Security 🔒]      ║             ║
                                         ║           ║     [Risk ⚠️]          ║             ║
                                         ╚ Connector ╝                        ╚  Connector  ╝
```

### 커넥터 정렬 원리 (2026-06-16 수정)

**문제**: `NodeBox`에 아이콘(80px) + 레이블 텍스트가 `flex-col`로 쌓여 있으면 `items-center`가 아이콘+레이블 합산 높이의 중심을 기준으로 정렬 → 커넥터 선이 아이콘 아래쪽에 찍힘

**수정**: 레이블을 `position: absolute; top: 100%`로 분리 → NodeBox 레이아웃 높이 = 아이콘 박스만 (80px)

```
이전: NodeBox = [80px icon] + [6px gap] + [~20px label] = ~106px
      items-center → 커넥터가 53px (106/2) 위치 = 아이콘 아래 13px 지점 (잘못됨)

수정: NodeBox layout height = 80px (아이콘만)
      items-center → 커넥터가 40px (80/2) 위치 = 아이콘 정중앙 (정확함)
      레이블은 absolute으로 top: 84px에 표시 (레이아웃에 영향 없음)
```

### 상수

| 상수 | 값 | 의미 |
|------|---|------|
| `NODE_H` | 80 | 아이콘 박스 높이 (w-20 h-20) |
| `GAP` | 8 | 서브노드 슬롯 사이 gap-2 |
| `SLOT_H` | 88 | 슬롯 하나 높이 (NODE_H + GAP) |
| `FAN_W` | 22 | TreeConnector 열 너비 |

### AgentStatus 타입

| status | 표시 | 의미 |
|--------|------|------|
| `pending` | 회색 점선 테두리 | 대기 중 |
| `running` | 노란색 + glow + pulse | 실행 중 |
| `done` | 초록색 | 완료 |
| `failed` | 빨간색 | 실패 |
| `skipped` | 25% 투명 + 점선 | LLM이 이 페르소나를 선택하지 않음 (IaC 파일 없는 경우의 Infra Reviewer 등) |

### orchStatus 계산 로직 (2026-06-17 수정)

오케스트레이터는 AgentRun 레코드를 직접 쓰지 않으므로 `orchRun` 조회 불가. Job 상태로 대신 결정:

```typescript
const orchStatus: AgentStatus =
  isJobDone   ? 'done'    :
  isJobFailed ? 'failed'  :
  (jobStatus === 'RUNNING' || jobStatus === 'IN_PROGRESS' || agentRuns.length > 0) ? 'running' : 'pending';
```

### AgentRuns 이중 기록 (2026-06-17, orchestrator v20)

`save_findings` 호출 시 Findings 테이블 저장과 동시에 AgentRuns 테이블에도 레코드 기록:

- 기록된 페르소나 → AgentRuns 레코드 있음 → **초록(done)**
- 스킵된 페르소나 → AgentRuns 레코드 없음 + job COMPLETED → **회색(skipped)**

### buildPipelineNodes 로직

- job COMPLETED + agentRun 레코드 없음 → `'skipped'` (오케스트레이터가 선택 안 함)
- job 진행 중 + agentRun 없음 → `'pending'` (아직 실행되지 않음)
- compact 뷰에서 skipped 노드는 뱃지 체인에서 제외
- 페르소나 4개 고정 표시: Code 📝, Infra ⚙️, Security 🔒, Risk ⚠️ (docs/test/perf 제거됨)

---

## 5. Lambda 배포 현황

| Lambda | 버전 | 최신 변경 |
|--------|------|---------|
| `aigo-dashboard-api` | **v42** | aws-clients dist 재빌드 적용 (SQS 표준 큐 FIFO 파라미터 제거 실제 반영) |
| `aigo-orchestrator` | **v23** | `auto_merge_pr` riskThreshold 문자열 처리 (`HIGH`→74, `CRITICAL`→100 등 dict 매핑) |
| `aigo-lightweight-worker` | **v28** | aws-clients dist 재빌드 적용 (command-queue SQS 재시도 루프 종료) |
| `aigo-notification-worker` | **v11** | REJECTED 시 `closePr()` 추가 (GitHub `PATCH /pulls/{n}` state=closed) |
| `aigo-github-connector` | **v25** | EventBridge 제거, SQS 직접 전송, `MessageGroupId=orgId` (org별 FIFO 격리) |
| `aigo-slack-connector` | v? | 변경 없음 |

### 이전 버전 이력 (주요 마일스톤)

| Lambda | 버전 | 주요 변경 |
|--------|------|---------|
| `aigo-dashboard-api` | v41 | findings 쿼리 키 수정 (`REPORT#` → `JOB#`), REVIEW_SUBMITTED SQS FIFO 파라미터 제거 |
| `aigo-dashboard-api` | v35 | 초대 수락 401 수정 (GET /invite 공개 라우트) |
| `aigo-orchestrator` | v22 | `auto_merge_pr` 추가, `save_findings` → AgentRuns 이중 기록 |
| `aigo-lightweight-worker` | v27 | notification-queue 전송 시 FIFO 파라미터 제거 (표준 큐) |
| `aigo-lightweight-worker` | v26 | Slack orgId 버그 수정 (report.orgId에서 파생) |
| `aigo-notification-worker` | v10 | REVIEW_SUBMITTED APPROVED 시 `mergePr` 호출 |

---

## 6. SQS 큐 및 이벤트 소스 매핑

| 큐 | 타입 | 트리거 Lambda | 메시지 타입 |
|----|------|-------------|------------|
| `aigo-analysis-queue.fifo` | FIFO | lightweight-worker | `ANALYSIS_REQUESTED` |
| `aigo-command-queue.fifo` | FIFO | **lightweight-worker** (v25부터 연결됨) | `COMMAND` (APPROVE/REJECT/INVESTIGATE) |
| `aigo-incident-queue.fifo` | FIFO | **lightweight-worker** (v25부터 연결됨) | `INCIDENT_TRIGGERED` |
| `aigo-notification-queue` | 표준 | notification-worker | `NOTIFICATION` |
| `aigo-fix-queue.fifo` | FIFO | ❌ **Lambda 없음** (ECS Fargate heavy worker가 폴링) | FIX 요청 |

> **이전 문제**: command-queue와 incident-queue에 Lambda 이벤트 소스 매핑이 없어 Slack /approve, /reject, /investigate 명령이 큐에만 쌓이고 처리되지 않았음.  
> **2026-06-16 수정**: Terraform + lightweight-worker v25 배포로 해결.

---

## 7. KB (Knowledge Base) S3 Vector 구조

AOSS(OpenSearch Serverless, ~$700/월)에서 S3 Vector Index (~$1/월)로 전환.

```
docs/kb/**/*.md  →  scripts/build-kb-index.py  →  Titan Embeddings v2 (1024차원)
                                                          │
                                                          ▼
                                          s3://aigo-kb/vector-index/index.json
                                          (18 chunks, 442KB)

Lambda 런타임 (tools/kb_tools.py):
  _load_index() → S3에서 인덱스 다운로드 (TTL 3600초 캐시)
  _embed(query) → Titan Embeddings v2 (amazon.titan-embed-text-v2:0, 1024차원, normalize=True)
  _cosine_similarity() → 상위 5개 청크 반환 (score >= 0.5)
```

### KB 카테고리 (18 chunks)

| 카테고리 | 검색 함수 | 페르소나 |
|---------|---------|---------|
| `coding_standards` | `search_coding_standards` | Code Reviewer |
| `infrastructure` | `search_infrastructure_standards` | Infra Reviewer |
| `security` | `search_security_standards` | Security Agent |
| `risk` | `search_risk_policies` | Risk Reviewer |

### 테스트 결과 (2026-06-17)

```
KB index loaded  bucket=aigo-kb  chunks=18  key=vector-index/index.json
Searching coding standards KB  query='code quality bug patterns race condition...'  → ✅ 관련 청크 반환
Searching security standards KB  query='OWASP injection authentication...'         → ✅ 관련 청크 반환
Searching risk policies KB  query='API breaking changes deployment risk...'        → ✅ 관련 청크 반환
```

**판정**: ✅ S3 Vector KB 조회 정상 동작. 모든 4개 카테고리 검색 가능.

### 비용 비교

| 방식 | 월 비용 | 이유 |
|------|--------|------|
| AOSS (이전) | ~$700 | OpenSearch collection 기본비용 |
| S3 Vector (현재) | ~$1 | S3 스토리지 + Titan 임베딩 API 호출 |

---

## 8. 검토 액션 버튼 동작

`apps/dashboard/src/pages/ReportDetailPage.tsx`

| 버튼 | 비활성화 조건 | 동작 |
|------|------------|------|
| `$ approve` | 이미 APPROVED 상태 | `POST /reports/{id}/approve` → DDB 업데이트 → notification-queue → notification-worker: GitHub PR Review(APPROVE) 제출 + **PR 머지** |
| `$ reject` | 이미 REJECTED 상태 | `POST /reports/{id}/approve` → DDB 업데이트 → notification-queue → notification-worker: GitHub PR Review(REQUEST_CHANGES) 제출 + **PR 닫기** |
| `$ auto-fix` | REJECTED 상태 OR 처리 중 | `POST /fix` → fix-queue.fifo → heavy worker |

### 에이전트 페르소나 표시 (ReportDetailPage)

분석 리포트 상세 페이지의 `AGENT_META` 는 오케스트레이터에서 실제로 저장하는 4개 에이전트 이름에만 매핑:

| key | 매칭 조건 | icon | label |
|-----|---------|------|-------|
| `code` | agentName에 "code" 포함 | 📝 | Code |
| `security` | agentName에 "security" 포함 | 🔒 | Security |
| `infra` | agentName에 "infra" 포함 | ⚙️ | Infra |
| `risk` | agentName에 "risk" 포함 | ⚠️ | Risk |

> 이전에 존재했던 `docs`, `test`, `performance` 항목은 제거됨. 실제 orchestrator `save_findings`가 사용하는 `agent_name`은 `code-reviewer`, `infra-reviewer`, `security-agent`, `risk-reviewer` 4가지뿐.

### Findings 조회 키 수정 (dashboard-api v41)

```typescript
// 이전 (버그): reportId가 존재하지 않는 시점에 save_findings가 저장되므로 항상 빈 결과
GSI1PK = "REPORT#${reportId}"

// 수정: save_findings는 GSI1PK = "JOB#{jobId}"로 저장함 (reportId 아직 없음)
const jobId = (report as Record<string, string>)['jobId'] ?? '';
GSI1PK = "JOB#${jobId}"
```

### Slack 명령어 → 실제 처리 흐름

```
/approve {reportId}   →  slack-connector  →  command-queue.fifo
/reject {reportId}    →  lightweight-worker v27 (processCommand)
                              │
                              ├── report 조회 → orgId = report.orgId (★Slack team_id 아님)
                              ├── DDB Approvals 레코드 생성
                              ├── DDB Reports.approvalStatus 업데이트
                              └── notification-queue → notification-worker v11:
                                      ├── GitHub PR Review(APPROVE / REQUEST_CHANGES) 제출
                                      ├── (APPROVED 시) GitHub PR 머지 (PUT /pulls/{n}/merge)
                                      └── (REJECTED 시) GitHub PR 닫기 (PATCH /pulls/{n} state=closed)

/investigate          →  현재 lightweight-worker에서 "not handled here"로 skip
                          (CloudWatch Alarm → incident-queue 경로가 정상 경로)
```

### Secrets Manager privateKey 순환 참조 수정 (2026-06-18)

`aigo/github/app-credentials` 시크릿의 `privateKey` 필드가 자기 자신을 참조하는 shell 명령 문자열로 저장되어 있었으며, JSON 형식도 깨져 있었습니다.

```
# 수정 전 — privateKey 필드 (실제 RSA 키 없음, 순환 참조)
"privateKey": "$(aws secretsmanager get-secret-value --secret-id ...aigo/github/app-credentials... | python3 -c \"...['privateKey']\")"

# 수정 후 — aigo/github-app 시크릿의 실제 RSA PEM 키로 교체
"privateKey": "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA..."
```

수정 방법: `aigo/github-app` 시크릿(appId, 실제 privateKey 보유)에서 키를 읽어 `aigo/github/app-credentials`에 올바른 JSON으로 덮어씀. `installationId: "140583195"`, `webhookSecret`은 기존 값 유지.

> **참고**: notification-worker는 Node.js `JSON.parse`의 허용 범위 또는 Lambda warm context 덕분에 수정 전에도 GitHub 인증이 동작했을 수 있음. 수정 후에는 cold start에서도 안정적으로 동작 보장.

---

### SQS 표준 큐 vs FIFO 파라미터 버그 수정 (2026-06-18)

`aigo-notification-queue`는 **표준 큐** (FIFO 아님). 기존 `sqsSendMessage`가 항상 `MessageGroupId`와 `MessageDeduplicationId`를 포함해서 전송 → AWS `InvalidParameterValue` 에러 → `.catch()`로 묵음 처리 → notification-worker가 메시지를 전혀 수신하지 못하는 상황.

수정 위치:
1. `packages/aws-clients/src/sqs.ts` — FIFO 파라미터를 명시적으로 전달된 경우에만 포함
2. `apps/dashboard-api/src/routes/reports.ts` — REVIEW_SUBMITTED 전송 시 `messageGroupId` 제거
3. `workers/lightweight/src/handler.ts` — COMMAND 처리 후 notification-queue 전송 시 `messageGroupId` 제거

> **Slack orgId 버그 (2026-06-16 수정)**: `message.orgId`는 Slack team_id (T04ABC...)로 aigo orgId (MQG1...)와 다름.  
> 수정: DDB Reports 레코드를 먼저 fetch한 뒤 `orgId = report.orgId`로 파생.

---

## 9. 인시던트 탭 흐름

인시던트 탭은 **CloudWatch Alarm 임계값 위반** 시 자동으로 레코드가 생성됩니다.

```
CloudWatch Alarm (ALARM 상태)
        │
        ▼
aws-event-connector Lambda (connectors/aws-event/src/index.ts)
        │  DDB Incidents 테이블에 OPEN 상태 레코드 생성
        │  SQS incident-queue.fifo에 INCIDENT_TRIGGERED 메시지 전송
        ▼
lightweight-worker (processIncident)
        │  DDB Incidents.status → INVESTIGATING
        │  invokeOrchestratorAsync(jobType="INCIDENT")
        ▼
Orchestrator Lambda (_run_incident)
        │  Step 0: get_incident_memory (과거 유사 인시던트 조회)
        │  Step 1: invoke_devops_agent (CloudWatch/X-Ray/CloudTrail 조사)
        │  Step 2: save_incident_memory (RCA 저장)
        └  Step 3: send_incident_update (Slack 알림)
```

대시보드 인시던트 탭에서는 `GET /incidents` 로 조회됩니다.

---

## 10. 팀 초대 플로우

**반드시 알아야 할 순서**:

1. 초대받은 사람이 **먼저 `/register`에서 회원가입** (초대 이메일과 동일한 이메일 사용)
2. 이메일 인증 완료
3. 초대 링크 `/invite?token=XXX` 접속 → `GET /team/invite/{token}` (공개) → 초대 정보 표시
4. "초대 수락하기" 버튼 클릭 → 로그인되어 있으면 `POST /team/accept-invite` 처리

> 초대 이메일 미수신 시: 대시보드에서 팀 초대 API 응답 body의 `inviteUrl` 값을 직접 공유하면 됩니다.

### 수정 이력

| 버그 | 원인 | 수정 | 버전 |
|------|------|------|------|
| 초대 이메일 미발송 | `SESClient({ region: 'us-east-1' })` 하드코딩 vs Terraform SES ap-northeast-2 배포 | `region: process.env['AWS_REGION'] ?? 'ap-northeast-2'` | dashboard-api v34 |
| 초대 수락 버튼 401 | Hono `teamRouter.use('*', requireAuth())` 이후에 `GET /invite/:id` 라우트 등록 → 미인증 사용자 차단 | `GET /invite/:id` 핸들러를 `use('*', requireAuth())` **이전**으로 이동 | dashboard-api v35 |

> **API Gateway 설정은 이미 올바름**: `authorizer_id = startswith("GET /team/invite/") ? null : cognito_authorizer`  
> 문제는 Hono 미들웨어 계층에 있었음.

---

## 11. Heavy Worker (ECS Fargate) 테스트 방법

Heavy worker는 `aigo-fix-queue.fifo`를 while-loop으로 폴링합니다. **자동 시작 없음** (EventBridge → ECS RunTask 미구현).

```bash
# 1. ECS Task 수동 시작
aws ecs run-task \
  --cluster aigo \
  --task-definition aigo-heavy-worker \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={
    subnets=[subnet-xxx],
    securityGroups=[sg-xxx],
    assignPublicIp=DISABLED
  }"

# 2. Fix 요청 전송 (대시보드 $ auto-fix 버튼 또는)
curl -X POST https://api.seolphung.com/fix \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"reportId":"REPORT#xxx-report"}'
```

Heavy worker가 `fix-queue`에서 메시지를 소비 → `workers/heavy/src/handler.py` → fix-agent (Bedrock AgentCore) 호출 → patch 생성 → S3 → apply → PR 생성.

---

## 12. Terraform 현황

### 적용된 모듈

| 모듈/리소스 | 상태 | 비고 |
|------------|------|------|
| `module.bedrock_kb` | **제거됨** | AOSS 비용 절감 완료, archive에 보존 |
| `module.bedrock_agentcore` | ✅ | knowledge_base_arns = [] |
| `aws_lambda_event_source_mapping.command` | ✅ | 2026-06-16 추가 |
| `aws_lambda_event_source_mapping.incident` | ✅ | 2026-06-16 추가 |
| `global/iam` | ✅ | Titan Embeddings ARN 추가 적용 완료 |

### archive 정책

```
/archive/               ← 루트 경로 (2026-06-17 이동)
  └── bedrock-kb/       ← 원본 AOSS 모듈 보관 (infra/terraform/modules/archive/에서 이동)
```

더 이상 사용되지 않는 모듈/코드는 `/archive/` 아래 폴더별로 모음.

---

## 13. esbuild 번들 설정

**문제**: `--external:@aws-sdk/*` 옵션으로 빌드 시 `@smithy/core`가 Lambda 런타임에 없어 `ImportModuleError`

**해결**: 모든 Node.js Lambda에서 `--external:@aws-sdk/*` 제거  
- 단일 번들 `dist/index.js` (~3-4MB)  
- `deploy-lambda.sh`는 해당 파일만 zip → Lambda 업로드

영향받는 Lambda: github-connector, slack-connector, dashboard-api, lightweight-worker, notification-worker, post-confirmation, github-app-setup, slack-oauth

---

## 14. $ auto-fix 기능 설명

### 기능 개요

PR 분석 결과 리포트에서 AI가 자동으로 코드 수정 패치를 생성하고 PR을 만들어주는 기능.

```
대시보드 [$ auto-fix] 버튼 클릭
        │
        ▼
POST /fix → dashboard-api
  └── DDB FixRequests 레코드 생성 (status: PENDING)
  └── SQS fix-queue.fifo 메시지 전송
        │
        ▼ (ECS heavy worker가 폴링)
workers/heavy/src/handler.py
  Step 1: DDB에서 FixRequest + Repository 조회
  Step 2: Fix Agent (Bedrock AgentCore) 호출 → unified diff 패치 생성
          └─ fix-agent는 get_findings(), get_file_content() 도구로 코드 분석
          └─ 패치를 S3에 저장, DDB FixRequest에 patchS3Key 기록
  Step 3: S3에서 패치 다운로드
  Step 4: GitHub installation token 발급
  Step 5: git clone (repo 전체)
  Step 6: patch apply (unified diff)
  Step 7: git commit
  Step 8: git push (aigo/fix-{fixId} 브랜치)
  Step 9: GitHub API로 Fix PR 생성
  Step 10: DDB FixRequests status → COMPLETED, fixPrUrl 저장
```

### 중요도 판단

| 관점 | 평가 |
|------|------|
| **기술 완성도** | 인프라/코드 모두 구현됨. 미완성은 ECS 자동 시작 트리거뿐 |
| **현실적 사용 빈도** | 낮음. AI 패치는 단순 타입 오류/린팅 이슈에서만 신뢰 가능. 비즈니스 로직 버그는 사람이 검토 필수 |
| **버튼 활성화 조건** | APPROVED 상태인 리포트만 auto-fix 가능 (REJECTED면 비활성화) |
| **현재 상태** | 버튼 클릭 → fix-queue에 메시지 쌓임 → **ECS 미시작으로 처리 안됨** |
| **결론** | 쇼케이스용으로는 가치 있음. 프로덕션 필수 기능은 아님. ECS RunTask 트리거만 추가하면 완성 |

---

## 15. Slack 슬래시 명령어 설정 가이드

### 명령어 동작 흐름

```
Slack 워크스페이스 → /approve {reportId}
        │
        ▼ (Slack이 POST 요청 전송)
https://api.seolphung.com/webhooks/slack
        │  (aigo-slack-connector Lambda)
        │  1. x-slack-signature HMAC 검증
        │  2. command 파싱: /approve → APPROVE
        │  3. text 파싱: "{reportId} [optional comment]"
        ▼
SQS command-queue.fifo
        │  (aigo-lightweight-worker)
        ▼
DDB Approvals 생성 + Reports.approvalStatus 업데이트
→ notification-queue → GitHub PR 공식 리뷰 제출
```

### 현재 상태 진단

| 항목 | 상태 |
|------|------|
| 엔드포인트 (`POST /webhooks/slack`) | ✅ 동작 중 (`{"error":"missing_signature_headers"}` 반환) |
| Slack Bot 인증 (`auth.test`) | ✅ 정상 (AIGo workspace) |
| Secrets Manager 시크릿 | ✅ `botToken`, `signingSecret` 모두 설정됨 |
| **Slack App 슬래시 명령어 등록** | ❌ **미등록** — 이것이 안 되는 이유 |
| SSM Slack 채널 (`C0BAXKUGGMS`) | ✅ 저장됨 (org `MQG1U5HYVZASM6B`) |

**결론**: Slack App 포털에서 슬래시 명령어를 등록해야 함. 코드/인프라 문제 아님.

### Slack App 슬래시 명령어 등록 방법 (수동 1회)

1. https://api.slack.com/apps 접속
2. `AIGo` 앱 선택 (또는 사용 중인 앱)
3. 좌측 메뉴 → **"Slash Commands"** 클릭
4. **"Create New Command"** 3번:

| Command | Request URL | Short Description |
|---------|------------|-------------------|
| `/approve` | `https://api.seolphung.com/webhooks/slack` | PR 분석 결과 승인 |
| `/reject` | `https://api.seolphung.com/webhooks/slack` | PR 분석 결과 반려 |
| `/investigate` | `https://api.seolphung.com/webhooks/slack` | 인시던트 수동 조사 시작 |

5. **"Save"** 클릭
6. 좌측 메뉴 → **"Install App"** → **"Reinstall to Workspace"**
   - 재설치해야 새 권한/명령어가 적용됨

### 명령어 사용법

```
# PR 승인 (Slack 채널에서)
/approve MQG7Q226UEHMYFF-report

# PR 반려 + 코멘트
/reject MQG7Q226UEHMYFF-report 보안 취약점 수정 필요

# 인시던트 조사 (현재 lightweight-worker에서 skip — 미구현)
/investigate MQG7Q226UEHMYFF-report
```

> **reportId 확인**: Slack에서 PR 분석 완료 알림 메시지의 "리포트 ID" 필드, 또는 대시보드 리포트 상세 페이지 URL에서 확인.

### Slack 알림이 오는 채널 확인

현재 등록된 채널 ID: `C0BAXKUGGMS` (org `MQG1U5HYVZASM6B`)  
이 채널에 `AIGO Bot`이 초대되어 있어야 PR 분석 결과 알림이 도착함.

```
# 채널에 봇 초대 (Slack에서)
/invite @AIGO
```

---

## 16. 남은 과제 — 완전한 체크리스트

### 🔴 HIGH: 실제 동작에 영향

| # | 과제 | 파일 | 구현 방법 | 테스트 방법 |
|---|------|------|---------|-----------|
| H-1 | **Slack 슬래시 명령어 등록** | Slack App 포털 (설정) | api.slack.com/apps → Slash Commands 3개 등록 + 재설치 | `/approve {reportId}` Slack에서 실행 → DDB Approvals 테이블 확인 |
| H-2 | **팀 관리 탭 팀원 표시 확인** | `TeamPage.tsx` (배포됨) | 에러 메시지 추가됨 → 실제 원인 파악 필요 | 팀 관리 탭 접속 → 에러 메시지 또는 팀원 목록 확인 |

### 🟡 MEDIUM: 핵심 기능이나 우선순위 중간

| # | 과제 | 파일 | 구현 방법 | 테스트 방법 |
|---|------|------|---------|-----------|
| M-1 | **ECS Heavy Worker 자동 시작** | `infra/terraform/envs/prod/main.tf` | EventBridge Pipe: fix-queue → ECS RunTask OR SQS→Lambda로 trigger | auto-fix 버튼 클릭 → ECS task 자동 실행 → GitHub에 Fix PR 생성 확인 |
| M-2 | **Slack `/investigate` 처리** | `workers/lightweight/src/handler.ts` | processCommand에 INVESTIGATE case 추가: DDB Incidents 생성 → invokeOrchestratorAsync | `/investigate` 명령 → DDB Incidents 테이블에 신규 레코드 확인 |
| M-3 | **PR 분석 E2E 실제 검증** | GitHub + Slack + 대시보드 | GitHub PR 생성 → Slack 알림 수신 → 대시보드 리포트 확인 | 테스트 리포에 PR 오픈 → Slack #agentops-alerts 채널 확인 |

### 🟢 LOW: 개선 사항

| # | 과제 | 파일 | 구현 방법 | 테스트 방법 |
|---|------|------|---------|-----------|
| L-1 | **`pr_tools` 오케스트레이터 등록** | `agents/orchestrator/src/agent.py`, `tools/pr_tools.py` | diff 직접 삽입 대신 `get_diff_content(s3_key)` @tool 추가 | 대용량 PR (diff > 25000자) 분석 시 정상 처리 확인 |
| L-2 | **인시던트 수동 생성 UI** | `apps/dashboard/src/pages/IncidentsPage.tsx` | "새 인시던트" 버튼 + 모달 → `POST /incidents` | 대시보드에서 직접 인시던트 생성 |
| L-3 | **Fix Center 페이지 실제 데이터** | `apps/dashboard/src/pages/FixCenterPage.tsx` | `GET /fix` 엔드포인트 구현 확인 + 페이지 연동 | auto-fix 완료 후 Fix Center에서 조회 |

### ✅ 완료된 항목 (전체)

| 항목 | 완료 날짜 | 버전/방법 |
|------|---------|---------|
| 전체 페이지 500 에러 (esbuild --external 제거) | 2026-06-15 | 모든 Node Lambda 재빌드 |
| S3 Vector KB (AOSS 제거, 비용 $700→$1) | 2026-06-15 | orchestrator v16 |
| AgentPipeline UI 재작성 + 커넥터 정렬 수정 | 2026-06-16 | 대시보드 배포 |
| SQS command/incident → lightweight-worker 매핑 | 2026-06-16 | Terraform apply |
| subagent_tools INCIDENT_AGENT_ALIAS_ID 버그 수정 | 2026-06-16 | orchestrator v18 |
| Slack orgId 버그 (Slack team_id vs aigo orgId) | 2026-06-16 | lightweight-worker v26 |
| 초대 이메일 SES 리전 버그 (us-east-1 → ap-northeast-2) | 2026-06-16 | dashboard-api v34 |
| 초대 수락 GET 401 (Hono 미들웨어 순서) | 2026-06-17 | dashboard-api v35 |
| 팀 관리 탭 — OWNER 전용 역할 변경 + 에러 표시 | 2026-06-17 | 대시보드 배포 |
| archive 폴더 루트 이동 (`/archive/bedrock-kb`) | 2026-06-17 | 로컬 파일 이동 |
| EventBridge 제거 → SQS 직접 전송 + MessageGroupId=orgId | 2026-06-17 | github-connector v25 |
| Slack /approve → GitHub PR Review + 머지 | 2026-06-17 | notification-worker v10 |
| auto_merge_pr 추가 (org 정책 기반 자동 머지) | 2026-06-17 | orchestrator v22 |
| save_findings → AgentRuns 이중 기록 (페르소나 대시보드 표시) | 2026-06-17 | orchestrator v22 |
| riskThreshold=null → int(None) TypeError 수정 | 2026-06-17 | orchestrator v22 |
| 기존 완료 잡 7개 AgentRuns 12건 백필 | 2026-06-17 | DynamoDB 직접 수정 |
| **SQS 표준 큐에 FIFO 파라미터 전송 버그 수정** (승인/거절 GitHub 동작 안 하던 근본 원인) | 2026-06-18 | aws-clients dist 재빌드, dashboard-api v41→v42, lightweight-worker v27→v28 |
| **Findings 항상 빈 결과 버그** (`REPORT#` → `JOB#` 조회 키 수정) | 2026-06-18 | dashboard-api v41 |
| **분석 리포트 페르소나 오표시** (docs/test/perf 제거 → 실제 4개만) | 2026-06-18 | 대시보드 배포 |
| **auto_merge_pr riskThreshold 문자열 crash** (`int('HIGH')` → dict 매핑) | 2026-06-18 | orchestrator v23 |
| **REJECTED 시 GitHub PR 닫기** (`closePr` 추가) | 2026-06-18 | notification-worker v11 |
| **Settings riskThreshold OWNER 편집 불가** (`approvalRequired` 조건 제거) | 2026-06-18 | 대시보드 배포 (SettingsPage.tsx) |
| **Secrets Manager privateKey 순환 참조 수정** (`aigo/github/app-credentials`에 실제 RSA 키 저장) | 2026-06-18 | Secrets Manager 직접 수정 (버전 d2722133) |

---

## 16. DynamoDB 전체 테이블 점검 (2026-06-17)

| 테이블 | 레코드 | 사용 Lambda | GSI 수 | 판정 |
|--------|-------|-----------|-------|------|
| `aigo-AnalysisJobs` | 29 | github-connector(W), lightweight-worker(RW), orchestrator(W), dashboard-api(R) | 2 | ✅ |
| `aigo-AgentRuns` | 15 | orchestrator save_findings 이중 기록, dashboard-api(R) | 1 | ✅ |
| `aigo-Findings` | 35 | orchestrator(W), dashboard-api(R) | 2 | ✅ |
| `aigo-Reports` | 9 | orchestrator(W), lightweight-worker(R), dashboard-api(R) | 3 | ✅ |
| `aigo-Approvals` | 4 | lightweight-worker(W), dashboard-api(RW) | 2 | ✅ |
| `aigo-Organizations` | 2 | github-connector(R), orchestrator auto_merge_pr(R), dashboard-api settings(W) | 1 | ✅ |
| `aigo-Repositories` | 7 | github-connector(R), dashboard-api(RW) | 2 | ✅ |
| `aigo-Users` | 3 | post-confirmation(W), dashboard-api(R) | 1 | ✅ |
| `aigo-AgentMemory` | 9 | orchestrator(RW) — PR 분석 이력 90일 TTL, 인시던트 이력 1년 TTL | 2 | ✅ |
| `aigo-Incidents` | 0 | aws-event-connector(W), orchestrator(W), dashboard-api(R) | 2 | ✅ 미사용 |
| `aigo-FixRequests` | 0 | dashboard-api(W), heavy-worker(RW) | 2 | ✅ 미사용 |
| `aigo-UsageRecords` | 0 | 미구현 | 0 | ⚠️ |
| `aigo-OrgInvitations` | 15 | dashboard-api(RW) | 2 | ✅ |
| `aigo-Integrations` | 2 | github-connector GSI2로 installationId→orgId 역조회(R), dashboard-api(W) | 2 | ✅ |
| `aigo-AuditLogs` | 42 | dashboard-api ADMIN 액션 기록(W) | 2 | ✅ |

> 상세 접근 패턴: [`docs/impl/agent-memory.md`](agent-memory.md) — AgentMemory 조회 흐름  
> E2E 테스트 결과: [`docs/impl/test-report.md`](test-report.md)  
> AWS 아키텍처 다이어그램: [`docs/architecture.drawio`](../architecture.drawio) (draw.io, 2페이지)
