# 사용자 흐름

## 전체 사용자 여정 개요

| 여정 | 사용자 | 채널 | 자동화 수준 |
|------|--------|------|------------|
| 온보딩 | 관리자 | Dashboard | 반자동 |
| PR 분석 | 개발자 + 리뷰어 | GitHub + Dashboard + Slack | 완전 자동 (분석) |
| 승인/거절 | 리뷰어 | Dashboard (주) + Slack (보조) | 수동 결정 |
| Fix PR | 리뷰어/관리자 | Dashboard | 반자동 |
| Incident 조사 | DevOps | Slack + Dashboard | 반자동 |

---

## Flow 1: 서비스 온보딩

### 1-1. 가입

```
사용자 접속: https://app.{domain}
  ↓
회원가입 클릭
  ↓
Cognito Hosted UI (이메일 + 비밀번호 입력)
  ↓
이메일 인증 코드 확인
  ↓
Organization 생성 (회사/팀 이름 입력)
  ↓
OWNER 역할로 Dashboard 접속
```

### 1-2. GitHub 연결

```
Dashboard → Settings → Integrations → GitHub
  ↓
GitHub App 설치 클릭
  ↓
GitHub OAuth 화면: 설치할 Organization/Account 선택
  ↓
접근 권한 검토 및 승인:
  - PR read
  - PR comment write
  - Check Run write
  - Repository write (Fix PR 생성용)
  ↓
Dashboard로 리다이렉트
  ↓
분석할 Repository 선택 (체크박스)
  ↓
Repository별 설정:
  - 분석 활성화 ON/OFF
  - 엄격 모드 (Strict / Advisory)
  - 머지 차단 임계치 (HIGH / CRITICAL)
  - 승인 필수 여부
  ↓
저장 완료 → 연결 성공 표시
```

### 1-3. Slack 연결 (선택)

```
Dashboard → Settings → Integrations → Slack
  ↓
Slack App 설치 클릭
  ↓
Slack OAuth: 워크스페이스 선택
  ↓
채널 선택: 알림 수신할 채널 (#devops-alerts)
  ↓
알림 설정:
  - 분석 완료 알림
  - HIGH 이상 리스크 알림
  - Incident 알림
  ↓
저장 완료
```

### 1-4. 팀원 초대

```
Dashboard → Settings → Members
  ↓
이메일 입력 + 역할 선택 (REVIEWER / VIEWER)
  ↓
초대 이메일 발송 (Cognito)
  ↓
팀원이 이메일 링크 클릭 → 가입 → 해당 Organization에 자동 연결
```

---

## Flow 2: PR 분석 (주요 흐름)

### 2-1. 자동 분석 시작

```
개발자: GitHub에 PR 생성 (또는 새 commit push)

GitHub → AgentOps Platform Webhook
  ↓
[github-connector Lambda]
  1. HMAC-SHA256 서명 검증
  2. PR 이벤트 파싱 (opened / synchronize)
  3. 중복 방지: idempotencyKey = {repoId}#{prNumber}#{commitSha}
  4. AnalysisJob 생성 (DynamoDB) → 상태: PENDING
  5. SQS analysis-queue 발행
  6. GitHub Check Run 생성 → "AgentOps: Analyzing..." (pending)
  7. 즉시 200 OK 반환

[lightweight-worker Lambda] (SQS 트리거)
  1. PR diff 조회 (GitHub API)
  2. S3 저장: diffs/{orgId}/{repoId}/pr-{prNumber}/{commitSha}.diff
  3. 변경 파일 분석 → 필요한 Reviewer 결정
  4. AgentCore Runtime 호출: Orchestrator Agent 실행
  5. Job 상태 → RUNNING
```

### 2-2. Agent 분석 실행

