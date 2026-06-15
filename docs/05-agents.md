# Agent 설계

## 개요

단일 **멀티 페르소나 Strands Agent** 기반 시스템이다.  
하나의 Orchestrator Agent가 4개의 분석 페르소나(역할)를 순차적으로 전환하며 PR을 분석한다.  
모든 Agent는 `anthropic.claude-3-5-sonnet-20240620-v1:0` 모델을 사용하며, 프롬프트는 `prompts/v{n}/` 에서 버전 관리된다.

---

## 아키텍처 원칙

- **단일 Agent**: PR 분석(Code/Infra/Security/Risk)은 하나의 Strands Agent가 페르소나를 전환하며 수행. Bedrock InvokeAgent 호출 없음
- **KB 직접 검색**: 각 페르소나 분석 전 Knowledge Base 검색 (`kb_tools`)을 통해 관련 표준·정책 컨텍스트 주입
- **Frontier Agent**: Incident Agent, Fix Agent는 별도 Bedrock AgentCore로 존재. Orchestrator가 필요 시 `subagent_tools`로 호출
- **Tool 격리**: Agent는 필요한 Tool만 허용
- **Risk Score**: 0-100 수치 스코어로 위험도 정량화

---

## Orchestrator Lambda — 멀티 페르소나 Agent

### 역할

Lambda(`aigo-orchestrator`, 3008MB, 900s) 위에서 Strands SDK로 직접 실행되는 단일 AI Agent.  
PR diff를 받아 4개 페르소나로 분석 → Risk Score 산출 → Report 저장 → GitHub/Slack 알림.

### 페르소나 구성

| 페르소나 | 분석 대상 | KB 검색 |
|---------|---------|---------|
| **Persona 1: Code Reviewer** | 버그 패턴, 레이스 컨디션, N+1, 에러 처리, 하드코딩 시크릿, API 하위 호환성 | `search_coding_standards` |
| **Persona 2: Infra Reviewer** | IaC(*.tf, *.yaml), IAM 과잉 권한, SG 설정, 암호화 누락, 비용 영향 | `search_infrastructure_standards` |
| **Persona 3: Security Agent** | OWASP Top 10, CWE, SQL/Command Injection, 인증/인가 취약점 | `search_security_standards` |
| **Persona 4: Risk Reviewer** | API 하위 호환성, DB 스키마 변경, 배포 Blast Radius, 롤백 복잡도 | `search_risk_policies` |

### 처리 흐름

```
1. lightweight-worker → Lambda.invoke(InvocationType=Event) → aigo-orchestrator
2. diff_content 포함 job_input 수신 (GitHub API diff는 lightweight-worker에서 미리 조회)
3. 순차 페르소나 분석:
   Step 1 → KB 검색 → Code Review   → save_findings(agent_name="code-reviewer")
   Step 2 → KB 검색 → Infra Review  → save_findings(agent_name="infra-reviewer")
   Step 3 → KB 검색 → Security      → save_findings(agent_name="security-agent")
   Step 4 → KB 검색 → Risk Review   → save_findings(agent_name="risk-reviewer")
4. Risk Score 산출: min((CRITICAL×25) + (HIGH×10) + (MEDIUM×3) + (LOW×1), 100)
5. Risk Level 결정: 0-20=LOW, 21-50=MEDIUM, 51-80=HIGH, 81-100=CRITICAL
6. 머지 권고: LOW→APPROVE, MEDIUM/HIGH→REQUEST_CHANGES, CRITICAL→BLOCK
7. save_report (riskScore, riskLevel, mergeRecommendation 포함)
8. notify_analysis_complete → Slack 알림
9. post_pr_comment → GitHub PR Comment
```

### Risk Score 공식

```
score = (CRITICAL_count × 25) + (HIGH_count × 10) + (MEDIUM_count × 3) + (LOW_count × 1)
risk_score = min(score, 100)

| 범위    | Level    | 머지 권고        |
|---------|----------|-----------------|
| 0–20    | LOW      | APPROVE          |
| 21–50   | MEDIUM   | REQUEST_CHANGES  |
| 51–80   | HIGH     | REQUEST_CHANGES  |
| 81–100  | CRITICAL | BLOCK            |
```

### 허용 Tool

```
kb_tools:      search_coding_standards, search_infrastructure_standards,
               search_security_standards, search_risk_policies
ddb_tools:     save_report, save_findings, update_job_status
slack_tools:   notify_analysis_complete
github_tools:  post_pr_comment
```

### 입력 유형

| 유형 | 소스 | 처리 |
|------|------|------|
| `PR_ANALYSIS` | GitHub Webhook | 4-페르소나 분석 전체 실행 |
| `REANALYSIS` | Dashboard 재실행 | 동일 PR 재분석 |
| `INCIDENT_INVESTIGATION` | CloudWatch Alarm / Slack | invoke_devops_agent 호출 |

---

## DevOps Incident Agent (Frontier Agent)

### 역할

프로덕션 인시던트 조사 전문 Agent. CloudWatch, X-Ray, CloudTrail 데이터를 분석해 RCA 리포트 생성.  
**Orchestrator가 `invoke_devops_agent` (subagent_tools)를 통해 호출. 주 PR 분석 흐름에는 포함되지 않음.**

