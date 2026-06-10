# AgentOps Platform

AI DevOps Automation Platform — GitHub PR, Slack, Dashboard, AWS Events를 입력으로 받아 Multi-Agent AI가 코드·인프라·보안·장애를 분석하고, 결과를 대시보드/GitHub/Slack에 리포트하는 플랫폼.

## 문서

전체 설계 문서는 [`docs/`](./docs/README.md) 참조.

## 기술 스택

| 영역 | 스택 |
|------|------|
| Frontend | React 18, Vite, TanStack Router/Query, Zustand, Tailwind CSS, shadcn/ui |
| Backend (Lambda) | TypeScript, Node.js 22.x, Hono, Zod, AWS SDK v3, Powertools |
| Agents | Python 3.12, Strands Agents, Claude Sonnet 4.x, Pydantic v2 |
| IaC | Terraform 1.9+, AWS Provider |
| CI/CD | GitHub Actions, OIDC |
| Primary Region | ap-northeast-2 (Seoul) |
| DR Region | ap-northeast-1 (Tokyo) |

## 모노레포 구조

```
aigo/
├── apps/            # Dashboard (React) + dashboard-api (Lambda)
├── connectors/      # GitHub / Slack / Dashboard / AWS-event Lambda
├── agents/          # Strands Python agents (7개)
├── tools/           # MCP Tool 그룹 (9개)
├── workers/         # lightweight Lambda / heavy ECS worker
├── packages/        # 공유 TypeScript 라이브러리
├── libs/            # 공유 Python 라이브러리
├── prompts/         # Agent 프롬프트 (버전 관리)
├── infra/           # Terraform IaC
├── scripts/         # 운영 스크립트
└── docs/            # 설계 문서, ADR, Runbook
```

## 시작하기

```bash
# Node.js 패키지 설치
pnpm install

# Python 패키지 설치
uv sync

# 인프라 배포 (AWS 자격증명 필요)
cd infra/terraform/envs/prod
terraform init
terraform plan
terraform apply
```

## 핵심 원칙

- 프로덕션 퍼스트: 하드코딩, 임시 우회 없음
- Dashboard = Control Plane: 최종 판단은 대시보드
- AI는 Fix PR만: 운영 리소스 직접 변경 금지
- Tool 격리: Agent는 Gateway Tool을 통해서만 외부 접근