```
[Orchestrator Agent]
  1. AgentCore Memory 조회:
     - pr-{repoId}-{prNumber}: 기존 분석 이력
     - SUMMARY (actorId=repoId): 레포 과거 패턴
     - USER_PREFERENCES (actorId=prAuthorId): 개발자 패턴
  
  2. Security Agent 선실행:
     - PR diff에서 Prompt Injection 패턴 탐지
     - 위험 감지 시 → 즉시 BLOCK + 알림
  
  3. 병렬 Reviewer 실행 (subagent_tools):
     - paymentWebhook.ts → Code Reviewer + Security Agent
     - iam.tf            → Infra Reviewer + Security Agent
     - deploy.yml        → Infra Reviewer + Security Agent
     (모든 PR → Risk Reviewer 항상 실행)
  
  4. 결과 수집 및 병합
  5. Risk Score 산정 (Risk Reviewer)
  6. Report 생성
  
  [ddb_tools]
  7. DynamoDB: Report 저장
  8. DynamoDB: Finding 목록 저장
  9. S3: agent-outputs/{orgId}/{runId}/*.json 저장
  
  [AgentCore Memory]
  10. Session Memory 업데이트 (pr-{repoId}-{prNumber})
```

### 2-3. 결과 알림

```
[notification-worker Lambda]

GitHub:
  - Check Run 업데이트:
    - riskLevel=LOW:    ✅ success
    - riskLevel=MEDIUM: ✅ success (conditional)
    - riskLevel=HIGH:   ❌ failure
    - riskLevel=CRITICAL: ❌ failure
  
  - PR Comment 작성:
    ---
    ## AgentOps Analysis Report
    
    **Risk Score**: 84/100 🔴 HIGH
    **Recommendation**: BLOCK
    
    ### Top Findings
    | Severity | Agent | Title |
    |----------|-------|-------|
    | 🔴 HIGH | Infra Reviewer | Wildcard IAM permission |
    | 🔴 HIGH | Security Agent | Missing webhook signature validation |
    
    ### Required Actions
    1. Restrict IAM policy to specific actions and ARNs
    2. Add webhook signature validation
    
    [📊 View Full Report](https://app.{domain}/reports/01HN5X...)
    ---

Slack:
  - 설정된 채널에 알림 전송:
    🔴 *AgentOps Alert* — PR #27 위험 감지
    Repo: mzc-dev/api
    PR: Add payment webhook
    Risk: HIGH (84/100) | BLOCK 권고
    
    Top Issues:
    • IAM Wildcard permission
    • Missing webhook validation
    
    👉 <https://app.{domain}/reports/01HN5X...|전체 리포트 확인>
```

### 2-4. 대시보드에서 리포트 확인

```
리뷰어: Dashboard 접속 → PR Reports
  ↓
리포트 목록: NEEDS_REVIEW 상태 필터
  ↓
PR #27 클릭 → 리포트 상세
  ↓
화면 구성:
  ┌─────────────────────────────────────────┐
  │ PR #27 — Add payment webhook            │
  │ Risk Score: 84 | HIGH | BLOCK           │
  │                                         │
  │ [Approve] [Reject] [Request Fix] [Re-run]│
  ├─────────────────────────────────────────┤
  │ Findings (4개)                           │
  │ ● HIGH  IAM wildcard permission  [Fix ☑]│
  │ ● HIGH  Missing webhook validation [Fix ☑]│
  │ ● MEDIUM Missing test coverage           │
  │ ● INFO  Function name convention         │
  ├─────────────────────────────────────────┤
  │ Agent Summaries                          │
  │ Code: 테스트 누락...                     │
  │ Infra: IAM 과권한...                     │
  │ Security: Webhook 검증 누락...           │
  │ Risk: 결제 webhook + 과권한 IAM 조합...  │
  ├─────────────────────────────────────────┤
  │ Agent Runs (타임라인)                    │
  │ ✅ Orchestrator   12.5s  4200→1800 tokens│
  │ ✅ Code Reviewer   8.2s                  │
  │ ✅ Infra Reviewer  9.1s                  │
  │ ✅ Security Agent  6.8s                  │
  │ ✅ Risk Reviewer   3.2s                  │
  └─────────────────────────────────────────┘
```

