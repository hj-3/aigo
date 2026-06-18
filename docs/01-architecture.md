# 전체 아키텍처

## 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            Users                                         │
│          Developer / Reviewer / Ops / Admin                             │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            │                    │                    │
     GitHub PR             Slack Command        Dashboard Action
     Webhook               /approve             /reject
                           /reject              /fix
                           /investigate         /investigate
                                                         │
                                 AWS Event               │
                           CloudWatch Alarm              │
                           EventBridge Rule              │
            │                    │                    │  │
            └────────────────────┼────────────────────┘  │
                                 │                        │
                                 ▼                        │
┌─────────────────────────────────────────────────────────────────────────┐
│                         Ingress Layer                                    │
│                                                                          │
│   CloudFront ──────────────────────────────────────────────────────────┐│
│   WAF ACL                                                               ││
│   API Gateway (HTTP API)                                                ││
│                                                                          │
│   Lambda Connectors:                                                     │
│   ├── github-connector      (GitHub Webhook 수신·검증)                  │
│   ├── slack-connector       (Slack Command 수신·검증)                   │
│   ├── dashboard-cmd-connector (Dashboard Action 수신)                   │
│   └── aws-event-connector   (CloudWatch/EventBridge 수신)               │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       Event & Queue Layer                                │
│                                                                          │
│   EventBridge Custom Bus  →  Rule-based 라우팅                          │
│                                                                          │
│   SQS Queues:                                                            │
│   ├── analysis-queue    (PR 분석 작업)                                  │
│   ├── fix-queue         (Fix 생성 작업)                                 │
│   ├── incident-queue    (Incident 조사 작업)                            │
│   ├── command-queue     (Slack/Dashboard 명령)                          │
│   ├── notification-queue (GitHub/Slack 알림 발송)                       │
│   └── dead-letter-queue (실패 메시지 보관)                              │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       Execution Layer                                    │
│                                                                          │
│   Lambda Workers (경량, 빠른 처리):                                      │
│   ├── lightweight-worker   (Job dispatch, PR diff 조회, 상태 업데이트)  │
│   └── notification-worker  (GitHub Comment, Slack 메시지 발송)          │
│                                                                          │
│   ECS Fargate (RunTask 기반, 중량 처리):                                │
│   └── heavy-worker         (repo clone, test, lint, patch 생성,        │
│                             Terraform validate, 대형 로그 분석)         │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Agent Runtime Layer                                  │
│                                                                          │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │  Orchestrator Lambda (Python 3.12, 3008MB, 900s)                 │  │
│   │  aigo-orchestrator — Strands SDK, 단일 멀티 페르소나 Agent       │  │
│   │                                                                   │  │
│   │  ┌────────────┐  ┌──────────────┐  ┌───────────┐  ┌──────────┐  │  │
│   │  │Code Review │  │Infra Review  │  │ Security  │  │  Risk    │  │  │
│   │  │ Persona 1  │  │ Persona 2    │  │ Persona 3 │  │ Persona 4│  │  │
│   │  └────────────┘  └──────────────┘  └───────────┘  └──────────┘  │  │
│   │  각 페르소나: KB 검색 → 차이 분석 → Findings 저장               │  │
│   │  최종: Risk Score(0-100) 산출 → Report 저장 → 알림              │  │
│   └──────────────────────────────┬───────────────────────────────────┘  │
│                                  │ 필요 시 전문 Agent 호출              │
│                                  ▼                                       │
│   Bedrock AgentCore (독립 실행, 전문 영역 위임)                         │
│   ├── Incident Agent   (DevOps 조사: CloudWatch/X-Ray/CloudTrail)       │
│   └── Fix Agent        (코드 패치 생성, ECS heavy-worker에서 호출)      │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────────────────┐
│      Memory Layer          │   │           Tool / MCP Layer             │
│                            │   │                                        │
│  AgentCore Memory          │   │  AgentCore Gateway                     │
│                            │   │                                        │
│  Session (단기):           │   │  MCP Tools:                           │
│  pr-{repo}-{number}        │   │  ├── pr_tools                         │
│                            │   │  ├── kb_tools                         │
│  Repo Summary (장기):      │   │  ├── subagent_tools                   │
│  SUMMARY / actorId=repo    │   │  ├── ddb_tools                        │
│                            │   │  ├── slack_tools                      │
│  User Pref (장기):         │   │  ├── github_tools                     │
│  USER_PREFERENCES          │   │  ├── aws_observability_tools          │
│  actorId=developer         │   │  ├── repo_tools                       │
│                            │   │  └── patch_tools                      │
│  Incident (장기):          │   │                                        │
│  INCIDENT_SUMMARY          │   │  MCP 서버 → Lambda / Container 구현   │
│  actorId=service           │   │  Agent는 Gateway Tool만 호출          │
└───────────────────────────┘   └───────────────────────────────────────┘
                 │                               │
                 └───────────────┬───────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Data & Result Layer                               │
