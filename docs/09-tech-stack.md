# 기술 스택

## 선택 원칙

- **프로덕션 검증**: 안정성이 검증된 기술 선택. 실험적 기술 도입 금지
- **AWS 네이티브 우선**: 관리형 서비스가 있으면 직접 구현 대신 선택
- **언어 특성 분리**: TypeScript는 짧고 빠른 이벤트 처리, Python은 AI·분석·데이터 처리
- **버전 고정**: 모든 주요 의존성은 버전 고정 (`==`, `^`)

---

## Frontend

### 핵심 스택

| 라이브러리 | 버전 | 역할 |
|-----------|------|------|
| React | 18.x | UI 프레임워크 |
| TypeScript | 5.x | 정적 타입 |
| Vite | 6.x | 빌드 도구, HMR |
| TanStack Router | 1.x | 타입 안전 라우팅 |
| TanStack Query | 5.x | 서버 상태 관리, 캐싱 |
| Zustand | 5.x | 클라이언트 상태 관리 |
| Tailwind CSS | 4.x | 유틸리티 스타일링 |
| shadcn/ui | latest | Headless UI 컴포넌트 |
| Vitest | 3.x | 단위 테스트 |
| Testing Library | 16.x | 컴포넌트 테스트 |
| Playwright | latest | E2E 테스트 |

### 인증

| 라이브러리 | 역할 |
|-----------|------|
| `aws-amplify/auth` | Cognito PKCE 인증 흐름 |

### 코드 품질

| 도구 | 역할 |
|------|------|
| ESLint | 린트 (eslint-config-typescript-strict) |
| Prettier | 코드 포맷 |
| TypeScript strict mode | 타입 검증 |

---

## Backend — TypeScript Lambda

### 핵심 스택

| 라이브러리 | 버전 | 역할 |
|-----------|------|------|
| Node.js | 22.x LTS | 런타임 |
| TypeScript | 5.x | 정적 타입 |
| esbuild | latest | 단일 파일 번들링 |
| Hono | 4.x | 경량 HTTP 프레임워크 (Lambda adapter) |
| Zod | 3.x | 런타임 스키마 검증 |
| `@aws-sdk/client-*` | v3 | AWS SDK (트리쉐이킹) |
| Vitest | 3.x | 단위 테스트 |
| `@aws-sdk/client-mock` | latest | AWS SDK Mock |

### Observability

| 라이브러리 | 역할 |
|-----------|------|
| `@aws-lambda-powertools/logger` | 구조화 로깅 (JSON) |
| `@aws-lambda-powertools/tracer` | X-Ray 트레이싱 |
| `@aws-lambda-powertools/metrics` | CloudWatch Metrics |

### 공유 패키지 (내부)

| 패키지 | 역할 |
|--------|------|
| `@aigo/types` | Finding, Report, Job 공유 타입 |
| `@aigo/aws-clients` | DynamoDB, S3, SQS 클라이언트 팩토리 |
| `@aigo/logger` | Powertools Logger 래핑 |

---

## Backend — Python (Agent · Tool · Worker)

### 핵심 스택

| 라이브러리 | 버전 | 역할 |
|-----------|------|------|
| Python | 3.12 | 런타임 |
| uv | latest | 패키지 관리, 워크스페이스 |
| Strands Agents | latest | AWS Agent 프레임워크 |
| Pydantic | v2 | 데이터 검증, 직렬화 |
| boto3 | latest | AWS SDK |
| httpx | latest | 비동기 HTTP 클라이언트 |
| pytest | latest | 테스트 |
| pytest-asyncio | latest | 비동기 테스트 |
| moto | latest | AWS 서비스 Mock |

### 코드 품질

| 도구 | 역할 |
|------|------|
| ruff | 린트 + 포맷 (flake8 + black 대체) |
| pyright | 정적 타입 검사 |

### Observability

| 라이브러리 | 역할 |
|-----------|------|
| `aws-lambda-powertools` | Logger, Tracer, Metrics (Python) |

### 공유 라이브러리 (내부)

| 패키지 | 역할 |
|--------|------|
| `aigo-common` | ULID 생성, 타임스탬프, 공통 예외 |
| `aigo-aws-utils` | DynamoDB, S3, Secrets Manager 헬퍼 |
| `aigo-schema` | Finding, Report, Incident Pydantic 모델 |

---

## AI & Agent

| 서비스/라이브러리 | 역할 |
|-----------------|------|
| Amazon Bedrock AgentCore Runtime | Agent 실행 호스팅 |
| Strands Agents | Agent 프레임워크 (Python) |
| Claude Sonnet 4.x | 분석 모델 (`claude-sonnet-4-x`) |
| Amazon Titan Embeddings | Knowledge Base 임베딩 |
| Bedrock Knowledge Base | AWS Best Practice 벡터 검색 |
| Bedrock Guardrails | 입출력 안전성 필터 |
| AgentCore Memory | 단기/장기 컨텍스트 저장 |
| AgentCore Gateway | MCP Tool 연결 |

---

## Infrastructure (Terraform)