---

## Flow 2b: 자동 머지 (리스크 임계값 이하)

```
분석 완료 (merge_recommendation = APPROVE / riskLevel = LOW)
  ↓
[Orchestrator] auto_merge_pr 호출
  1. org.approvalRequired 확인 → true 이면 스킵 (수동 승인 필수)
  2. org.riskThreshold 확인 — Settings 페이지에서 설정된 문자열 수준:
       NONE     → 자동 머지 없음 (threshold = -1)
       LOW      → risk_score < 20 일 때 자동 머지
       MEDIUM   → risk_score < 40 일 때 자동 머지
       HIGH     → risk_score < 75 일 때 자동 머지 (기본값)
       CRITICAL → 항상 자동 머지 (threshold = 100)
  3. risk_score ≤ threshold → GitHub PR 자동 머지
     PUT /repos/{owner}/{repo}/pulls/{prNumber}/merge
  4. 조건 불충족 시 → 스킵 (Slack 알림에서 /approve 안내)
```

> **구현 상세**: `riskThreshold`는 DDB Organizations 테이블에 문자열(`"HIGH"` 등)로 저장됨.  
> `tools/github_tools.py`의 `_threshold_map` dict로 숫자 비교값으로 변환:  
> `{"NONE": -1, "LOW": 19, "MEDIUM": 39, "HIGH": 74, "CRITICAL": 100}`

## Flow 3: 승인 / 거절

### 3-1. 승인 (Approve)

```
리뷰어: Dashboard → 리포트 상세 → [Approve] 클릭
  또는  Slack: /approve {reportId}
  ↓
[dashboard-api / lightweight-worker]
  1. DynamoDB: Report approvalStatus → APPROVED
  2. DynamoDB: Approval 레코드 생성
  3. SQS notification-queue 발행 (REVIEW_SUBMITTED / decision=APPROVED)
     ※ notification-queue는 표준 큐 — FIFO 파라미터 전달 금지

[notification-worker Lambda v11]
  1. GitHub PR 공식 리뷰 제출: event=APPROVE
     POST /repos/{owner}/{repo}/pulls/{prNumber}/reviews
  2. GitHub PR 머지: PUT /repos/{owner}/{repo}/pulls/{prNumber}/merge
     (405/422 = 브랜치 보호 규칙으로 머지 불가 시 경고 로그만, 에러 아님)
  3. Slack 알림 (채널 지정 시)

Dashboard: 리포트 상태 → APPROVED
```

### 3-2. 거절 (Reject)

```
리뷰어: Dashboard → [Reject] 클릭
  또는  Slack: /reject {reportId}
  ↓
거절 사유 입력 (선택):
  "IAM wildcard permission은 결제 서비스에서 머지 불가. 수정 후 재요청."
  ↓
확인 클릭
  ↓
[dashboard-api / lightweight-worker]
  1. DynamoDB: Report approvalStatus → REJECTED
  2. DynamoDB: Approval 레코드 생성 (comment 포함)
  3. SQS notification-queue 발행 (REVIEW_SUBMITTED / decision=REJECTED)

[notification-worker Lambda v11]
  1. GitHub PR 공식 리뷰 제출: event=REQUEST_CHANGES
     POST /repos/{owner}/{repo}/pulls/{prNumber}/reviews
  2. GitHub PR 닫기: PATCH /repos/{owner}/{repo}/pulls/{prNumber}  { state: 'closed' }
  3. Slack 알림 (채널 지정 시)

Dashboard: 리포트 상태 → REJECTED
```

### 3-3. Slack에서 빠른 승인

```
리뷰어: Slack에서 알림 수신
  ↓
/approve 01HN5X 입력 (reportId)
  ↓
[slack-connector Lambda]
  - 서명 검증
  - 권한 확인 (REVIEWER 이상)
  - approval-api Lambda 내부 호출
  ↓
Slack 응답: "✅ PR #27 승인 완료. 대시보드: {link}"
```

