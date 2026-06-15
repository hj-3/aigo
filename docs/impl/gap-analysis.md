# Gap Analysis — 원본 설계 vs 현재 구현

작성일: 2026-06-12  
기준: AIOps_ChangeManagement.pdf + demo2_change_arc.png vs 현재 코드베이스

---

## ✅ 완료된 사항 (원본 설계와 일치)

| 항목 | 원본 설계 | 구현 상태 |
|------|---------|---------|
| 단일 멀티 페르소나 Strands Agent | 1개 Agent, 4개 페르소나 | **완료** (`agents/orchestrator/src/agent.py`) |
| Risk Score 0-100 | 수치 스코어 | **완료** (`ddb_tools.save_report(risk_score=...)`) |
| Verdict 3단계 | APPROVE / REQUEST_CHANGES / BLOCK | **완료** |
| Knowledge Base 직접 검색 | 각 페르소나 분석 전 KB 검색 | **완료** (`kb_tools` in orchestrator tools) |
| PR diff 조회 → Orchestrator 전달 | lightweight-worker가 diff 조회 후 주입 | **완료** |
| Lambda 비동기 호출 | lightweight-worker → Lambda.invoke(Event) | **완료** |
| GitHub PR Comment | post_pr_comment | **완료** |
| Slack 알림 | notify_analysis_complete | **완료** |
| DynamoDB GSI3 (dashboard query) | GSI3PK = ORG#{orgId} | **완료** (이전 세션에서 수정) |
| CI/CD 오케스트레이터 배포 | CD 파이프라인에 deploy-orchestrator-lambda job | **완료** |

---

## 🔴 미구현 / 미완성 사항 (Gap)

### 1. AgentCore Memory — 미구현
**원본 설계**: PR Session Memory, Repo Summary Memory, Developer Pattern Memory, Incident Memory  
**현재**: Memory 관련 코드 없음. Orchestrator agent.py에서 `build_agent()` 호출 시 memory 설정 없음.  
**영향**: 동일 개발자의 반복 패턴 감지 불가, 레포 누적 요약 불가, 과거 인시던트 연결 불가  
**구현 필요**: Strands SDK `MemoryStore` 또는 AgentCore Memory SDK 연동

### 2. GitHub Check Run — 미구현
**원본 설계**: PR 분석 시작 시 GitHub Check Run 생성(pending), 완료 시 업데이트  
**현재**: `github_tools.post_pr_comment`만 있음. Check Run API 없음  
**영향**: GitHub PR의 체크 상태가 업데이트되지 않음 (CI 통과 여부 표시 없음)  
**구현 필요**: `github_tools.create_check_run`, `update_check_run` 추가

### 3. Dashboard Approval → Memory 연동 — 미구현
**원본 설계**: Dashboard에서 Approve/Reject 시 AgentCore Memory 업데이트  
**현재**: DynamoDB 상태만 업데이트, Memory 연동 없음

### 4. Incident Agent 실제 연동 — 미구현
**원본 설계**: CloudWatch Alarm → EventBridge → Orchestrator → invoke_devops_agent  
**현재**: `subagent_tools.invoke_devops_agent` 코드는 있으나 Orchestrator tools 목록에 없음 (Incident 흐름 미완성)  
**구현 필요**: Incident 유형 job_input 처리 로직 추가, Orchestrator tools에 invoke_devops_agent 추가

### 5. Fix Agent 흐름 — 미연결
**원본 설계**: Dashboard → SQS fix-queue → heavy-worker → ECS Fargate → Fix Agent  
**현재**: ECS heavy-worker 컨테이너 미구현 (`workers/heavy` 디렉토리 없음 또는 skeleton)  
**구현 필요**: heavy-worker ECS container, Fix Agent Bedrock 연결

### 6. Terraform: Bedrock Agent 미사용 리소스
**원본 설계 변경 결과**: Code/Infra/Risk/Security Reviewer Bedrock Agents는 더 이상 사용 안 됨  
**현재**: Terraform에 4개 Bedrock Agent 리소스가 여전히 배포됨 — 비용 낭비 가능성  
**권고**: `infra/terraform/modules/bedrock-agentcore/`에서 code-reviewer, infra-reviewer, risk-reviewer, security-agent 제거 또는 비활성화 고려

### 7. SLACK_CHANNEL_ID 미설정
**현재**: `notify_analysis_complete`는 구현됐으나 실제 Slack 채널 ID 미설정  
**영향**: Slack 알림 전송 실패 가능성  
**구현 필요**: Lambda 환경 변수 `SLACK_CHANNEL_ID` 설정

### 8. GitHub PR Comment에 Risk Score 미표시
**현재**: `post_pr_comment` 호출 시 risk_score 파라미터 없음  
**원본 설계**: PR Comment에 Risk Score(0-100) 숫자 표시  
**구현 필요**: `github_tools.post_pr_comment` 시그니처에 `risk_score` 파라미터 추가, Comment 템플릿 업데이트

### 9. KB 카테고리 필터링 효과 미검증
**현재**: `kb_tools._search_kb`에서 `filter_tag`를 메타데이터 필터로 사용하나 실제 KB 문서에 `category` 메타데이터가 설정됐는지 미확인  
**영향**: 필터가 동작 안 하면 4번의 KB 검색 모두 같은 결과 반환  
**확인 필요**: Bedrock KB의 각 문서에 `category: coding_standards / infrastructure / security / risk` 메타데이터 설정

### 10. Dashboard: riskScore 표시 미구현
**현재**: Dashboard frontend에서 `riskScore` 필드 표시 코드 없을 가능성  
**영향**: Report에 riskScore(0-100)가 저장되지만 UI에서 보이지 않음  
**확인 필요**: `apps/dashboard/src/` 에서 riskScore 렌더링 코드 확인

---

## 🟡 설계에 있으나 현재 기초 단계인 사항

| 항목 | 상태 |
|------|------|
| SaaS 멀티테넌시 (조직별 완전 격리) | 데이터 모델은 있으나 API 레이어 적용 부분적 |
| Bedrock Guardrails (Prompt Injection 방어) | 미적용 |
| AWS WAF 규칙 (DDoS, bot 방어) | Terraform에 WAF ACL 있으나 규칙 최소화 |
| Audit Log 자동 기록 | 설계는 있으나 모든 액션에 미적용 |
| Dashboard RBAC (OWNER/ADMIN/REVIEWER/VIEWER) | 역할 정의됐으나 API 레이어 강제 미완성 |

---

## 요약

**핵심 완료**: 단일 멀티 페르소나 Strands Agent + KB 검색 + Risk Score 0-100 + DynamoDB GSI 수정 + CI/CD  
**가장 시급한 Gap**: Memory 연동 (#1), GitHub Check Run (#2), Incident 흐름 완성 (#4), Bedrock Agent 정리 (#6)
