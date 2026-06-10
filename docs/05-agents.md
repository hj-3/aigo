# Agent 설계

## 개요

AgentCore Runtime + Strands Agents 기반 Multi-Agent 시스템이다.  
모든 Agent는 Claude Sonnet 4.x 모델을 사용하며, 프롬프트는 `prompts/v{n}/` 에서 버전 관리된다.

---

## Agent 구성 원칙

- **Orchestrator 중심**: 모든 외부 요청은 Orchestrator를 통해 진입한다
- **subagent_tools 경유**: Orchestrator는 `subagent_tools`를 통해서만 Reviewer를 호출한다. 직접 AgentCore 호출 금지
- **Tool 격리**: 각 Agent는 필요한 Tool만 허용된다. AgentCore Gateway가 강제
- **표준 Schema**: 모든 Reviewer의 출력은 Finding Schema를 따른다
- **Memory 의무**: 모든 Agent는 실행 전 Memory를 조회하고, 완료 후 Memory를 업데이트한다

---

## Orchestrator Agent

### 역할

모든 입력 요청의 시작점. 요청을 분류하고, Memory를 조회하며, 필요한 Reviewer를 선택하고, 결과를 병합한다.

### 입력 유형

| 유형 | 소스 | 처리 |
|------|------|------|
| `PR_ANALYSIS` | GitHub Webhook | Code + Infra + Security + Risk Reviewer |
| `REANALYSIS` | Dashboard 재실행 | 동일 PR 재분석 |
| `DASHBOARD_APPROVAL` | Dashboard | Approval 처리, Memory 업데이트 |
| `DASHBOARD_REJECTION` | Dashboard | Rejection 처리, GitHub Comment |
| `FIX_REQUEST` | Dashboard | Fix Agent 실행 |
| `SLACK_INVESTIGATE` | Slack `/investigate` | Incident Agent 실행 |
| `INCIDENT_INVESTIGATION` | CloudWatch Alarm | Incident Agent 실행 |
| `SECURITY_REVIEW` | 명시적 요청 | Security Agent 집중 실행 |

### 처리 흐름

```
1. 요청 유형 파악 (입력 payload 분석)
2. AgentCore Memory 조회
   - pr-{repo}-{number}: 기존 분석 이력
   - SUMMARY (actorId=repo): 레포 과거 요약
   - USER_PREFERENCES (actorId=developer): 개발자 패턴
3. 변경 파일 분석 → 필요한 Reviewer 결정
   - .tf / .yaml → Infra Reviewer 포함
   - src/**/*.ts|py → Code Reviewer 포함
   - 모든 PR → Security Agent + Risk Reviewer 항상 포함
4. subagent_tools로 병렬 Reviewer 실행
5. 결과 수집 및 병합
6. Risk Score 산정 (Risk Reviewer 결과 기반)
7. 최종 Report 포맷 생성
8. ddb_tools: Report / Finding 저장
9. Memory 업데이트
10. pr_tools: GitHub Comment / Check Run 업데이트
11. slack_tools: 알림 전송
```

### 허용 Tool

`subagent_tools`, `pr_tools`, `ddb_tools`, `slack_tools`, `kb_tools`

---

## Code Reviewer Agent

### 역할 (`detect: code`)

코드 품질, 로직, 버그 패턴, 테스트 커버리지를 분석한다.  
분석 시 `USER_PREFERENCES` Memory를 참조해 개발자 패턴을 반영한다.

### 입력

```json
{
  "pr_diff": "...",
  "changed_files": ["src/api/webhook.ts", "src/utils/validator.ts"],
  "repo_summary": "...",
  "developer_preference": "...",
  "test_policy": "커버리지 80% 이상 요구"
}
```

### 분석 항목

| 항목 | 상세 |
|------|------|
| 코드 품질 | 변수명, 함수 길이, 중복 코드, 복잡도 (Cyclomatic) |
| 버그 패턴 | null 체크 누락, 에러 처리 누락, 타입 불일치 |
| 로직 분석 | 경계 조건, 동시성 이슈, 무한 루프 가능성 |
| 테스트 커버리지 | 변경된 코드의 테스트 존재 여부, edge case 누락 |
| 개발자 패턴 | Memory의 USER_PREFERENCES 참조, 반복 실수 경고 |

### 출력

```json
{
  "findings": [{...Finding Schema...}],
  "test_gaps": ["validatePayload 함수에 null input 테스트 없음"],
  "complexity_risks": ["processWebhook 함수 복잡도 15 (권장 10 이하)"],
  "fixable_count": 3
}
```

### 허용 Tool

`pr_tools`, `kb_tools`, `ddb_tools`

---

## Infra Reviewer Agent

### 역할 (`detect: infra`)