| 도구 | 버전 | 역할 |
|------|------|------|
| Terraform | 1.9+ | IaC |
| AWS Provider | ~5.0 | AWS 리소스 관리 |
| Checkov | latest | IaC 보안 스캔 |
| tfsec | latest | IaC 추가 보안 스캔 |
| terraform-docs | latest | 모듈 문서 자동 생성 |

### Terraform 상태 관리

- Backend: S3 + DynamoDB Lock
- 워크스페이스: 사용하지 않음 (명시적 `envs/prod/` 경로)

---

## AWS 서비스 목록

### Compute

| 서비스 | 용도 |
|--------|------|
| Lambda (Node.js 22.x) | 커넥터, API, 경량 워커 |
| ECS Fargate | 중량 워커 (repo clone, test, patch) |
| Bedrock AgentCore Runtime | Agent 실행 |

### Storage

| 서비스 | 용도 |
|--------|------|
| DynamoDB | 운영 상태 데이터 |
| S3 | 대용량 원본 데이터 |
| Bedrock Knowledge Base | 벡터 검색 |
| ElastiCache for Redis | (향후) 세션 캐시, 인기 리포트 캐시 |

### Networking

| 서비스 | 용도 |
|--------|------|
| VPC | 네트워크 격리 |
| API Gateway HTTP API | REST API |
| CloudFront | CDN, HTTPS |
| Route 53 | DNS |
| ACM | TLS 인증서 |
| NAT Gateway | 외부 SaaS 아웃바운드 |
| VPC Endpoints | AWS 서비스 프라이빗 접근 |

### Security & Identity

| 서비스 | 용도 |
|--------|------|
| Cognito | 사용자 인증, JWT |
| IAM | 권한 관리 |
| Secrets Manager | 시크릿 저장 |
| KMS | 암호화 키 |
| WAF | 웹 방화벽 |
| GuardDuty | 위협 탐지 |
| Security Hub | 보안 발견 집계 |
| AWS Config | 리소스 규정 준수 |
| CloudTrail | API 감사 로그 |

### Messaging & Events

| 서비스 | 용도 |
|--------|------|
| SQS | 비동기 작업 큐 |
| EventBridge | 이벤트 라우팅 |
| SNS | 알림 발송 (Slack, 이메일) |

### Observability

| 서비스 | 용도 |
|--------|------|
| CloudWatch Logs | 로그 수집 |
| CloudWatch Metrics | 메트릭 수집 |
| CloudWatch Alarms | 알람 |
| CloudWatch Dashboard | 운영 대시보드 |
| X-Ray | 분산 트레이싱 |

### CI/CD

| 서비스 | 용도 |
|--------|------|
| GitHub Actions | CI/CD 파이프라인 |
| ECR | 컨테이너 이미지 레지스트리 |
| S3 (artifacts) | Lambda ZIP, 빌드 산출물 |

---

## 패키지 매니저

| 언어 | 도구 | 이유 |
|------|------|------|
| TypeScript/JS | pnpm 9.x | 빠른 설치, hoisting, 모노레포 workspace |
| Python | uv | 빠른 resolver, PEP 582, workspace 지원 |

---

## 개발 도구

| 도구 | 용도 |
|------|------|
| mise | 런타임 버전 관리 (node, python, terraform) |
| direnv | 디렉토리별 환경변수 로드 |
| LocalStack | 로컬 AWS 서비스 에뮬레이션 (개발 시) |
| Docker Desktop | ECS 이미지 로컬 빌드 |
| AWS SAM CLI | Lambda 로컬 실행 |

---

## 버전 정책

- **Node.js**: LTS 버전 (현재 22.x)
- **Python**: 3.12 (최신 Stable)
- **Terraform**: ~1.9 (minor 자동 업데이트, major 수동)
- **Strands Agents**: latest (AWS 관리, major 변경 시 수동 확인)
- **Claude 모델**: `claude-sonnet-4-x` (새 버전 출시 시 테스트 후 업그레이드)

---

## 버전 명세 예시

### package.json (TypeScript)

```json
{
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.738.0",
    "@aws-sdk/client-s3": "^3.738.0",
    "@aws-sdk/client-sqs": "^3.738.0",
    "@aws-lambda-powertools/logger": "^2.14.0",
    "@aws-lambda-powertools/tracer": "^2.14.0",
    "hono": "^4.7.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "esbuild": "^0.24.0",
    "vitest": "^3.0.0",
    "@aws-sdk/client-mock": "^4.0.0"
  }
}
```

### pyproject.toml (Python)

```toml
[project]
name = "aigo-orchestrator"
requires-python = ">=3.12"

dependencies = [
  "strands-agents>=0.1.0",
  "pydantic>=2.10.0",
  "boto3>=1.35.0",
  "httpx>=0.28.0",
  "aws-lambda-powertools>=3.7.0",
]

[tool.uv]
dev-dependencies = [
  "pytest>=8.3.0",
  "pytest-asyncio>=0.24.0",
  "moto[dynamodb,s3,sqs]>=5.0.0",
  "ruff>=0.9.0",
  "pyright>=1.1.0",
]
```
