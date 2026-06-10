# 프로젝트 디렉토리 구조

## 설계 원칙

- **혼합 언어 모노레포**: TypeScript(커넥터·API·대시보드)와 Python(Agent·Tool·Worker)이 단일 레포에 공존
- **패키지 매니저 분리**: TypeScript는 `pnpm workspace`, Python은 `uv workspace`
- **도메인 기준 분리**: 기술 계층이 아닌 도메인(connectors / agents / tools / workers)으로 구조화
- **공유 코드 명시화**: `packages/` (TS 공유) · `libs/` (Python 공유)로 중복 방지
- **Connector 확장성**: 향후 GitLab, Bitbucket, Jira, PagerDuty 추가 시 `connectors/` 하위에 추가

---

## 전체 구조

```
aigo/
│
├── .github/
│   ├── workflows/
│   │   ├── ci-infra.yml              # Terraform fmt / validate / plan / Checkov
│   │   ├── ci-dashboard.yml          # React lint / test / build
│   │   ├── ci-api.yml                # Lambda TS lint / test / build
│   │   ├── ci-agents.yml             # Python ruff / pytest / package
│   │   ├── ci-tools.yml              # MCP Tools ruff / pytest / package
│   │   ├── cd-deploy.yml             # 태그 기반 프로덕션 배포 (수동 승인)
│   │   └── cd-hotfix.yml             # hotfix/* 브랜치 긴급 배포
│   ├── CODEOWNERS                    # 컴포넌트별 리뷰어 지정
│   └── pull_request_template.md
│
├── apps/
│   ├── dashboard/                    # React 18 + TypeScript SPA
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   │   ├── Overview/
│   │   │   │   ├── Reports/
│   │   │   │   │   ├── ReportList.tsx
│   │   │   │   │   └── ReportDetail.tsx
│   │   │   │   ├── FixCenter/
│   │   │   │   ├── IncidentCenter/
│   │   │   │   ├── AgentRuns/
│   │   │   │   └── Settings/
│   │   │   ├── components/           # 공유 UI 컴포넌트
│   │   │   │   ├── FindingCard/
│   │   │   │   ├── RiskBadge/
│   │   │   │   ├── DiffViewer/
│   │   │   │   └── AgentTimeline/
│   │   │   ├── hooks/                # TanStack Query hooks
│   │   │   ├── stores/               # Zustand 전역 상태
│   │   │   ├── api/                  # API 클라이언트 (타입드)
│   │   │   └── types/                # 로컬 타입 (packages/types 참조)
│   │   ├── public/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── dashboard-api/                # TypeScript Lambda — 대시보드 REST API
│       ├── src/
│       │   ├── handlers/
│       │   │   ├── approval.ts       # POST /reports/{id}/approve|reject
│       │   │   ├── fix.ts            # POST /reports/{id}/fix, GET /fixes/{id}
│       │   │   ├── reports.ts        # GET /reports, GET /reports/{id}
│       │   │   ├── jobs.ts           # GET /jobs, GET /jobs/{id}
│       │   │   ├── incidents.ts      # GET /incidents, GET /incidents/{id}
│       │   │   ├── settings.ts       # GET/PUT /settings
│       │   │   └── agent-runs.ts     # GET /agent-runs
│       │   ├── services/             # 비즈니스 로직
│       │   ├── repositories/         # DynamoDB 접근 계층
│       │   └── middleware/           # auth, validation, error handler
│       ├── tsconfig.json
│       └── package.json
│
├── connectors/                       # 외부 이벤트 수신 Lambda (TypeScript)
│   ├── github/
│   │   ├── src/
│   │   │   ├── handler.ts            # Lambda 진입점
│   │   │   ├── verifier.ts           # HMAC-SHA256 서명 검증
│   │   │   ├── event-parser.ts       # PR 이벤트 파싱
│   │   │   └── job-publisher.ts      # SQS analysis-queue 발행
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── slack/
│   │   ├── src/
│   │   │   ├── handler.ts
│   │   │   ├── verifier.ts           # Slack 서명 검증
│   │   │   ├── command-parser.ts     # /approve /reject /investigate 파싱
│   │   │   └── job-publisher.ts      # SQS command-queue 발행
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── dashboard-cmd/
│   │   ├── src/
│   │   │   ├── handler.ts
│   │   │   └── job-publisher.ts
│   │   └── package.json
│   │
│   └── aws-event/
│       ├── src/
│       │   ├── handler.ts
│       │   ├── alarm-parser.ts       # CloudWatch Alarm 파싱
│       │   └── job-publisher.ts      # SQS incident-queue 발행
│       └── package.json
│
├── agents/                           # Python Strands Agents (AgentCore Runtime)
│   ├── orchestrator/
│   │   ├── agent.py                  # Strands Agent 정의
│   │   ├── router.py                 # 요청 유형 분류 (PR_ANALYSIS / INCIDENT / FIX ...)
│   │   ├── merger.py                 # Reviewer 결과 병합, Risk Score 산정
│   │   ├── memory_client.py          # AgentCore Memory SDK 래핑
│   │   ├── pyproject.toml
│   │   └── tests/
│   │       ├── test_router.py
│   │       └── test_merger.py
│   │
│   ├── code-reviewer/
│   │   ├── agent.py
│   │   ├── analyzer.py               # 코드 품질, 버그 패턴, 복잡도 분석
│   │   ├── pyproject.toml
│   │   └── tests/
│   │
│   ├── infra-reviewer/
│   │   ├── agent.py
│   │   ├── iac_analyzer.py           # Terraform / CFN / SAM 분석
│   │   ├── iam_analyzer.py           # IAM 권한 분석
│   │   ├── pyproject.toml
│   │   └── tests/
│   │
│   ├── risk-reviewer/
│   │   ├── agent.py
│   │   ├── scorer.py                 # Risk Score 계산
│   │   ├── merge_evaluator.py        # merge 가능 여부 판단
│   │   ├── pyproject.toml
│   │   └── tests/
│   │
│   ├── security-agent/
│   │   ├── agent.py
│   │   ├── secret_detector.py        # secret 노출 탐지
│   │   ├── injection_guard.py        # prompt injection 방어
│   │   ├── dep_analyzer.py           # 의존성 위험 분석
│   │   ├── pyproject.toml
│   │   └── tests/
│   │
│   ├── incident-agent/
│   │   ├── agent.py
│   │   ├── timeline_builder.py       # 장애 타임라인 재구성
│   │   ├── rca_generator.py          # 근본 원인 추론
│   │   ├── correlation.py            # 변경-장애 상관 분석
│   │   ├── pyproject.toml
│   │   └── tests/
│   │
│   └── fix-agent/
│       ├── agent.py
│       ├── patch_generator.py        # Finding 기반 patch 생성
│       ├── dry_run_validator.py      # patch 적용 dry-run 검증
│       ├── sandbox.py                # 격리 실행 환경
│       ├── pyproject.toml
│       └── tests/
│
├── tools/                            # MCP Tool 구현 (Python Lambda)
│   ├── pr-tools/
│   │   ├── src/
│   │   │   ├── handler.py
│   │   │   ├── get_pr.py
│   │   │   ├── get_pr_diff.py
│   │   │   ├── create_pr_comment.py
│   │   │   └── manage_check_run.py
│   │   └── pyproject.toml
│   │
│   ├── kb-tools/
│   │   ├── src/
│   │   │   ├── handler.py
│   │   │   ├── search_aws_best_practice.py
│   │   │   ├── search_org_policy.py
│   │   │   └── search_previous_incidents.py
│   │   └── pyproject.toml
│   │
│   ├── subagent-tools/               # Orchestrator → Reviewer 호출 중계
│   │   ├── src/
│   │   │   ├── handler.py
│   │   │   └── invoker.py
│   │   └── pyproject.toml
│   │
│   ├── ddb-tools/
│   │   ├── src/
│   │   │   ├── handler.py
│   │   │   ├── job_repository.py
│   │   │   ├── report_repository.py
│   │   │   └── audit_logger.py
│   │   └── pyproject.toml
│   │
│   ├── slack-tools/
│   │   ├── src/
│   │   │   ├── handler.py
│   │   │   ├── send_report.py
│   │   │   └── send_alert.py
│   │   └── pyproject.toml
│   │
│   ├── github-tools/
│   │   ├── src/
│   │   │   ├── handler.py
│   │   │   ├── create_branch.py
│   │   │   ├── commit_files.py
│   │   │   └── create_fix_pr.py
│   │   └── pyproject.toml
│   │
│   ├── aws-observability-tools/
│   │   ├── src/
│   │   │   ├── handler.py
│   │   │   ├── cloudwatch.py
│   │   │   ├── xray.py
│   │   │   └── cloudtrail.py
│   │   └── pyproject.toml
│   │
│   ├── repo-tools/
│   │   ├── src/
│   │   │   ├── handler.py
│   │   │   ├── clone_repo.py
│   │   │   ├── run_tests.py
│   │   │   └── run_lint.py
│   │   └── pyproject.toml
│   │
│   └── patch-tools/
│       ├── src/
│       │   ├── handler.py
│       │   └── generate_patch_preview.py
│       └── pyproject.toml
│
├── workers/
│   ├── lightweight/                  # TypeScript Lambda — SQS consumer
│   │   ├── src/
│   │   │   ├── handler.ts            # SQS 이벤트 진입점
│   │   │   ├── dispatcher.ts         # Job 유형별 라우팅
│   │   │   ├── pr-diff-fetcher.ts    # GitHub PR diff 조회 → S3 저장
│   │   │   └── fargate-launcher.ts   # ECS RunTask 트리거
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── heavy/                        # Python ECS Fargate container
│       ├── src/
│       │   ├── main.py               # SQS 메시지 수신 진입점
│       │   ├── tasks/
│       │   │   ├── clone_task.py
│       │   │   ├── test_task.py
│       │   │   ├── lint_task.py
│       │   │   ├── patch_task.py
│       │   │   └── analyze_task.py
│       │   └── runner.py             # Task 실행 오케스트레이터
│       ├── Dockerfile
│       └── pyproject.toml
│
├── packages/                         # TypeScript 공유 패키지 (pnpm workspace)
│   ├── types/
│   │   ├── src/
│   │   │   ├── finding.ts            # Finding, Report, Job 타입
│   │   │   ├── agent.ts              # AgentRun, AgentType 타입
│   │   │   └── api.ts                # API 요청/응답 타입
│   │   └── package.json
│   │
│   ├── aws-clients/
│   │   ├── src/
│   │   │   ├── dynamodb.ts           # DynamoDB Document Client 팩토리
│   │   │   ├── s3.ts                 # S3 Client 팩토리
│   │   │   └── sqs.ts                # SQS Client 팩토리
│   │   └── package.json
│   │
│   └── logger/
│       ├── src/
│       │   └── index.ts              # Powertools Logger 래핑
│       └── package.json
│
├── libs/                             # Python 공유 라이브러리 (uv workspace)
│   ├── common/
│   │   ├── aigo_common/
│   │   │   ├── ids.py                # ULID 생성
│   │   │   ├── timestamps.py
│   │   │   └── exceptions.py
│   │   └── pyproject.toml
│   │
│   ├── aws-utils/
│   │   ├── aigo_aws/
│   │   │   ├── dynamodb.py           # DynamoDB 헬퍼
│   │   │   ├── s3.py
│   │   │   ├── secrets.py            # Secrets Manager 헬퍼
│   │   │   └── sqs.py
│   │   └── pyproject.toml
│   │
│   └── finding-schema/
│       ├── aigo_schema/
│       │   ├── finding.py            # Finding Pydantic 모델
│       │   ├── report.py             # Report Pydantic 모델
│       │   └── incident.py           # Incident Pydantic 모델
│       └── pyproject.toml
│
├── prompts/                          # Agent 시스템 프롬프트 (버전 관리)
│   ├── v1/
│   │   ├── orchestrator.md
│   │   ├── code-reviewer.md
│   │   ├── infra-reviewer.md
│   │   ├── risk-reviewer.md
│   │   ├── security-agent.md
│   │   ├── incident-agent.md
│   │   └── fix-agent.md
│   └── current -> v1                 # symlink: 현재 활성 버전
│
├── infra/
│   └── terraform/
│       ├── modules/
│       │   ├── network/              # VPC, 서브넷, IGW, 라우팅 테이블
│       │   ├── vpc-endpoints/        # Gateway + Interface Endpoint
│       │   ├── nat/                  # NAT Gateway (AZ당 1개)
│       │   ├── frontend/             # S3 + CloudFront + ACM + Route53
│       │   ├── auth/                 # Cognito User Pool + App Client
│       │   ├── api-gateway/          # HTTP API + routes + JWT authorizer
│       │   ├── lambda/               # Lambda 함수 공통 모듈 (재사용)
│       │   ├── ecs-fargate/          # ECS Cluster + Task Definition + IAM
│       │   ├── dynamodb/             # DynamoDB 테이블 (GSI 포함)
│       │   ├── s3/                   # S3 버킷 + lifecycle + encryption
│       │   ├── sqs/                  # SQS 큐 + DLQ + 알람
│       │   ├── eventbridge/          # Custom Bus + Rules + Targets
│       │   ├── kms/                  # KMS Key per 서비스
│       │   ├── secrets/              # Secrets Manager + rotation
│       │   ├── waf/                  # WAF ACL (CloudFront + APIGW)
│       │   ├── monitoring/           # CloudWatch Dashboard + Alarms
│       │   ├── security/             # GuardDuty + Security Hub + Config
│       │   ├── backup/               # AWS Backup + S3 CRR
│       │   └── agentcore/            # AgentCore Runtime + Memory + Gateway
│       │
│       ├── envs/
│       │   └── prod/
│       │       ├── main.tf
│       │       ├── variables.tf
│       │       └── terraform.tfvars  # 환경 변수 (비밀값은 Secrets Manager)
│       │
│       └── global/                   # Terraform 상태 백엔드 설정
│           ├── backend.tf            # S3 + DynamoDB Lock
│           └── oidc.tf               # GitHub Actions OIDC Provider
│
├── scripts/
│   ├── setup.sh                      # 로컬 개발 환경 초기 설정
│   ├── deploy-agent.sh               # AgentCore Agent 수동 배포
│   ├── seed-kb.sh                    # Knowledge Base 초기 문서 적재
│   └── rotate-secrets.sh             # Secret 수동 로테이션 (긴급 시)
│
├── docs/                             # 이 문서들
│   ├── 00-overview.md
│   ├── 01-architecture.md
│   ├── 02-directory-structure.md
│   ├── 03-data-model.md
│   ├── 04-infrastructure.md
│   ├── 05-agents.md
│   ├── 06-api-design.md
│   ├── 07-cicd.md
│   ├── 08-security.md
│   ├── 09-tech-stack.md
│   ├── 10-disaster-recovery.md
│   ├── 11-user-flows.md
│   └── adr/
│       ├── 001-monorepo.md
│       ├── 002-multitable-dynamo.md
│       └── 003-ecs-runtask.md
│
├── package.json                      # pnpm workspace root
├── pnpm-workspace.yaml
├── pyproject.toml                    # uv workspace root
└── .env.example                      # 필요한 환경변수 목록 (값 없음)
```

