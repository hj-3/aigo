# AgentOps Platform — 문서 인덱스

AI DevOps Automation Platform 전체 설계 문서.  
각 문서는 노션에 개별 페이지로 임포트 가능한 마크다운 형식.

---

## 문서 목록

| 문서 | 내용 |
|------|------|
| [00-overview](./00-overview.md) | 서비스 정의, 핵심 원칙, 입출력 채널, 구현 Phase |
| [01-architecture](./01-architecture.md) | 전체 아키텍처 다이어그램, 8개 계층 상세, 시나리오별 흐름 |
| [02-directory-structure](./02-directory-structure.md) | 모노레포 디렉토리 레이아웃, ADR 요약 |
| [03-data-model](./03-data-model.md) | DynamoDB 13개 테이블 설계, S3 구조, Knowledge Base |
| [04-infrastructure](./04-infrastructure.md) | VPC 설계, VPC Endpoint, AWS 서비스별 구성 |
| [05-agents](./05-agents.md) | 7개 Agent 상세, Memory 구조, MCP Tool 9개 그룹 |
| [06-api-design](./06-api-design.md) | REST API 엔드포인트, 요청/응답 스키마, SLA |
| [07-cicd](./07-cicd.md) | GitHub Actions 워크플로우, OIDC, 배포 전략 |
| [08-security](./08-security.md) | 인증/인가, WAF, IAM, 암호화, Agent 보안 |
| [09-tech-stack](./09-tech-stack.md) | 전체 기술 스택, 버전 정책, 패키지 명세 |
| [10-disaster-recovery](./10-disaster-recovery.md) | RTO/RPO, 백업 전략, Failover 절차, DR 훈련 |
| [11-user-flows](./11-user-flows.md) | 사용자 여정, 시나리오별 상세 흐름, 화면 구성 |

---

## 구현 상세 (impl/)

각 Phase의 실제 구현 내용, 파일 구조, 설계 결정을 담은 문서.

| 문서 | 내용 |
|------|------|
| [phase-1-foundation](./impl/phase-1-foundation.md) | VPC, S3, DynamoDB, SQS, EventBridge, Lambda, API GW, Cognito, CloudFront |
| [phase-1-bedrock](./impl/phase-1-bedrock.md) | Bedrock AgentCore + Knowledge Base Terraform 구현 |
| [phase-2-connectors](./impl/phase-2-connectors.md) | GitHub / Slack / Dashboard / AWS Event 커넥터 Lambda |
| [phase-3-workers](./impl/phase-3-workers.md) | Lightweight Worker, Heavy Worker (Fix PR), Notification Worker |
| [phase-4-agents](./impl/phase-4-agents.md) | 7개 Strands Agent + BaseAgentConfig 모듈화 |
| [phase-5-tools](./impl/phase-5-tools.md) | MCP Tool 9개 그룹 |
| [phase-6-dashboard](./impl/phase-6-dashboard.md) | React SPA (Amplify 인증, 9개 페이지) + Hono API (13개 라우트) |
| [phase-7-cicd](./impl/phase-7-cicd.md) | GitHub Actions CI/CD, Canary 배포 전략 |
| [phase-8-infra-ops](./impl/phase-8-infra-ops.md) | 모니터링 모듈, 보안 모듈 (WAF/GuardDuty/CloudTrail), pytest 테스트 인프라 |
| [dr-deferral](./impl/dr-deferral.md) | 재해 복구 리소스 연기 결정 및 이유 |

---

## ADR (Architecture Decision Records)

| 문서 | 결정 |
|------|------|
| [ADR-001](./adr/001-monorepo.md) | 혼합 언어 모노레포 채택 |
| [ADR-002](./adr/002-multitable-dynamo.md) | DynamoDB 멀티 테이블 설계 |
| [ADR-003](./adr/003-ecs-runtask.md) | ECS Fargate RunTask 방식 채택 |

---

## 아키텍처 다이어그램

| 파일 | 내용 |
|------|------|
| [architecture.drawio](./architecture.drawio) | 전체 아키텍처 draw.io 다이어그램 (6개 페이지: Full Architecture, PR 분석 플로우, Approval &amp; Fix 플로우, 인시던트 조사 플로우, Agent 내부 구조, 알림 시스템 플로우) |

---

## Runbooks

| 문서 | 내용 |
|------|------|
| [deploy-runbook](./runbooks/deploy-runbook.md) | 전체 인프라 배포 절차 (Phase A~L) |
| [dr-failover](./runbooks/dr-failover.md) | 리전 장애 시 Tokyo Failover 절차 |
| [incident-response](./runbooks/incident-response.md) | Incident 대응 절차 |
| [rollback](./runbooks/rollback.md) | Lambda / Agent 롤백 절차 |
| [cost-reduction-terraform](./runbooks/cost-reduction-terraform.md) | 고비용 리소스(AOSS/VPC Endpoint) 비활성화 및 복구 절차 |
| [slack-app-setup](./runbooks/slack-app-setup.md) | Slack App 생성, OAuth 설정, Client Secret 주입 절차 |

---

## 핵심 원칙 요약

1. **프로덕션 퍼스트**: 하드코딩, 임시 우회 없음
2. **GitHub는 Connector 하나**: 전체 서비스의 중심이 아님
3. **Dashboard = Control Plane**: 최종 판단은 항상 Dashboard
4. **AI는 Fix PR만**: 운영 리소스 직접 변경 금지
5. **Tool 격리**: Agent는 Gateway Tool 통해서만 외부 접근
6. **VPC Endpoint 우선**: NAT는 외부 SaaS 전용 최소화