인프라 변경, IaC 코드, CI/CD 파이프라인을 분석한다.  
AWS Best Practice KB를 참조해 검증한다.

### 입력

```json
{
  "changed_files": ["infra/iam.tf", "infra/main.tf", ".github/workflows/deploy.yml"],
  "terraform_diff": "...",
  "cfn_templates": "...",
  "aws_best_practice_context": "...",
  "org_infra_policy": "..."
}
```

### 분석 항목

| 항목 | 상세 |
|------|------|
| IAM | Wildcard 권한, 과도한 Resource 범위, 권한 상승 경로 |
| 리소스 설정 | 암호화 설정, 퍼블릭 노출, 태깅 정책 |
| 비용 영향 | 새 리소스 타입, 규모, 예상 비용 |
| IaC 검증 | Terraform 문법, 리소스 간 의존성, 상태 충돌 |
| CI/CD 분석 | 시크릿 노출, 과도한 권한, 공급망 위험 |

### 출력

```json
{
  "findings": [{...Finding Schema...}],
  "iam_risks": ["dynamodb:* on Resource:* in payment-role"],
  "cost_impact": {"estimated_monthly_usd": 45, "new_resources": ["aws_nat_gateway"]},
  "resource_risks": ["S3 버킷 퍼블릭 액세스 설정 누락"],
  "operational_risks": ["Multi-AZ 설정 없음"]
}
```

### 허용 Tool

`pr_tools`, `kb_tools`, `ddb_tools`, `aws_observability_tools`

---

## Risk Reviewer Agent

### 역할 (`detect: all`)

Code / Infra / Security Reviewer의 결과를 종합해 전체 Risk Score와 머지 가능 여부를 판단한다.

### 입력

```json
{
  "code_result": {...},
  "infra_result": {...},
  "security_result": {...},
  "repo_memory": "...",
  "incident_memory": "...",
  "org_policy": "..."
}
```

### Risk Score 계산 기준

| 구성 요소 | 가중치 |
|-----------|--------|
| Critical Finding 수 | 30% |
| High Finding 수 | 25% |
| 과거 유사 이슈 재발 | 20% |
| 변경 파일 위험도 | 15% |
| 테스트 커버리지 부족 | 10% |

### 머지 권고 기준

| 조건 | 권고 |
|------|------|
| Score 0–30 | `APPROVE` |
| Score 31–60 | `CONDITIONAL` (특정 항목 수정 권고) |
| Score 61–100 | `BLOCK` |
| Critical Finding 있음 | 무조건 `BLOCK` |

### 출력

```json
{
  "riskScore": 84,
  "riskLevel": "HIGH",
  "mergeRecommendation": "BLOCK",
  "summary": "...",
  "requiredActions": ["..."],
  "agentSummaries": {
    "code": "...",
    "infra": "...",
    "security": "...",
    "risk": "..."
  }
}
```

### 허용 Tool

`ddb_tools`, `kb_tools`

---

## Security Agent

### 역할

보안 취약점, 시크릿 노출, 의존성 위험, Prompt Injection을 탐지한다.  
**PR diff를 읽는 모든 Agent보다 먼저 실행된다.**

### 분석 항목

| 항목 | 상세 |
|------|------|
| Secret 탐지 | API 키, 토큰, 비밀번호, 인증서가 코드에 포함됐는지 |
| Prompt Injection | PR diff 내 Agent를 조작하려는 텍스트 탐지 |
| 의존성 위험 | 새로 추가된 패키지의 CVE, 공급망 위험 |
| IAM 권한 상승 | Role chaining, AssumeRole 남용 패턴 |
| 인증/인가 취약점 | SSRF, CORS misconfiguration, JWT 검증 누락 |
| Injection | SQL, Command, XSS 패턴 |
| Webhook 보안 | 서명 검증 누락, 타임스탬프 검증 누락 |

### Prompt Injection 방어

```
1. PR diff 내용을 원시 텍스트로 취급
2. "Ignore previous instructions", "SYSTEM:" 등 패턴 탐지
3. 의심 콘텐츠 발견 시 → 분석 중단, Security Finding 생성, 알림
4. Bedrock Guardrails 동시 적용 (PII 필터, 금지 주제)
```

### 허용 Tool

`pr_tools`, `kb_tools`, `ddb_tools`

---

## DevOps Incident Agent

### 역할 (`incident 조사`)

AWS 운영 데이터를 조회해 장애 원인을 분석하고 RCA 리포트를 생성한다.

### 입력

```json
{
  "incidentId": "01HN5X...",
  "serviceId": "prod-api",
  "timeWindow": {
    "start": "2026-06-09T14:00:00Z",
    "end": "2026-06-09T15:00:00Z"
  },
  "alarmDetail": {...},
  "trigger": "ALARM"
}
```

