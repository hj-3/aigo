# AgentOps Platform — 서비스 개요

## 서비스 정의

GitHub PR, Slack 명령, 대시보드 액션, AWS 운영 이벤트를 입력으로 받아 Strands 기반 Multi-Agent가 코드·인프라·보안·장애를 분석하고, 결과를 대시보드/GitHub/Slack에 리포트하며, 승인된 개선사항은 자동 Fix PR 또는 운영 조사 리포트로 연결하는 **AI DevOps Automation Platform**.

---

## 핵심 원칙

> 이 섹션의 원칙은 설계·구현·배포·운영 전 단계에서 예외 없이 적용된다.  
> 원칙 위반이 발견되면 작업을 중단하고 수정 후 재진행한다.

### 품질·완성도 원칙

- **프로덕션 퍼스트**: 초기 개발부터 프로덕션 수준으로 구현한다. 하드코딩, 임시 우회, "나중에 고치자"는 없다. dev/prod 환경 분리 없이 처음부터 실서비스 가능한 상태로 만든다.
- **실무 표준 준수**: 모든 구현은 AWS Well-Architected Framework, OWASP, 12-Factor App, Google SRE 등 업계 표준을 따른다. "동작은 하지만 표준에 어긋나는" 구현은 허용하지 않는다.
  - AWS: IAM 최소 권한, VPC 격리, KMS 암호화, CloudWatch 관측성, PITR 백업 — 기본 설정
  - API: REST 설계 원칙, HTTP 상태 코드 정확도, 에러 응답 표준화, API 버전 관리
  - 코드: 언어별 공식 스타일 가이드(ESLint/Prettier, ruff/pyright), 타입 안전성 100%
  - 보안: HMAC 서명 검증, JWT 갱신 전략, Secrets Manager 필수, SQL/NoSQL Injection 방어
  - 테스트: 단위 테스트 + 통합 테스트 + E2E 테스트 구조 필수, 핵심 경로 커버리지 80% 이상
- **요구사항 완전 구현**: 초기에 정의된 모든 기능·컴포넌트·흐름을 빠짐없이 구현한다. 부분 구현, 스텁(stub) 상태 방치 금지. 구현 완료 기준은 "실제 서비스 트래픽을 처리할 수 있는 상태"이다.

### 아키텍처 원칙

- **GitHub App은 Connector 중 하나**: GitHub는 서비스의 중심이 아니다. Slack, Dashboard, AWS Event도 동등한 입력 채널이다.
- **Dashboard = Control Plane**: 최종 판단(승인/거절/Fix/Incident 조사)은 대시보드에서 이루어진다.
- **AI는 Fix PR을 만들 뿐, 운영 리소스를 직접 변경하지 않는다**: `terraform apply`, `kubectl apply`, 운영 AWS 리소스 직접 수정 금지.
- **Memory 기반 품질**: AgentCore Memory로 PR 세션·레포 요약·사용자 패턴·장애 이력을 관리해 분석 품질을 높인다.
- **Tool 격리**: Agent는 AgentCore Gateway Tool을 통해서만 외부 시스템에 접근한다. 직접 AWS/GitHub/Slack API 호출 금지.
- **VPC Endpoint 우선**: 내부 AWS 서비스 트래픽은 VPC Endpoint로 처리, NAT는 외부 SaaS 전용으로 최소화.

### 작업 관리 원칙

- **작업 단위별 문서화**: 각 구현 작업이 완료될 때마다 `docs/` 하위에 해당 작업의 상세 내용(설계 결정, 구현 방식, 참조 경로, 운영 주의사항)을 담은 문서를 생성한다. 이 문서는 이후 작업에서 참조 기준이 된다.
- **문서 우선 검토**: 작업 시작 전 기존 `docs/`와 ADR을 먼저 확인해 설계 결정과 충돌하지 않는지 검증한다.
- **공식 문서 기반 검증**: 모든 구현은 해당 서비스·라이브러리의 공식 문서를 기준으로 API, 속성, 동작을 검증한다. 공식 문서에 없는 비공식 방식, deprecated API, 문서화되지 않은 내부 동작에 의존 금지.