---

## 패키지 매니저 설정

### pnpm-workspace.yaml

```yaml
packages:
  - "apps/*"
  - "connectors/*"
  - "workers/lightweight"
  - "packages/*"
```

### pyproject.toml (uv workspace root)

```toml
[tool.uv.workspace]
members = [
  "agents/*",
  "tools/*",
  "workers/heavy",
  "libs/*",
]
```

---

## 컴포넌트별 언어 선택 기준

| 컴포넌트 | 언어 | 이유 |
|----------|------|------|
| Dashboard | TypeScript (React) | UI 생태계, 타입 안전성 |
| Dashboard API Lambda | TypeScript | 빠른 콜드스타트, 타입 공유 |
| Connectors Lambda | TypeScript | 빠른 콜드스타트, 검증 로직 |
| Lightweight Worker Lambda | TypeScript | 빠른 콜드스타트 |
| Agents (AgentCore) | Python | Strands SDK Python 네이티브 |
| MCP Tools Lambda | Python | AWS SDK boto3, 분석 라이브러리 |
| Heavy Worker (ECS) | Python | numpy, git, subprocess 등 |

---

## 주요 설계 결정 (ADR 요약)

### ADR-001: 모노레포

**결정**: 단일 레포에 전체 컴포넌트 관리  
**이유**: Agent·Tool·Schema 간 타입 공유, 통합 CI, 버전 일관성  
**트레이드오프**: 초기 빌드 복잡도 증가 → path-based CI로 해결

### ADR-002: 멀티 테이블 DynamoDB

**결정**: 도메인별 테이블 분리  
**이유**: 엔티티 간 접근 패턴이 달라 Single-Table의 복잡도가 이점보다 큼  
**트레이드오프**: 테이블 수 증가 → 모듈화된 Terraform으로 관리

### ADR-003: ECS RunTask (서비스 아님)

**결정**: Heavy Worker는 항상 떠 있는 ECS Service가 아닌 RunTask 방식  
**이유**: 분석 요청이 burst 패턴, 상시 실행 비용 비효율  
**트레이드오프**: 콜드스타트 수십 초 → SQS 비동기로 사용자 체감 없음