### 분석 흐름

```
1. aws_observability_tools로 데이터 수집
   ├── CloudWatch Metrics: 에러율, 레이턴시, 처리량
   ├── CloudWatch Logs: 에러 로그, 스택 트레이스
   ├── X-Ray Traces: 요청별 병목, 실패 서비스
   └── CloudTrail Events: 최근 설정 변경

2. github_tools로 변경 이력 수집
   ├── 타임윈도우 내 머지된 PR 목록
   └── 최근 배포 이벤트

3. AgentCore Memory 조회
   └── INCIDENT_SUMMARY (actorId=serviceId): 과거 유사 장애

4. 상관 분석
   - 배포 시점 ↔ 장애 시작 시점 상관관계
   - 로그 에러 패턴 ↔ 코드 변경 연결

5. RCA Report 생성 (마크다운)
6. S3 저장, DynamoDB Incident 저장
7. Memory 업데이트
```

### 출력

```json
{
  "incidentSummary": "prod-api 5xx 급증, 14:02 배포 이후 시작",
  "timeline": [
    {"time": "14:00", "event": "배포 시작", "source": "CloudTrail"},
    {"time": "14:02", "event": "배포 완료", "source": "CloudTrail"},
    {"time": "14:03", "event": "5xx 급증 시작", "source": "CloudWatch"}
  ],
  "suspectedRootCauses": [
    {"cause": "PR #27 webhook validation 누락", "confidence": 0.87},
    {"cause": "환경변수 누락", "confidence": 0.43}
  ],
  "relatedChanges": ["PR #27 (14:00 배포)"],
  "blastRadius": "prod-api 전체, payment 연동 서비스",
  "recommendedActions": ["PR #27 롤백 또는 즉시 hotfix"],
  "rollbackSuggestion": "git revert {commitSha}",
  "confidence": 0.85
}
```

### 허용 Tool

`aws_observability_tools`, `github_tools`, `ddb_tools`, `slack_tools`, `kb_tools`

---

## Fix Agent

### 역할

사용자가 승인한 Finding에 대해 patch를 생성하고, Fix PR을 만든다.  
**승인된 Finding만 처리한다. 미승인 자동 실행 금지.**

### 처리 흐름

```
1. FixRequest 수신 (승인된 findingIds 목록 포함)
2. pr_tools: 현재 PR의 파일 상태 조회
3. patch_generator: Finding별 수정 코드 생성
4. dry_run_validator: patch 적용 시뮬레이션
5. repo_tools: 가능한 경우 테스트/린트 실행
6. S3에 patch 저장
7. Dashboard Fix Preview 생성
8. 사용자 승인 대기

--- 사용자가 "Create Fix PR" 클릭 시 ---

9. github_tools: 새 branch 생성
   Branch 이름: pullpilot/fix/pr-{prNumber}-{category}
10. github_tools: 수정 파일 commit
11. github_tools: Fix PR 생성
    - Title: "fix: {Finding 요약} (auto-generated)"
    - Body: 변경 근거, 원본 Finding 링크
12. DynamoDB FixRequest 상태 업데이트
13. Dashboard / Slack / GitHub 알림
```

### 절대 금지 사항

```
❌ terraform apply
❌ kubectl apply
❌ AWS 운영 리소스 직접 수정
❌ main / master 브랜치 직접 push
❌ 사용자 승인 없는 commit
❌ AWS 자격증명을 직접 보유 (Tool을 통해서만 접근)
```

### 허용 Tool

`pr_tools`, `patch_tools`, `repo_tools`, `github_tools`, `ddb_tools`, `slack_tools`

---

## AgentCore Memory 구조

### Session Memory (단기)

```
Key:    pr-{repoId}-{prNumber}
Scope:  현재 PR 분석 세션
TTL:    PR 완료 후 7일

저장 내용:
- 현재 PR 원시 대화 로그
- Agent별 중간 결과
- 사용자 승인/거절 코멘트
- Fix 요청 내역
- Slack/Dashboard 명령 흐름
```

### Repo Summary Memory (장기)

```
Key:    SUMMARY
actorId: {repoId}
TTL:    없음 (계속 누적)

저장 내용:
- 같은 레포 과거 PR 분석 요약 (누적)
- 반복적으로 발생하는 인프라 위험 패턴
- 반복적으로 발생하는 코드 결함 패턴
- 장애와 연결된 과거 변경 이력
- 테스트/배포 정책 변경 이력
```

### User Preference Memory (장기)

```
Key:    USER_PREFERENCES
actorId: {userId} 또는 {gitUsername}
TTL:    없음

저장 내용:
- 개발자별 반복적으로 관찰된 개선 포인트
- 자주 놓치는 테스트 유형
- 선호하는 리뷰 형식 (상세 vs 요약)
- 과거 승인/거절 패턴

※ 사용자에게 표시 시 "반복 개선 포인트"로 표현 (부정적 레이블 금지)
```