---

## 입력 채널

| 채널 | 이벤트 유형 | 처리 Lambda |
|------|-------------|-------------|
| GitHub Webhook | PR opened / synchronize / closed | `github-connector` |
| Slack Slash Command | `/approve`, `/reject`, `/investigate` | `slack-connector` |
| Dashboard Action | Approve / Reject / Fix / Re-run | `dashboard-cmd-connector` |
| AWS Event | CloudWatch Alarm / EventBridge Rule | `aws-event-connector` |

---

## 출력 채널

| 채널 | 출력 내용 |
|------|-----------|
| GitHub | PR Comment, Check Run (pass/fail), Fix PR |
| Slack | 분석 리포트, High-risk 알림, Incident 요약 |
| Dashboard | Report 상세, Approval 기록, Fix Preview, Incident Timeline |
| S3 / DynamoDB | Audit Log, RCA Report, Raw Agent Output |

---

## 서비스 범위

### 포함

- PR 코드·인프라·보안·위험 분석 (Multi-Agent)
- Fix Patch 생성 및 Fix PR 자동 생성 (사용자 승인 후)
- AWS 장애 조사 및 RCA 리포트 (CloudWatch / CloudTrail / X-Ray 기반)
- 과거 PR 패턴·사용자 습관·레포 이력 기반 Memory 강화
- 조직·레포별 분석 정책 설정
- 전체 행동에 대한 Audit Log

### 미포함 (명시적 제외)

- `terraform apply` / `kubectl apply` 등 인프라 직접 변경
- 운영 데이터베이스 직접 접근 또는 수정
- GitHub main 브랜치 직접 push
- 사용자 승인 없는 코드 커밋

---

## 서비스 구성 요소 요약

```
[입력 채널]
  GitHub PR / Slack / Dashboard / AWS Event
        ↓
[API Gateway + Connector Lambda]
  서명 검증 → Job 생성 → SQS 발행
        ↓
[Event & Queue Layer]
  EventBridge + SQS (analysis / fix / incident / command)
        ↓
[Execution Layer]
  Lambda (경량) / ECS Fargate RunTask (중량)
        ↓
[Agent Layer — AgentCore Runtime + Strands]
  Orchestrator → Code / Infra / Risk / Security / Incident / Fix Agent
        ↓
[Memory Layer]          [Tool / MCP Layer]
  AgentCore Memory  ←→  AgentCore Gateway + 9개 Tool 그룹
        ↓
[Result Layer]
  DynamoDB / S3 → GitHub / Slack / Dashboard
```

---

## 조직 역할 (RBAC)

| 역할 | 권한 |
|------|------|
| `OWNER` | 전체 설정 + 멤버 관리 + 모든 작업 |
| `ADMIN` | 분석, 승인, Fix, Incident 조사, 설정 |
| `REVIEWER` | 리포트 확인 + 승인/거절 |
| `VIEWER` | 읽기 전용 |

---

## 구현 Phase

| Phase | 내용 |
|-------|------|
| 1 | Core Platform Foundation (Terraform, VPC, S3, DynamoDB, SQS, EventBridge, Lambda, API GW, Cognito, CloudFront) |
| 2 | Connectors (GitHub, Slack, Dashboard, AWS Event) |
| 3 | Event + Job System (Job 생성, SQS Consumer, idempotency, DLQ) |
| 4 | AgentCore + Strands Runtime (7개 Agent, Memory, Gateway) |
| 5 | MCP Tools (9개 Tool 그룹) |
| 6 | Dashboard (React/TypeScript, 6개 도메인) |
| 7 | Full Workflow 통합 (E2E 테스트, Memory 검증) |
