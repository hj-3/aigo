# Phase 5: MCP Gateway Tools

## 개요
에이전트가 외부 시스템과 상호작용하는 9개 도구 그룹 구현 (Python, Strands @tool 데코레이터).

## 도구 그룹

### 1. pr_tools.py
에이전트가 PR diff와 파일 내용을 읽는 도구.

| 도구 | 설명 |
|------|------|
| `get_diff_content(diff_s3_key)` | S3에서 PR diff 내용 조회 |
| `get_file_content(repo_id, commit_sha, file_path)` | S3 artifacts에서 특정 파일 내용 조회 |

### 2. kb_tools.py
Bedrock Knowledge Base 검색 도구.

| 도구 | 설명 |
|------|------|
| `search_coding_standards(query)` | 코딩 표준 KB 검색 |
| `search_infrastructure_standards(query)` | 인프라 AWS Well-Architected 검색 |
| `search_security_standards(query)` | 보안 정책 검색 |
| `search_risk_policies(query)` | 리스크 관리 정책 검색 |

**구현:** Bedrock Knowledge Base Retrieve API, 카테고리 필터

### 3. ddb_tools.py
DynamoDB 읽기/쓰기 도구.

| 도구 | 설명 |
|------|------|
| `save_findings(job_id, agent_name, findings)` | 발견사항 저장 |
| `save_report(job_id, org_id, repo_id, risk_level, merge_recommendation, summary, findings_by_severity, risk_score, report_s3_key)` | 리포트 저장 + AnalysisJob COMPLETED 상태 업데이트 (`risk_score` 0-100 포함) |
| `update_job_status(job_id, status, error_message)` | 작업 상태 변경 |
| `update_incident(incident_id, status, root_cause, ...)` | 인시던트 업데이트 |
| `update_fix_request(fix_id, status, patch_s3_key, ...)` | Fix 요청 업데이트 |
| `get_findings_for_report(report_id)` | 리포트의 발견사항 조회 |

### 4. slack_tools.py
Slack 알림 도구 (Bot Token, Secrets Manager).

| 도구 | 설명 |
|------|------|
| `notify_analysis_complete(...)` | PR 분석 완료 알림 (리스크 수준, 발견사항 수, 대시보드 링크) |
| `send_incident_update(...)` | 인시던트 상태 업데이트 (oncall 채널) |

**Slack Block Kit** 사용으로 구조화된 메시지 전송.

### 5. github_tools.py
GitHub PR 댓글 및 commit status 도구.

| 도구 | 설명 |
|------|------|
| `post_pr_comment(...)` | PR에 분석 결과 댓글 게시 |
| `set_commit_status(...)` | GitHub commit status check 설정 |

**인증:** GitHub App Installation Token (JWT → access_token 교환)

### 6. aws_observability_tools.py
Incident Agent용 AWS 관측성 도구.

| 도구 | 설명 |
|------|------|
| `get_cloudwatch_metrics(...)` | CloudWatch 메트릭 통계 |
| `get_cloudwatch_logs(...)` | CloudWatch Logs Insights 쿼리 |
| `get_xray_traces(...)` | X-Ray 추적 조회 |
| `get_related_alarms(...)` | 연관 CloudWatch 알람 찾기 |
| `get_resource_config(...)` | AWS Config에서 리소스 구성 조회 |

### 7. repo_tools.py
리포지토리 메타데이터 도구.

| 도구 | 설명 |
|------|------|
| `get_dependency_graph(repo_id, commit_sha)` | 의존성 그래프 (Impact 분석) |
| `get_api_schema(repo_id, commit_sha)` | OpenAPI/GraphQL 스키마 |
| `get_recent_deployments(repo_id, limit)` | 최근 배포 이력 |

### 8. patch_tools.py
Fix Agent용 패치 생성/저장 도구.

| 도구 | 설명 |
|------|------|
| `validate_patch_syntax(patch_content)` | unified diff 문법 검증 (임시 git repo) |
| `save_patch(fix_id, org_id, repo_id, patch_content, description)` | 검증 후 S3 저장 |
| `list_patches_for_fix(fix_id, org_id, repo_id)` | Fix의 모든 패치 목록 |

### 9. subagent_tools.py
Orchestrator가 전문 Frontier Agent를 호출하는 도구.  
Code/Infra/Risk/Security 분석은 Orchestrator가 직접 수행하므로 해당 도구는 제거됨.

| 도구 | 설명 |
|------|------|
| `invoke_devops_agent(incident_context_json)` | DevOps Incident Agent 호출 (인시던트 RCA 조사) |

**구현:** Bedrock AgentRuntime InvokeAgent API (스트리밍 응답 수집)

> **변경 이유**: 4개 서브에이전트(Code/Infra/Risk/Security) InvokeAgent 패턴 → Orchestrator 멀티 페르소나로 통합 (2026-06-12)

## 공통 설계

### 도구 격리 원칙
에이전트는 반드시 이 도구들을 통해서만 외부 시스템 접근.
직접 boto3/httpx 호출 금지.

### 에러 처리
- 도구 실패 시 에러 메시지 문자열 반환 (예외 전파 안 함)
- 에이전트가 에러를 인식하고 대안 행동 가능

### 반환 형식
- 대부분 JSON 문자열 반환 (LLM이 파싱 용이)
- 확인 메시지는 간단한 문자열