---

## Flow 4: Fix 요청 및 Fix PR 생성

### 4-1. Fix 요청

```
리뷰어: Dashboard → 리포트 상세
  ↓
수정할 Finding 선택 (체크박스):
  ☑ HIGH: IAM wildcard permission
  ☑ HIGH: Missing webhook signature validation
  ☐ MEDIUM: Missing test coverage  (선택 안 함)
  ↓
[Request Fix] 클릭
  ↓
확인 모달:
  "선택한 2개 항목에 대해 AI가 patch를 생성합니다.
   생성 후 미리보기를 확인하고 최종 승인하시면 Fix PR이 생성됩니다."
  ↓
[확인] 클릭
  ↓
[fix-api Lambda]
  1. 권한 확인 (ADMIN 이상)
  2. DynamoDB: FixRequest 생성 → 상태: PENDING
  3. SQS fix-queue 발행
  4. 즉시 응답: "Fix 생성 시작됨"

Dashboard: "Fix 생성 중..." 상태 표시
```

### 4-2. Fix 생성 (비동기)

```
[lightweight-worker Lambda] (SQS fix-queue 트리거)
  - FixRequest 확인
  - ECS Fargate RunTask 실행: heavy-worker

[heavy-worker (ECS Fargate)]
  1. PR 파일 현재 상태 조회 (pr_tools)
  2. Fix Agent (AgentCore Runtime) 호출

[Fix Agent]
  1. Finding별 patch 생성 (patch_generator)
     - iam.tf: wildcard 권한 → 구체적 Action + Resource ARN
     - webhook.ts: 서명 검증 로직 추가
  2. patch dry-run 검증 (dry_run_validator)
  3. repo_tools: lint/test 실행 (가능한 경우)
  4. S3에 patch 저장: patches/{orgId}/{fixId}/fix.patch
  5. DynamoDB: FixRequest 상태 → PREVIEW_READY

[notification-worker Lambda]
  - Dashboard에 Fix Preview 알림
  - Slack: "PR #27 Fix Preview 준비됨. 확인 후 Fix PR 생성해주세요."
```

### 4-3. Fix Preview 확인 및 승인

```
리뷰어: Dashboard → Fix Center → Fix #01HN5X... 클릭

Fix Preview 화면:
  ┌─────────────────────────────────────────┐
  │ Fix Preview — PR #27                    │
  │                                         │
  │ 변경 파일: infra/iam.tf                 │
  │ ─────────────────────────────────────── │
  │ - Action = ["dynamodb:*"]               │
  │ - Resource = "*"                        │
  │ + Action = [                            │
  │ +   "dynamodb:GetItem",                 │
  │ +   "dynamodb:PutItem"                  │
  │ + ]                                     │
  │ + Resource = aws_dynamodb_table.xxx.arn │
  │                                         │
  │ 변경 파일: src/api/paymentWebhook.ts    │
  │ ─────────────────────────────────────── │
  │ + function verifySignature(payload, sig) │
  │ + ...                                   │
  │                                         │
  │ Test Result: ✅ 24 passed / 0 failed    │
  │                                         │
  │ [Approve Fix & Create PR] [Reject Fix]  │
  └─────────────────────────────────────────┘

[Approve Fix & Create PR] 클릭
  ↓
Branch 이름 확인 (자동 생성):
  "pullpilot/fix/pr-27-iam-webhook"
  ↓
[fix-api Lambda]
  1. github_tools: branch 생성
  2. github_tools: 수정 파일 commit
  3. github_tools: Fix PR 생성
     Title: "fix: restrict IAM permissions and add webhook validation (auto-generated)"
     Body: 변경 근거, 원본 Finding 링크, 리뷰어 확인 체크리스트
  4. DynamoDB: FixRequest → PR_CREATED
  5. notification-worker 트리거

결과:
  GitHub Fix PR #28 생성 완료
  Dashboard: Fix PR 링크 표시
  Slack: "PR #27의 Fix PR #28이 생성되었습니다."
```