### 분석 흐름

```
1. CloudWatch Metrics: 에러율, 레이턴시, 처리량 조회
2. CloudWatch Logs Insights: 에러 로그, 스택 트레이스 검색
3. X-Ray Traces: 병목 서비스, 실패 구간 탐지
4. CloudTrail: 장애 직전 인프라 변경 이력 조회
5. 배포 시점 ↔ 장애 시작 시점 상관분석
6. RCA 리포트 생성 → DynamoDB Incidents 저장
7. Slack thread 알림
```

### 출력

```json
{
  "rootCause": "PR #27 webhook validation 누락",
  "confidence": 0.87,
  "affectedServices": ["prod-api"],
  "timeline": [{"time": "...", "event": "..."}],
  "mitigation": "즉시 롤백 또는 hotfix",
  "prevention": "PR 분석 시 인증 검증 체크 강화",
  "requiresHumanAction": true
}
```

### 허용 Tool

`aws_observability_tools`, `github_tools`, `ddb_tools`, `slack_tools`, `kb_tools`

---

## Fix Agent (Frontier Agent)

### 역할

승인된 Finding에 대해 코드 패치를 생성하고 Fix PR을 만든다.  
**사용자가 Dashboard에서 "Request Fix"를 승인한 Finding만 처리. 미승인 자동 실행 절대 금지.**

### 처리 흐름

```
사용자 → Dashboard "Request Fix" 클릭
→ FixRequest 저장 (DynamoDB)
→ SQS fix-queue
→ lightweight-worker → ECS Fargate RunTask
→ heavy-worker container:
    → Fix Agent (Bedrock AgentCore)
        → PR 현재 파일 상태 조회
        → Finding별 수정 코드 생성
        → patch 적용 시뮬레이션 (dry-run)
        → S3에 patch 저장
→ Dashboard Fix Preview 표시

사용자 → "Create Fix PR" 클릭
→ github_tools: branch 생성 (pullpilot/fix/pr-{prNumber}-{category})
→ github_tools: 수정 파일 commit
→ github_tools: Fix PR 생성
```

### 절대 금지

```
❌ terraform apply / kubectl apply
❌ AWS 운영 리소스 직접 수정
❌ main / master 브랜치 직접 push
❌ 사용자 승인 없는 commit
```

### 허용 Tool

`pr_tools`, `patch_tools`, `repo_tools`, `github_tools`, `ddb_tools`, `slack_tools`

---

## Finding Schema

모든 페르소나 분석 결과가 공통으로 사용하는 구조:

```json
{
  "severity": "CRITICAL | HIGH | MEDIUM | LOW | INFO",
  "category": "SECURITY | PERFORMANCE | CODE_QUALITY | INFRA | RISK | COMPLIANCE",
  "location": "파일:라인 또는 리소스 이름",
  "description": "발견된 구체적인 이슈",
  "confidence": 0.0,
  "fixable": true,
  "fix_suggestion": "구체적인 수정 방법"
}
```

---

## subagent_tools 구성

Orchestrator Agent의 Tool 목록에는 포함되지 않음.  
`invoke_devops_agent`만 유지 — Incident 조사 시 Orchestrator가 명시적으로 호출.

| Tool | 설명 |
|------|------|
| `invoke_devops_agent` | DevOps Incident Agent 실행 (CloudWatch/X-Ray/CloudTrail 조사) |

> **이전 설계와 다른 점**: `invoke_code_reviewer`, `invoke_infra_reviewer`, `invoke_risk_reviewer`, `invoke_security_agent`는 제거됨. 4개 도메인 분석은 Orchestrator 멀티 페르소나로 통합.

---

## kb_tools 구성

Orchestrator Agent가 각 페르소나 분석 전 직접 호출.

| Tool | 설명 |
|------|------|
| `search_coding_standards` | 코딩 표준, 과거 코드 인시던트 검색 |
| `search_infrastructure_standards` | AWS Well-Architected, 인프라 정책 검색 |
| `search_security_standards` | 보안 정책, OWASP 가이드라인 검색 |
| `search_risk_policies` | 변경 관리 정책, 리스크 기준 검색 |

---

## ddb_tools 구성

| Tool | 설명 |
|------|------|
| `save_findings` | Finding 목록 저장 (페르소나별 호출) |
| `save_report` | Report 저장 (riskScore 0-100 포함) |
| `update_job_status` | Job 상태 업데이트 (IN_PROGRESS/COMPLETED/FAILED) |
| `update_incident` | Incident 레코드 업데이트 |
| `update_fix_request` | FixRequest 레코드 업데이트 |
| `get_findings_for_report` | Report의 Findings 조회 |

---

## Agent별 실행 환경 요약

| Agent | 실행 환경 | 호출 경로 |
|-------|---------|---------|
| Orchestrator (멀티 페르소나) | Lambda `aigo-orchestrator` 3008MB / 900s | lightweight-worker → Lambda.invoke(Event) |
| DevOps Incident Agent | Bedrock AgentCore | Orchestrator → invoke_devops_agent |
| Fix Agent | Bedrock AgentCore + ECS Fargate | heavy-worker → AgentCore Runtime |