│                                                                          │
│   DynamoDB (운영 상태)          S3 (대용량 원본)                        │
│   ├── Organizations             ├── diffs/                              │
│   ├── Users                     ├── reports/                            │
│   ├── Repositories              ├── agent-outputs/                      │
│   ├── AnalysisJobs              ├── patches/                            │
│   ├── AgentRuns                 ├── incidents/                          │
│   ├── Reports                   ├── kb/                                 │
│   ├── Findings                  └── backup/                             │
│   ├── Approvals                                                          │
│   ├── FixRequests               Bedrock Knowledge Base                  │
│   ├── Incidents                 (AWS Best Practice, Org Policy)         │
│   ├── AuditLogs                                                          │
│   └── UsageRecords                                                       │
│                                                                          │
│   Outputs:                                                               │
│   ├── GitHub: PR Comment / Check Run / Fix PR                           │
│   ├── Slack: Report / Alert / Incident Summary                          │
│   └── Dashboard: Report Detail / Fix Preview / Incident Timeline        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 8개 계층 상세

### Layer 1 — User Interface

**역할**: 사용자와 서비스 간 인터랙션 진입점.

| 컴포넌트 | 기술 | 역할 |
|----------|------|------|
| React Dashboard | CloudFront + S3 | 리포트 확인, 승인/거절, Fix 실행 |
| GitHub PR | GitHub App | Check Run, PR Comment |
| Slack | Slack App | 알림 수신, 빠른 명령 |

Dashboard는 단순 조회 화면이 아닌 **Human-in-the-loop Control Plane**이다.

---

### Layer 2 — Auth & API

**역할**: 인증 처리 및 REST API 제공.

| 컴포넌트 | 역할 |
|----------|------|
| Cognito User Pool | JWT 발급, 사용자 관리, RBAC 그룹 |
| API Gateway HTTP API | 외부 요청 라우팅, JWT 검증 |
| Lambda (dashboard-api) | 대시보드 REST API 처리 |

---

### Layer 3 — Connector (입력 진입점)

**역할**: 외부 이벤트 수신, 서명 검증, Job 생성.

| Lambda | 입력 | 처리 |
|--------|------|------|
| `github-connector` | GitHub Webhook | HMAC-SHA256 검증 → AnalysisJob 생성 |
| `slack-connector` | Slack Command | HMAC-SHA256 검증 → CommandJob 생성 |
| `dashboard-cmd-connector` | Dashboard Action | JWT 검증 → Job 생성 |
| `aws-event-connector` | CloudWatch/EventBridge | IncidentJob 생성 |

---

### Layer 4 — Event & Queue

**역할**: 비동기 작업 버퍼링, 재처리, 라우팅.

- **EventBridge Custom Bus**: 서비스 내부 이벤트 라우팅 (`PR_ANALYSIS_REQUESTED`, `REPORT_CREATED`, `APPROVAL_SUBMITTED` 등)
- **SQS**: 작업 타입별 큐 분리, 가시성 타임아웃으로 중복 처리 방지
- **DLQ**: 3회 실패 시 Dead Letter Queue로 이동, CloudWatch Alarm 발생

---

### Layer 5 — Execution

**역할**: 작업 특성에 따른 실행 환경 선택.

| 실행 환경 | 사용 기준 | 예시 |
|-----------|-----------|------|
| Lambda (경량) | 짧고 빠른 작업 (< 15분) | PR diff 조회, 상태 업데이트, 알림 발송 |
| ECS Fargate RunTask (중량) | 오래 걸리거나 로컬 파일시스템 필요 | repo clone, test 실행, patch 생성 |

> ECS는 **항상 떠 있는 서비스가 아니라 RunTask 방식**으로 필요할 때만 실행한다.

---

### Layer 6 — Agent Runtime

**역할**: AI 분석 실행.

