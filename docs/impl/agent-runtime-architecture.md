# Agent 런타임 아키텍처 — Strands SDK, Lambda, EventBridge

## 1. Strands SDK란?

**Strands Agents SDK**는 AWS가 만든 오픈소스 Python Agent 프레임워크다.

```
pip install strands-agents strands-agents-tools
```

### 핵심 특징

| 특징 | 설명 |
|------|------|
| **순수 Python 실행** | Bedrock AgentCore 런타임 불필요 — Python 프로세스 안에서 직접 실행 |
| **ReAct 루프** | 모델 추론 → Tool 선택 → Tool 실행 → 결과 반영을 반복 |
| **Tool 등록** | `@tool` 데코레이터 또는 함수 리스트로 Tool 등록 |
| **BedrockModel** | Claude 모델을 Bedrock API를 통해 호출 |

### Strands vs Bedrock AgentCore 차이

| 구분 | Strands SDK | Bedrock AgentCore |
|------|-------------|-------------------|
| 실행 환경 | 어디서나 (Lambda, ECS, 로컬) | AWS 관리형 AgentCore 런타임 |
| 설정 위치 | Python 코드 안 | AWS 콘솔 / API (별도 Agent 리소스) |
| Tool 등록 | 코드에서 함수 리스트로 | Action Group / Lambda 연결 |
| 호출 방법 | `agent("prompt")` 호출 | `InvokeAgent` API 호출 |
| 메모리 관리 | 직접 구현 (DynamoDB 등) | Bedrock Memory 내장 |
| 적합 용도 | 커스텀 로직이 많은 경우 | 관리형 Agent 서비스 |

---

## 2. Orchestrator Lambda — Strands Agent 실행 모델

### 실행 경로

```
GitHub PR webhook
    → github-connector Lambda
        → DynamoDB: AnalysisJob 저장 (status=PENDING)
        → SQS: analysis-queue.fifo 전송
    → lightweight-worker Lambda (SQS trigger)
        → GitHub API: PR diff 조회 (최대 10MB)
        → S3: diff 저장
        → DynamoDB: Job status → IN_PROGRESS
        → Lambda.invoke(InvocationType="Event")  ← 비동기 호출
            FunctionName: aigo-orchestrator:live
            Payload: { jobId, orgId, diffContent, prContext, ... }
    → aigo-orchestrator Lambda (비동기, 최대 900초)
        → Strands Agent("분석 프롬프트") 실행
            ↳ Claude 모델 추론 (BedrockModel)
            ↳ Tool 호출: search_coding_standards(...)
            ↳ Tool 호출: save_findings(...)
            ↳ Tool 호출: notify_analysis_complete(...)
            ↳ (반복) ...
        → DynamoDB: Job status → COMPLETED
```

### Orchestrator Lambda 설정

```
함수명:       aigo-orchestrator
Runtime:      Python 3.12
메모리:       3008 MB  (Claude 모델 응답 + Tool 실행에 충분한 메모리)
타임아웃:     900초    (15분 — PR 분석에 최대 10~15분 소요 가능)
실행 역할:    aigo-orchestrator-role (DDB/S3/SSM/Bedrock/SQS 권한)
별칭:         live → 현재 최신 버전 (현재 v12)
```

### Strands Agent 코드 구조

```python
# agents/orchestrator/src/agent.py

from strands import Agent
from strands.models import BedrockModel

model = BedrockModel(
    model_id="anthropic.claude-3-5-sonnet-20240620-v1:0",
    region_name="ap-northeast-2",
    max_tokens=8192,
    temperature=0.0,
)

agent = Agent(
    model=model,
    system_prompt=ORCHESTRATOR_SYSTEM_PROMPT,
    tools=[
        kb_tools.search_coding_standards,     # KB 검색
        ddb_tools.save_findings,              # DynamoDB 저장
        github_tools.create_check_run,        # GitHub API
        slack_tools.notify_analysis_complete, # Slack 알림
        # ...
    ],
)

# 실행 — Claude가 ReAct 루프로 Tool 호출하며 분석 수행
agent("Analyze PR #42 — ...")
```