---

## Flow 5: Slack /investigate (Incident 조사)

### 5-1. 수동 조사 요청

```
DevOps 엔지니어: Slack에서 명령 입력
  /investigate prod-api 5xx spike
  ↓
[slack-connector Lambda]
  1. 서명 검증
  2. 명령 파싱: service=prod-api, issue=5xx spike
  3. IncidentJob 생성 (DynamoDB)
  4. SQS incident-queue 발행
  5. Slack 즉시 응답 (3초 이내):
     "🔍 prod-api 조사를 시작했습니다.
      완료되면 이 스레드에 결과를 알려드릴게요.
      대시보드: https://app.{domain}/incidents/01HN5X..."
```

### 5-2. Incident Agent 실행

```
[lightweight-worker Lambda] (SQS incident-queue 트리거)
  - IncidentJob 확인
  - AgentCore Runtime: Orchestrator → Incident Agent 실행

[DevOps Incident Agent]
  1. 조사 시간 범위 결정 (현재 시각 기준 -1시간)
  
  2. aws_observability_tools 병렬 조회:
     - CloudWatch Metrics:
       GET prod-api Lambda 에러율 (1시간)
       GET prod-api API Gateway 5xx 카운트
     - CloudWatch Logs Insights:
       "ERROR" 로그 패턴, 스택 트레이스
     - X-Ray Traces:
       최근 1시간 실패 트레이스
     - CloudTrail Events:
       최근 6시간 인프라 변경 이벤트
  
  3. github_tools:
     - 최근 6시간 내 merged PR 목록
     - 최근 배포 이벤트
  
  4. AgentCore Memory:
     - INCIDENT_SUMMARY (actorId=prod-api): 과거 유사 장애 패턴
  
  5. 상관 분석:
     배포 시점(14:02) ↔ 5xx 시작(14:03) → 상관관계 HIGH
     PR #27 (webhook validation 누락) ↔ 에러 패턴 → 일치
  
  6. RCA Report 생성 (마크다운)
  7. S3 저장: incidents/{orgId}/{incidentId}/rca.md
  8. DynamoDB: Incident 저장
  9. AgentCore Memory: INCIDENT_SUMMARY 업데이트
```

### 5-3. 결과 전달

```
[notification-worker Lambda]

Slack (스레드에 답변):
  📊 *prod-api Incident 조사 결과*

  **요약**: 14:02 배포 이후 5xx 급증. PR #27과 높은 상관관계.

  **타임라인**:
  • 14:00 — 배포 시작 (CloudTrail)
  • 14:02 — 배포 완료 (CloudTrail)
  • 14:03 — 5xx 급증 시작 (CloudWatch)
  • 14:05 — 에러율 15% 도달 (CloudWatch)

  **원인 후보** (신뢰도):
  1. PR #27 webhook validation 누락 (87%)
  2. 환경변수 누락 (43%)

  **권장 조치**:
  • PR #27 롤백 또는 즉시 hotfix

  **신뢰도**: 85%
  📋 <https://app.{domain}/incidents/01HN5X...|전체 RCA 리포트>

Dashboard: Incident Center에 신규 Incident 표시
```

---

## Flow 6: CloudWatch Alarm 기반 자동 Incident

```
prod-api Lambda 에러율 > 5% (5분 지속)
  ↓
CloudWatch Alarm → SNS
  ↓
EventBridge Rule (SNS → Custom Bus)
  ↓
[aws-event-connector Lambda]
  1. Alarm 상세 파싱
  2. IncidentJob 생성 (trigger: ALARM)
  3. SQS incident-queue 발행
  ↓
(이후 Flow 5와 동일)
```

사람이 Slack 명령을 치지 않아도 자동으로 조사가 시작된다.