| 컴포넌트 | 실행 환경 | 모델 | 역할 |
|----------|-----------|------|------|
| Orchestrator (멀티 페르소나) | Python Lambda (`aigo-orchestrator`, 3008MB, 900s) | Claude 3.5 Sonnet v1 | 단일 Strands Agent — Code/Infra/Security/Risk 페르소나 전환 분석, KB 직접 검색, Risk Score(0-100) 산출 |
| Incident Agent | Bedrock AgentCore (Orchestrator에서 필요 시 호출) | Claude 3.5 Sonnet v1 | 프로덕션 인시던트 RCA — CloudWatch, X-Ray, CloudTrail 조사 |
| Fix Agent | Bedrock AgentCore (ECS heavy-worker에서 호출) | Claude 3.5 Sonnet v1 | 코드 Fix 패치 생성 |

- **Orchestrator 호출 경로**: lightweight-worker → `Lambda.invoke(Event)` → aigo-orchestrator → Strands SDK
- **분석 방식**: Orchestrator가 4개 페르소나(Code/Infra/Security/Risk)를 순차적으로 실행 — Bedrock InvokeAgent 호출 없음
- **KB 검색**: 각 페르소나 분석 전 `search_coding_standards` / `search_infrastructure_standards` / `search_security_standards` / `search_risk_policies` 직접 호출
- **Risk Score**: `(CRITICAL×25) + (HIGH×10) + (MEDIUM×3) + (LOW×1)`, 최대 100
- **프롬프트**: `prompts/v{n}/` 에서 버전 관리

---

### Layer 7 — Memory & Tool

**역할**: Agent의 컨텍스트 유지 및 외부 시스템 접근.

**Memory** (AgentCore Memory SDK):
- Session: PR 단위 원시 대화 로그
- Repo Summary: 같은 레포의 과거 PR 누적 요약
- User Preference: 개발자별 반복 패턴
- Incident: 과거 장애 이력

**MCP Tools** (AgentCore Gateway):
- Agent가 직접 AWS/GitHub/Slack API 호출하지 않음
- 모든 외부 접근은 Gateway Tool을 통해서만

---

### Layer 8 — Data & Result

**역할**: 상태 저장 및 결과 전달.

| 저장소 | 데이터 종류 |
|--------|-------------|
| DynamoDB | 서비스 운영 상태 (Job, Report, Finding, Approval, Audit) |
| S3 | 대용량 원본 (diff, report, patch, RCA) |
| AgentCore Memory | 단기·장기 Agent 컨텍스트 |
| Bedrock KB | AWS Best Practice, 조직 정책 문서 |

---

## 실행 시나리오별 아키텍처 흐름

### 시나리오 A: PR 분석

```
GitHub PR opened
    → API Gateway
    → github-connector Lambda (서명 검증)
    → AnalysisJob 저장 (DynamoDB)
    → SQS analysis-queue
    → lightweight-worker Lambda
        → GitHub API로 PR diff 조회
        → S3에 diff 저장
        → GitHub Check Run: pending
    → Orchestrator Lambda (Strands Multi-Persona Agent)
        → Persona 1 — Code Review: KB 검색 → 코드 분석 → save_findings
        → Persona 2 — Infra Review: KB 검색 → IaC 분석 → save_findings
        → Persona 3 — Security:    KB 검색 → OWASP 분석 → save_findings
        → Persona 4 — Risk Review: KB 검색 → 리스크 분석 → save_findings
        → Risk Score(0-100) 산출, Risk Level 결정
        → save_report (riskScore 포함)
    → notification-worker Lambda
        → GitHub Check Run 업데이트
        → GitHub PR Comment 작성
        → Slack 알림 전송
    → Dashboard: NEEDS_REVIEW 상태 표시
```

### 시나리오 B: Dashboard에서 Fix PR 생성

```
사용자 → Dashboard: Finding 선택 → Request Fix 클릭
    → dashboard-cmd-connector Lambda
    → FixRequest 저장
    → SQS fix-queue
    → lightweight-worker → ECS Fargate RunTask 트리거
    → heavy-worker container:
        → repo clone
        → Fix Agent (AgentCore Runtime) 실행
        → patch_tools: patch 생성
        → dry-run 검증
        → S3에 patch 저장
    → Dashboard: Fix Preview 표시
    사용자 → Approve Fix → Create Fix PR 클릭
    → github_tools: branch 생성 → commit → Fix PR 생성
    → Dashboard / Slack / GitHub 업데이트
```

### 시나리오 C: Incident 조사

```
CloudWatch Alarm (5xx > 5%)
    → EventBridge Rule
    → aws-event-connector Lambda
    → IncidentJob 생성
    → SQS incident-queue
    → Orchestrator Agent
        → DevOps Incident Agent 선택
        → aws_observability_tools:
            CloudWatch metrics / logs
            X-Ray traces
            CloudTrail events
        → github_tools: 최근 PR / 배포 이력 조회
        → AgentCore Memory: 과거 장애 패턴 조회
        → RCA Report 생성
        → S3에 rca.md 저장
        → DynamoDB Incident 저장
    → Dashboard: Incident Report 생성
    → Slack: thread에 요약 전송
```