---

## 3. 오케스트레이터 — LLM 기반 페르소나 선택 (v13부터)

v12까지는 Python 코드(`classify_personas()`)가 파일 확장자 기반으로 페르소나를 사전 결정했다.  
이는 "오케스트레이터"가 아닌 하드코딩된 로직이었다.

**v13부터**: 오케스트레이터 에이전트(Strands/Claude)가 **Step 0c**에서 직접 판단한다.

### Step 0c — 에이전트의 페르소나 결정

```
Step 0c — Persona Selection (YOUR DECISION — state explicitly)
Based on the Changed Files list, decide which personas are needed:
- Code Reviewer: needed for ANY code changes
- Infra Reviewer: needed ONLY if diff contains *.tf, *.hcl, Dockerfile, helm/, k8s/
- Security Agent: needed for all non-documentation changes
- Risk Reviewer: needed for all non-documentation changes

State your decision: "PERSONAS SELECTED: Code Reviewer, Security Agent, Risk Reviewer"
"PERSONAS SKIPPED: Infra Reviewer — no IaC files detected"
```

에이전트는 변경된 파일 목록을 분석한 후 명시적으로 선택을 선언하고, 선택된 페르소나의 분석 단계만 실행한다.

### PR 타입별 에이전트 결정 예시

| PR 유형 | Code | Infra | Security | Risk |
|---------|------|-------|----------|------|
| TypeScript/Python 코드 변경 | ✅ | ❌ | ✅ | ✅ |
| Terraform / Dockerfile 변경 | ✅ | ✅ | ✅ | ✅ |
| 코드 + IaC 혼합 | ✅ | ✅ | ✅ | ✅ |
| 문서(*.md)만 변경 | ✅ | ❌ | ❌ | ❌ |

에이전트가 직접 diff를 보고 판단하므로, 단순 확장자 기반보다 더 정교한 결정이 가능하다.  
예: 인프라 코드가 아닌 `.yaml` 파일, 또는 보안 관련 내용이 있는 설정 파일 등.

---

## 4. Bedrock AgentCore — 전문 Agent (Incident / Fix)

Orchestrator와 다른 실행 방식. **AWS 관리형 AgentCore 런타임**에서 실행.

### 현재 배포된 Bedrock Agents

| Agent 이름 | 상태 | 역할 |
|-----------|------|------|
| `aigo-orchestrator` | PREPARED | Strands Lambda로 대체됨 — 미사용 |
| `aigo-incident-agent` | PREPARED | 프로덕션 인시던트 RCA (CloudWatch/X-Ray/CloudTrail) |
| `aigo-fix-agent` | PREPARED | 코드 패치 생성, Fix PR 작성 |

> `aigo-orchestrator` Bedrock Agent는 초기 설계 산물이다.  
> 실제 오케스트레이터는 `aigo-orchestrator` **Lambda**에서 Strands SDK로 실행된다.  
> Bedrock Agent 리소스는 삭제하지 않아도 무방하지만 실제 호출되지 않는다.

### Incident Agent 호출 경로

```
Orchestrator (Strands, INCIDENT 타입)
    → subagent_tools.invoke_devops_agent()
        → Bedrock InvokeAgent API
            AgentId: aigo-incident-agent
            Payload: { incidentId, service, alarmName, ... }
        → AgentCore 런타임: CloudWatch/X-Ray/CloudTrail 조사
        → RCA 결과 반환
    → save_incident_memory()
    → send_incident_update() → Slack
```

---

## 5. EventBridge 구현 (aigo-bus 라우팅)

### aigo-bus 규칙 (Terraform 구현 완료)

```
aigo-bus (Custom Event Bus)
├── 아카이브: aigo-archive (90일 보존, 재생 가능)
├── 규칙: aigo-pr-analysis-requested
│     source: ["aigo.github", "aigo.dashboard"]
│     detail-type: ["PR_ANALYSIS_REQUESTED"]
│     → SQS analysis-queue.fifo (InputTransformer: $.detail 추출)
├── 규칙: aigo-incident-detected
│     source: ["aigo.aws", "aigo.slack"]
│     detail-type: ["INCIDENT_DETECTED"]
│     → SQS incident-queue.fifo
└── 규칙: aigo-report-created
      source: ["aigo.orchestrator"]
      detail-type: ["REPORT_CREATED", "APPROVAL_SUBMITTED"]
      → SQS notification-queue
```