---

## Dashboard 화면별 사용자 흐름

### Overview

```
접속 시 표시:
  - 최근 7일 분석된 PR 수
  - 위험 등급별 분포 (파이 차트)
  - 승인 대기 중인 리포트 수 (빠른 이동 링크)
  - 진행 중인 Fix 수
  - 최근 Incident 목록
  - Agent 성공률 및 평균 분석 시간
```

### PR Reports

```
기본 뷰: NEEDS_REVIEW 리포트 목록 (최신순)
  ↓
필터: 레포 / 위험 등급 / 승인 상태 / 날짜
  ↓
리포트 클릭 → 상세 보기
  ↓
Action 버튼: Approve / Reject / Request Fix / Re-run / View on GitHub
```

### Fix Center

```
기본 뷰: PREVIEW_READY 상태 Fix 목록
  ↓
Fix 클릭 → diff 미리보기
  ↓
파일별 변경 내역 확인
  ↓
Approve Fix → Create Fix PR
또는 Reject Fix → 재생성 요청
```

### Incident Center

```
기본 뷰: 최근 Incident 목록 (INVESTIGATING 우선)
  ↓
Incident 클릭 → 상세 보기
  ↓
- 타임라인 시각화
- 원인 후보 목록 (신뢰도)
- 관련 PR 링크
- 권장 조치
- RCA 리포트 다운로드
  ↓
상태 변경: INVESTIGATING → RESOLVED → CLOSED
```

### Agent Runs

```
기본 뷰: 최근 Agent 실행 목록
  ↓
필터: 에이전트 타입 / 상태 / 날짜
  ↓
실행 클릭 → 상세 보기
  ↓
- 실행 타임라인
- 토큰 사용량
- Tool 호출 기록 (input/output 포함)
- Raw Output 보기 (S3 링크)
- 실패 원인 (실패 시)
```

### Settings

```
탭 구성:
  - GitHub: 연결된 레포 목록, 레포별 설정
  - Slack: 연결된 워크스페이스, 알림 채널, 알림 조건
  - Members: 팀원 목록, 역할 변경, 초대
  - Policies: 조직 분석 정책, 위험 임계치
  - Agent: 프롬프트 버전, 모델 설정
  - Billing: 월간 사용량, 플랜
```

---

## 변경 이력

### 2026-06-17 — Flow 2 (PR 분석): 실제 구현 흐름 반영

**변경 내용**: Flow 2-1~2-3의 여러 세부 사항이 실제 구현과 다름.

**2-1 github-connector 변경**:
```
변경 전: SQS analysis-queue 발행 시 EventBridge 경유
변경 후: SQS aigo-analysis-queue.fifo에 직접 전송 (MessageGroupId=orgId, MessageDeduplicationId=idempotencyKey)
```

**2-2 Orchestrator 변경**:
```
변경 전: AgentCore Runtime 호출 + 병렬 subagent 실행 (Code/Infra/Security/Risk 각각 별도 Agent)
변경 후: lightweight-worker → Lambda.invoke(Event) → aigo-orchestrator Lambda (단일 Strands Agent, 페르소나 순차 전환)

변경 전: AgentCore Memory (Session/Repo Summary/User Pref) 조회
변경 후: DynamoDB aigo-AgentMemory 테이블 커스텀 Memory:
  - get_repo_memory(org_id, repo_id, limit=3)    ← 레포 과거 분석 이력
  - get_developer_memory(org_id, author, limit=5) ← 개발자 과거 패턴
  분석 완료 후: save_pr_analysis_memory(...)
```