---

## 변경 이력

### 2026-06-17 — github-connector EventBridge 제거 (v25)

**변경 내용**: `github-connector`가 EventBridge Custom Bus를 경유하지 않고 `aigo-analysis-queue.fifo`에 **직접** `SendMessageCommand`로 메시지 전송.

**이유**: EventBridge Rule 전달 시 `MessageGroupId`가 `"pr-analysis"` 하드코딩 → 모든 조직의 잡이 동일 FIFO 그룹 → 순차 처리 블로킹 발생. 직접 전송으로 `MessageGroupId=orgId` 설정, 조직별 FIFO 그룹 독립 처리.

**영향 범위**: 아키텍처 다이어그램 Layer 4 수정 필요.
```
변경 전: github-connector → EventBridge → Rule → analysis-queue.fifo
변경 후: github-connector → analysis-queue.fifo (직접, MessageGroupId=orgId)
```
EventBridge Bus 자체(`aigo-bus`)는 `aws-event-connector` → `incident-queue.fifo` 경로에서 여전히 사용.

---

### 2026-06-16 — command-queue / incident-queue Lambda ESM 추가

**변경 내용**: `aigo-command-queue.fifo`와 `aigo-incident-queue.fifo`에 `lightweight-worker`를 이벤트 소스로 매핑하는 Lambda ESM(Event Source Mapping) 추가.

**이유**: Terraform에 ESM이 없어 Slack `/approve`, `/reject`, `/investigate` 명령이 큐에 쌓이기만 하고 처리되지 않았음 (2026-06-16 이전).

---

### 2026-06-15 — Layer 7 Tool 계층 실제 구현 반영

**변경 내용**: Layer 7 다이어그램의 "MCP Tools (AgentCore Gateway)" 설명은 초기 설계안. 실제 구현은 Strands `@tool` 데코레이터로 Orchestrator Lambda 내부에서 in-process 실행.

- `AgentCore Gateway` 인프라 없음
- `MCP 서버` 없음 (Lambda/Container로 구현 없음)
- Agent는 Python 함수(`@tool`)를 동일 프로세스에서 직접 호출

---

### 2026-06-15 — Layer 7 Memory 실제 구현 반영

**변경 내용**: Layer 7의 "AgentCore Memory (SDK)" 설명은 Bedrock AgentCore 네이티브 Memory를 사용하는 것처럼 표현되어 있으나, 실제 구현은 **DynamoDB 기반 커스텀 Memory** (`aigo-AgentMemory` 테이블).

| Memory 타입 | PK 패턴 | TTL |
|-------------|---------|-----|
| PR_ANALYSIS | `MEMORY#PR#ORG#{orgId}#REPO#{repoId}` | 90일 |
| INCIDENT | `MEMORY#INCIDENT#ORG#{orgId}#SERVICE#{svc}` | 1년 |

상세: `docs/impl/agent-memory.md` 참조.

---

### 2026-06-15 — Layer 8 KB: AOSS → S3 Vector Index

**변경 내용**: "Bedrock Knowledge Base"(Amazon OpenSearch Serverless 기반)가 비활성화되고 **S3 Vector Index** 방식으로 전환.

**이유**: AOSS 비용 ~$692/월 → S3 Vector Index ~$1/월 (Titan Embeddings v2, 18 chunks).

```
변경 전: Bedrock Knowledge Base → AOSS (OpenSearch Serverless) → 벡터 검색
변경 후: S3 aigo-kb/vector-index/index.json → Titan Embeddings v2 cosine similarity → 상위 5 chunks
```

상세: `docs/impl/kb-s3-vector.md` 참조.

---

### 2026-06-16 — Layer 5 Execution: SQS 큐 타입 수정

**변경 내용**: 아키텍처 다이어그램 및 인프라 문서에 기술된 일부 SQS 큐 타입이 실제와 다름.

| 큐 | 실제 타입 | 변경 전 표기 |
|----|---------|------------|
| `aigo-analysis-queue.fifo` | FIFO | Standard |
| `aigo-command-queue.fifo` | FIFO | Standard |
| `aigo-incident-queue.fifo` | FIFO | Standard |
| `aigo-notification-queue` | Standard | Standard (정확) |
| `aigo-fix-queue.fifo` | FIFO | Standard |