### 이벤트 플로우 (EventBridge 경유)

```
GitHub PR webhook
    → github-connector Lambda
        → DynamoDB: AnalysisJob 저장
        → EventBridge aigo-bus PutEvents:
            Source: "aigo.github"
            DetailType: "PR_ANALYSIS_REQUESTED"
            Detail: { type, jobId, orgId, repoId, prContext, ... }
    → EventBridge Rule: aigo-pr-analysis-requested
        → InputTransformer: $.detail 추출
        → SQS analysis-queue.fifo (MessageGroupId: "pr-analysis")
    → lightweight-worker Lambda (SQS trigger)
        → 기존과 동일한 AnalysisQueueMessage 처리
```

### InputTransformer 역할

EventBridge 이벤트 구조 → SQS 메시지 본문 변환:
```json
// EventBridge 이벤트
{ "source": "aigo.github", "detail-type": "PR_ANALYSIS_REQUESTED", "detail": {...} }

// SQS 메시지 본문 (InputTransformer: $.detail 추출)
{ "type": "ANALYSIS_REQUESTED", "jobId": "...", "orgId": "...", "prContext": {...} }
```

lightweight-worker는 기존과 동일한 `AnalysisQueueMessage` 형식을 수신한다.

### CloudWatch Alarm (기본 버스 → aws-event-connector)

```
CloudWatch Alarm (5xx > 5%)
    → EventBridge 기본 버스 (default)
        → Rule: AlarmStateChange → aws-event-connector Lambda
            → IncidentJob 저장 (DynamoDB)
            → EventBridge aigo-bus: INCIDENT_DETECTED
                → SQS incident-queue (via aigo-incident-detected rule)
```

### Approve/Reject → GitHub PR Review (notification-worker 경유)

```
Dashboard 사용자 클릭
    → dashboard-api PATCH /reports/{id}/approve
        → DynamoDB: approvalStatus 업데이트
        → SQS notification-queue: REVIEW_SUBMITTED 메시지
    → notification-worker Lambda
        → GitHub App JWT 생성 → Installation Token 교환
        → POST /repos/{owner}/{repo}/pulls/{pr}/reviews
            APPROVED → event: "APPROVE"
            REJECTED → event: "REQUEST_CHANGES"
        → Slack 알림 (설정된 채널)
```

---

## 6. SQS Queue 구성 (실제 라우팅 계층)

```
SQS FIFO Queues:
├── aigo-analysis-queue.fifo      (PR 분석 작업)   → lightweight-worker
├── aigo-fix-queue.fifo           (Fix 생성 작업)   → lightweight-worker → ECS
├── aigo-incident-queue.fifo      (Incident 조사)   → lightweight-worker
├── aigo-command-queue.fifo       (Slack/Dashboard 명령) → lightweight-worker
├── aigo-notification-queue.fifo  (GitHub/Slack 알림) → notification-worker
└── aigo-dlq.fifo                 (3회 실패 → DLQ, CloudWatch Alarm)
```

**FIFO 사용 이유**: MessageGroupId를 orgId로 설정 → 같은 조직 작업의 순서 보장.

---

## 7. Lambda 버전 이력

| Lambda | 현재 버전 | 주요 변경 |
|--------|---------|---------|
| `aigo-orchestrator` | v13 | LLM-driven 페르소나 선택 Step 0c (v13), prContext 저장 (v11) |
| `aigo-lightweight-worker` | v22 | SQS retry ConditionalCheckFailed 수정 |
| `aigo-dashboard-api` | v29 | approve/reject → GitHub review via notification-queue |
| `aigo-github-connector` | latest | EventBridge aigo-bus PutEvents 전환 (SQS direct 제거) |
| `aigo-notification-worker` | latest | REVIEW_SUBMITTED 처리 → GitHub PR formal review 생성 |
