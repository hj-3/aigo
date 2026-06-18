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
3. classify_personas(changedFiles) → 활성 페르소나 결정 (Python 코드에서 결정)
   - code: 항상
   - infra: *.tf / *.hcl / Dockerfile / helm / k8s 파일이 있을 때만
   - security: 순수 문서(*.md) PR이 아닐 경우
   - risk: 순수 문서(*.md) PR이 아닐 경우
4. 선택된 페르소나만 순차 실행:
   (code)     KB 검색 → Code Review   → save_findings(agent_name="code-reviewer")  → AgentRuns 기록
   (infra?)   KB 검색 → Infra Review  → save_findings(agent_name="infra-reviewer") → AgentRuns 기록
   (security) KB 검색 → Security      → save_findings(agent_name="security-agent") → AgentRuns 기록
   (risk)     KB 검색 → Risk Review   → save_findings(agent_name="risk-reviewer")  → AgentRuns 기록
   ※ save_findings 미호출 페르소나(스킵)는 AgentRuns 레코드 없음 → Dashboard 회색(gray) 표시
5. Risk Score 산출: min((CRITICAL×25) + (HIGH×10) + (MEDIUM×3) + (LOW×1), 100)
6. Risk Level 결정: 0-20=LOW, 21-50=MEDIUM, 51-80=HIGH, 81-100=CRITICAL
7. 머지 권고: LOW→APPROVE, MEDIUM/HIGH→REQUEST_CHANGES, CRITICAL→BLOCK
8. save_report (riskScore, riskLevel, mergeRecommendation, prContext 포함)
9. update_check_run → GitHub Check Run 결과 반영
10. notify_analysis_complete → Slack 알림
11. post_pr_comment → GitHub PR Comment
11b. auto_merge_pr(org_id, risk_score, merge_recommendation, installation_id)
    → org.approvalRequired=false AND risk_score ≤ org.riskThreshold(기본 20) 일 때 자동 머지
    → 조건 불충족 시 스킵 (Slack /approve 또는 Dashboard 수동 승인 필요)
    → 수동 /approve → notification-worker → GitHub PR Review(APPROVE) 제출 후 PR 머지
12. save_pr_analysis_memory → 미래 분析을 위한 메모리 저장
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
| `PR_ANALYSIS` | GitHub Webhook | 지능적 페르소나 선택 → 관련 페르소나만 실행 |
| `REANALYSIS` | Dashboard 재실행 | 동일 PR 재분석 (페르소나 재선택) |
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

---

## 변경 이력

### 2026-06-18 — auto_merge_pr riskThreshold 타입 변경 (orchestrator v22→v23)

**변경 내용**: 처리 흐름 step 11b의 `auto_merge_pr`에서 `riskThreshold`를 정수로 직접 비교하던 방식을 문자열 → 정수 dict 매핑으로 변경.

```python
# 변경 전 (v22) — TypeError: int('HIGH') 크래시
if risk_score <= org.get('riskThreshold', 20):

# 변경 후 (v23)
THRESHOLD_MAP = {'NONE': -1, 'LOW': 19, 'MEDIUM': 39, 'HIGH': 74, 'CRITICAL': 100}
threshold_int = THRESHOLD_MAP.get(str(threshold_str), -1)
if risk_score <= threshold_int:
```

**이유**: DynamoDB `aigo-Organizations.riskThreshold`가 문자열(`NONE`/`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`)로 저장됨. `int()` 변환 시 `ValueError` 크래시.

**DashboardAPI 연동**: `SettingsPage`의 `riskThreshold` 드롭다운 옵션은 `NONE`/`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`이며 각각 내부 임계값으로 변환됨.

---

### 2026-06-17 — ddb_tools: save_pr_analysis_memory / save_incident_memory 추가

**변경 내용**: `ddb_tools` 섹션의 Tool 목록에 누락된 Memory 관련 도구 추가.

| Tool | 설명 |
|------|------|
| `save_pr_analysis_memory` | PR 분석 이력 저장 (`aigo-AgentMemory`, TTL 90일) |
| `get_repo_memory` | 같은 레포의 과거 PR 분석 이력 조회 (limit 3) |
| `get_developer_memory` | 특정 개발자의 과거 PR 패턴 조회 (limit 5) |
| `save_incident_memory` | 인시던트 RCA 저장 (`aigo-AgentMemory`, TTL 1년) |
| `get_incident_memory` | 과거 유사 인시던트 패턴 조회 (limit 3) |

**Memory 저장 위치**: Bedrock AgentCore 네이티브 Memory SDK가 아닌 **DynamoDB `aigo-AgentMemory` 테이블** (커스텀 구현). 상세: `docs/impl/agent-memory.md`.

**사용 시점**:
- PR 분석 시작 전: `get_repo_memory` + `get_developer_memory` → 컨텍스트 주입
- PR 분석 완료 후: `save_pr_analysis_memory` (step 12)
- 인시던트 조사 시작 전: `get_incident_memory`
- 인시던트 조사 완료 후: `save_incident_memory`

---

### 2026-06-17 — save_findings → AgentRuns 이중 기록 추가 (orchestrator v22)

**변경 내용**: `save_findings` 호출 시 Findings 테이블에 저장하는 동시에 `aigo-AgentRuns` 테이블에도 페르소나 레코드 기록.

**이유**: Dashboard의 Agent 실행 타임라인(`JobDetailPage`) 및 AgentPipeline UI가 `aigo-AgentRuns` 레코드를 기반으로 페르소나 상태(done/skipped)를 표시. `save_findings` 미호출 페르소나(스킵)는 AgentRuns 레코드 없음 → Dashboard에서 회색(skipped) 표시.

---

### 2026-06-17 — prContext 필드 추가

**변경 내용**: `save_report` 호출 시 `prContext`(prNumber, prUrl, prTitle, commitSha, authorLogin) 포함.

**이유**: Dashboard 승인 버튼 클릭 시 `dashboard-api`가 `report.prContext.prUrl`에서 GitHub PR URL을 가져와 notification-worker에 전달. PR URL 없으면 merge/close 불가.