**실제 Orchestrator 9+2 step 흐름**:
```
Step 0:  create_check_run → GitHub Check Run "pending"
Step 1:  get_repo_memory + get_developer_memory → 컨텍스트 로드
Step 2:  classify_personas(changedFiles) → 실행할 페르소나 결정
  (code 항상 / infra: .tf/.yaml 포함 시 / security: 순수.md PR 아닐 시 / risk: 순수.md PR 아닐 시)
Step 3:  Code Reviewer → search_coding_standards + 분석 → save_findings(agent_name="code-reviewer")
Step 4:  (infra 해당 시) Infra Reviewer → search_infrastructure_standards + 분석 → save_findings(agent_name="infra-reviewer")
Step 5:  Security Agent → search_security_standards + 분석 → save_findings(agent_name="security-agent")
Step 6:  Risk Reviewer → search_risk_policies + 분석 → save_findings(agent_name="risk-reviewer")
Step 7:  Risk Score 산출 → save_report(riskScore, riskLevel, mergeRecommendation, prContext)
Step 8:  update_check_run → GitHub Check Run 결과 반영
Step 9:  notify_analysis_complete → Slack 알림
Step 10: post_pr_comment → GitHub PR Comment
Step 10b: auto_merge_pr → org.approvalRequired=false + risk_score ≤ THRESHOLD_MAP[riskThreshold] 시 자동 머지
Step 11: save_pr_analysis_memory → 미래 분析 컨텍스트 저장
```

---

### 2026-06-17 — Flow 3 (승인/거절): 실제 흐름 반영

**변경 내용**: 승인/거절 플로우가 단순 상태 업데이트 + 알림으로 기술되어 있으나 실제는 GitHub PR 직접 조작.

**실제 Flow 3-1 (승인)**:
```
Dashboard [$ approve 버튼] 또는 Slack /approve {reportId}
  ↓
POST /reports/{reportId}/approve { decision: "APPROVED" }  (dashboard-api)
  ↓
[dashboard-api]:
  1. DDB Reports.approvalStatus → APPROVED
  2. DDB Approvals 레코드 생성
  3. SQS aigo-notification-queue (Standard) → REVIEW_SUBMITTED 메시지 전송
     (installationId, prUrl, decision 포함)
  ↓
[notification-worker v11]:
  1. GitHub App JWT 생성 (RSA-SHA256) → Installation Token 발급
  2. createPrReview(prUrl, 'APPROVE', body) → POST /repos/{owner}/{repo}/pulls/{n}/reviews
  3. mergePr(prUrl, creds, installationId)  → PUT /repos/{owner}/{repo}/pulls/{n}/merge
     (405/422: 브랜치 보호로 머지 불가 시 경고만 — 에러 아님)
```

**실제 Flow 3-2 (거절)**:
```
Dashboard [$ reject 버튼] 또는 Slack /reject {reportId}
  ↓
POST /reports/{reportId}/approve { decision: "REJECTED" }  (dashboard-api)
  ↓
[notification-worker v11]:
  1. createPrReview(prUrl, 'REQUEST_CHANGES', body) → GitHub PR Review 제출
  2. closePr(prUrl, creds, installationId)           → PATCH /repos/{owner}/{repo}/pulls/{n} { state: 'closed' }
```

**Slack /approve, /reject 경로**:
```
/approve {reportId} → slack-connector → aigo-command-queue.fifo → lightweight-worker
  → report 조회(orgId 파생) → DDB Approvals 생성 → SQS notification-queue → notification-worker
```

---

### 2026-06-18 — Flow 2b (자동 머지): riskThreshold 타입 변경

**변경 내용**: 설정 Flow에서 `riskThreshold`는 정수가 아닌 문자열 선택값.

```
Dashboard → Settings → 자동 머지 임계값 선택:
  NONE    → 자동 머지 완전 비활성
  LOW     → risk_score < 20 일 때만 자동 머지
  MEDIUM  → risk_score < 40 일 때 자동 머지
  HIGH    → risk_score < 75 일 때 자동 머지 (기본값)
  CRITICAL → 모든 PR 자동 머지
```

**편집 권한**: `approvalRequired = true`여도 ADMIN/OWNER는 `riskThreshold` 편집 가능 (2026-06-18 버그 수정).