### Incident Memory (장기)

```
Key:    INCIDENT_SUMMARY
actorId: {serviceId}
TTL:    없음

저장 내용:
- 과거 장애 요약 및 원인
- 관련 PR / 배포 이벤트
- 복구 방법 및 소요 시간
- 재발 방지 조치 이행 여부
- 패턴: "배포 직후 5xx" 같은 재발 패턴
```

---

## MCP Tool 구성

### pr_tools

| Tool | 설명 |
|------|------|
| `get_pr` | PR 메타데이터 조회 |
| `get_pr_files` | 변경 파일 목록 조회 |
| `get_pr_diff` | PR diff 조회 |
| `get_pr_patch` | 파일별 patch 내용 조회 |
| `create_pr_comment` | PR에 분석 결과 Comment 작성 |
| `create_check_run` | GitHub Check Run 생성 |
| `update_check_run` | Check Run 상태 업데이트 |
| `create_review_thread` | 특정 라인에 Review Comment 생성 |

### kb_tools

| Tool | 설명 |
|------|------|
| `search_aws_best_practice` | AWS 모범 사례 벡터 검색 |
| `search_org_policy` | 조직 정책 검색 |
| `search_security_policy` | 보안 정책 검색 |
| `search_previous_incidents` | 과거 장애 패턴 검색 |
| `search_iac_patterns` | IaC 패턴 검색 |

### subagent_tools

| Tool | 설명 |
|------|------|
| `run_code_reviewer` | Code Reviewer Agent 실행 |
| `run_infra_reviewer` | Infra Reviewer Agent 실행 |
| `run_risk_reviewer` | Risk Reviewer Agent 실행 |
| `run_security_agent` | Security Agent 실행 |
| `run_incident_agent` | Incident Agent 실행 |
| `run_fix_agent` | Fix Agent 실행 |

### ddb_tools

| Tool | 설명 |
|------|------|
| `save_job` | AnalysisJob 저장 |
| `update_job_status` | Job 상태 업데이트 |
| `save_report` | Report 저장 |
| `save_findings` | Finding 목록 저장 |
| `save_approval` | Approval 기록 저장 |
| `save_audit_log` | AuditLog 기록 |
| `get_report` | Report 조회 |
| `get_repo_config` | 레포 설정 조회 |

### slack_tools

| Tool | 설명 |
|------|------|
| `send_report` | 분석 완료 리포트 전송 |
| `send_high_risk_alert` | High/Critical 리스크 즉시 알림 |
| `send_incident_summary` | Incident 요약 Slack 스레드 전송 |
| `send_fix_ready` | Fix Preview 준비 알림 |
| `send_dashboard_link` | 대시보드 링크 전송 |

### github_tools

| Tool | 설명 |
|------|------|
| `create_branch` | Fix 브랜치 생성 |
| `commit_files` | 수정 파일 커밋 |
| `create_fix_pr` | Fix PR 생성 |
| `compare_commits` | 커밋 간 비교 |
| `get_workflow_runs` | GitHub Actions 실행 이력 조회 |
| `get_deployments` | 배포 이벤트 조회 |

### aws_observability_tools

| Tool | 설명 |
|------|------|
| `query_cloudwatch_logs` | Logs Insights 쿼리 실행 |
| `get_cloudwatch_metrics` | 메트릭 데이터 조회 |
| `get_xray_traces` | X-Ray 트레이스 조회 |
| `lookup_cloudtrail_events` | CloudTrail 이벤트 조회 |
| `get_recent_alarms` | 최근 알람 목록 조회 |
| `get_service_health` | 서비스 상태 요약 |

### repo_tools

| Tool | 설명 |
|------|------|
| `clone_repo` | 레포 clone (ECS Fargate 실행) |
| `checkout_pr` | PR 브랜치 checkout |
| `apply_patch` | patch 적용 |
| `run_tests` | 테스트 실행 |
| `run_lint` | lint 실행 |
| `run_static_analysis` | 정적 분석 실행 |

### patch_tools

| Tool | 설명 |
|------|------|
| `generate_patch_preview` | patch diff 미리보기 생성 |

---

## Agent별 허용 Tool 매트릭스

| Agent | pr | kb | subagent | ddb | slack | github | observability | repo | patch |
|-------|----|----|----------|-----|-------|--------|---------------|------|-------|
| Orchestrator | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Code Reviewer | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Infra Reviewer | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Risk Reviewer | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Security Agent | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Incident Agent | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Fix Agent | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |

**AgentCore Gateway가 이 매트릭스를 강제한다. 허용되지 않은 Tool 호출 시 즉시 거부.**
