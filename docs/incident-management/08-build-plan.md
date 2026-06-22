# AIGO Incident Management — 구현 계획

## 기본 원칙

- **기존 구조 그대로 따름**: `apps/`, `agents/`, `workers/`, `infra/`, `scripts/` 구조 동일 적용
- **기존 표준 준수**: esbuild bundle, pnpm workspace, `@aigo/aws-clients`, canary `live` alias, X-Ray
- **기존 CM 코드 영향 최소화**: 추가만. 기존 파일 수정은 Layout.tsx·router.tsx·env 3개로 제한
- **Terraform**: `aigo-tf-state` S3 버킷 그대로 사용, key만 다르게 (`im/prod/terraform.tfstate`)

---

## 변경 범위 한눈에 보기

```
aigo/
│
├── apps/
│   ├── dashboard/           [기존] 탭 추가만 (파일 3개 수정)
│   ├── dashboard-api/       [기존] 변경 없음
│   └── im-api/              [신규] IM REST API (dashboard-api와 동일 패턴)
│
├── agents/
│   ├── (기존 7개)           [기존] 변경 없음
│   ├── im-supervisor/       [신규] Strands supervisor
│   ├── im-scope/            [신규] 근본 원인 분석
│   ├── im-summary/          [신규] 장애보고서 생성 + SES
│   ├── im-security/         [신규] GuardDuty 플레이북
│   └── im-chat/             [신규] 리소스 진단 채팅
│
├── workers/
│   ├── (기존 3개)           [기존] 변경 없음
│   ├── im-normalize-event/     [신규] CloudWatch/Health 이벤트 정규화
│   ├── im-webhook-receiver/    [신규] 외부 도구 Webhook 수신
│   ├── im-security-event/      [신규] 보안 이벤트 처리
│   ├── im-poll-investigation/  [신규] SFN Task — 조사 시작 + supervisor 비동기 호출
│   └── im-action-executor/     [신규] 복구 조치 실행
│
├── infra/terraform/
│   ├── envs/
│   │   ├── prod/            [기존] 변경 없음
│   │   └── im/              [신규] IM 전용 환경 (별도 state)
│   ├── modules/
│   │   ├── (기존 모듈들)    [기존] 변경 없음 — lambda 모듈 재사용
│   │   └── im-dynamodb/     [신규] IM DynamoDB 11개 테이블
│   └── global/
│       ├── iam/             [기존] 변경 없음
│       └── im-iam/          [신규] IM Lambda IAM 역할
│
├── scripts/
│   ├── deploy-lambda.sh     [기존] im-api case 1개 추가 (최소 수정)
│   └── deploy-im-agents.sh  [신규] IM Python agents/workers 배포
│
└── .github/workflows/
    ├── cd-deploy.yml        [기존] 변경 없음
    └── im-deploy.yml        [신규] IM 전용 CI/CD 워크플로
```

---

## 신규 생성 AWS 리소스

### Terraform 관리 대상

| 분류 | 리소스명 | 비고 |
|------|---------|------|
| **API Gateway HTTP API** | `aigo-im-api` | dashboard-api와 동일하게 HTTP API v2 |
| Custom Domain | `im-api.seolphung.com` | 기존 `*.seolphung.com` ACM 재사용 |
| Route53 A record | `im-api.seolphung.com` | 기존 zone에 레코드 추가 |
| **EventBridge Bus** | `aigo-im-event-bus` | CM의 `aigo-bus`와 별개 |
| EventBridge Rule × 3 | CloudWatch / Health / GuardDuty | |
| **Step Functions** | `aigo-im-investigation` | |
| **S3** | `aigo-im-reports-{accountId}` | 장애보고서 전용 |
| **DynamoDB × 11** | `aigo-im-*` | PAY_PER_REQUEST, CMK 암호화 |
| **Lambda × 9** | `aigo-im-*` | 아래 목록 참고 |
| **IAM Role × 10** | `aigo-im-*-role` | global/im-iam/ 에서 관리 |
| **CloudWatch Alarm × 9** | `aigo-im-*-error-rate` | canary 자동 롤백용 |

### Lambda 목록

| Lambda명 (aigo-im-) | 런타임 | 소스 위치 | 역할 |
|---------------------|--------|----------|------|
| `aigo-im-api` | Node.js 22 | `apps/im-api/` | REST API 핸들러 (Hono) |
| `aigo-im-normalize-event` | Python 3.12 | `workers/im-normalize-event/` | CW/Health → Incident + SFN 시작 |
| `aigo-im-webhook-receiver` | Python 3.12 | `workers/im-webhook-receiver/` | 외부 Webhook → Incident + SFN 시작 |
| `aigo-im-security-event` | Python 3.12 | `workers/im-security-event/` | GuardDuty → SecurityEvents + security-agent 비동기 |
| `aigo-im-poll-investigation` | Python 3.12 | `workers/im-poll-investigation/` | SFN Task: status=INVESTIGATING, supervisor 비동기 호출 |
| `aigo-im-action-executor` | Python 3.12 | `workers/im-action-executor/` | 복구 조치 실행 (AllowList/All + AssumeRole) |
| `aigo-im-supervisor-agent` | Python 3.12 | `agents/im-supervisor/` | scope + summary 병렬 조율 (plain Python) |
| `aigo-im-scope-agent` | Python 3.12 | `agents/im-scope/` | 근본 원인·범위 분석 (Strands) |
| `aigo-im-summary-agent` | Python 3.12 | `agents/im-summary/` | 보고서 생성 + S3 + SES (Strands) |
| `aigo-im-security-agent` | Python 3.12 | `agents/im-security/` | 보안 분석 + 플레이북 (Strands) |
| `aigo-im-chat-agent` | Python 3.12 | `agents/im-chat/` | 리소스 진단 AI 채팅 (Strands) |

### 기존 리소스 data source 참조 (신규 생성 없음)

| 리소스 | 참조 이유 |
|--------|---------|
| VPC, 프라이빗 서브넷 | Lambda VPC 배치 |
| `aigo-lambda-sg` | Lambda SG 재사용 |
| DynamoDB/S3 Gateway VPC Endpoint | 동일 서브넷이면 자동 사용 |
| NAT Gateway | 동일 라우트 테이블 자동 사용 |
| `alias/aigo-lambda` KMS | Lambda 환경변수 암호화 |
| `alias/aigo-dynamodb` KMS | DynamoDB 테이블 암호화 |
| `alias/aigo-s3` KMS | S3 reports 버킷 암호화 |
| `aigo-artifacts` S3 | Lambda .zip 코드 저장 |
| Cognito `aigo-user-pool` | API GW JWT Authorizer |
| ACM `*.seolphung.com` | im-api 도메인 |
| SES `seolphung.com` | 보고서 이메일 발신 |
| Route53 `seolphung.com` zone | DNS 레코드 추가 |

---

## 디렉토리별 상세 구조

### apps/im-api/ (dashboard-api와 동일 패턴)

```
apps/im-api/
├── src/
│   ├── index.ts                  # Hono app + Lambda handler (dashboard-api/index.ts 동일 패턴)
│   ├── config.ts                 # IM 전용 Config (requireEnv 패턴 동일)
│   ├── middleware/
│   │   └── auth.ts               # dashboard-api/middleware/auth.ts 복사 후 사용
│   └── routes/
│       ├── incidents.ts          # GET/POST /incidents
│       ├── investigation.ts      # GET /incidents/:id/investigation
│       ├── remediations.ts       # POST /incidents/:id/remediation
│       ├── security.ts           # GET/POST /security
│       ├── chat.ts               # POST /chat (im-scope agent 인라인 호출)
│       ├── accounts.ts           # Linked Account CRUD
│       ├── settings.ts           # AllowList/All 모드
│       ├── targets.ts            # 조사 대상 등록
│       ├── integrations.ts       # 외부 도구 연동
│       └── webhook.ts            # POST /webhook/:id (인증 없음)
├── package.json                  # @aigo/im-api, @aigo/aws-clients workspace dep
└── tsconfig.json
```

`config.ts` 패턴 (dashboard-api/config.ts 동일 구조):
```typescript
export const Config = {
  get tableName(): (table: string) => string {
    const prefix = optionalEnv('IM_TABLE_PREFIX', 'aigo-im');
    return (table: string) => `${prefix}-${table}`;
  },
  get imReportsBucket(): string { return requireEnv('IM_REPORTS_BUCKET'); },
  get sfnArn(): string { return requireEnv('IM_SFN_ARN'); },
} as const;
```

### agents/im-{name}/ (orchestrator와 동일 패턴)

```
agents/im-supervisor/
├── src/
│   ├── agent.py     # Strands Agent 정의
│   ├── config.py    # get_config() 패턴
│   └── handler.py   # Lambda handler
└── pyproject.toml   # strands-agents, boto3, structlog, pydantic, python-ulid
```

### workers/im-{name}/ (workers/notification 패턴)

```
workers/im-normalize-event/
├── src/
│   ├── handler.py   # Lambda handler
│   └── models.py    # dataclass
└── pyproject.toml
```

### infra/terraform/envs/im/

```
infra/terraform/envs/im/
├── backend.tf       # aigo-tf-state / im/prod/terraform.tfstate
├── main.tf          # data source + resource
├── variables.tf
└── outputs.tf
```

`main.tf` 구성 (기존 envs/prod/main.tf 패턴):
```hcl
# data sources
data "aws_vpc" "main" { ... }
data "aws_kms_alias" "lambda" { name = "alias/aigo-lambda" }
...

# 기존 lambda 모듈 재사용
module "lambda_im_api" {
  source        = "../../modules/lambda"   # 기존 모듈
  project       = var.project
  function_name = "im-api"                 # → aigo-im-api
  s3_bucket     = data.aws_s3_bucket.artifacts.id
  s3_key        = "lambda/im-api/latest.zip"
  kms_key_arn   = data.aws_kms_alias.lambda.target_key_arn
  subnet_ids    = data.aws_subnets.private.ids
  ...
}

# IM 전용 DynamoDB 모듈
module "im_dynamodb" {
  source      = "../../modules/im-dynamodb"
  project     = var.project
  kms_key_arn = data.aws_kms_alias.dynamodb.target_key_arn
}
```

---

## 기존 파일 수정 목록 (3개)

### 1. apps/dashboard/src/components/layout/Layout.tsx

기존 `navItems` 배열과 sidebar 렌더링 코드 **변경 없음**.
`</nav>` 닫히기 전 IM 섹션 div 추가:

```diff
+ import { ShieldAlert } from 'lucide-react';

+ const imNavItems = [
+   { to: '/im/incidents',   label: '인시던트 조사', icon: ShieldAlert, hint: 'im/incidents' },
+   { to: '/im/remediation', label: '조치 현황',      icon: Activity,    hint: 'im/remediation' },
+   { to: '/im/security',    label: '보안 이벤트',    icon: ShieldAlert, hint: 'im/security' },
+   { to: '/im/targets',     label: '조사 대상',      icon: Settings,    hint: 'im/targets' },
+ ];

  <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
    {navItems.map(...)}          {/* 기존 코드 변경 없음 */}

+   {/* IM 섹션 — 기존 CM 탭 아래 */}
+   <div className="mt-3 pt-3 border-t border-term/30">
+     <p className="px-2.5 mb-1 text-[9px] font-mono text-term-secondary/50 tracking-wider uppercase">
+       Incident Mgmt
+     </p>
+     {imNavItems.map(...)}      {/* navItems와 동일 렌더링 패턴 */}
+   </div>
  </nav>
```

### 2. apps/dashboard/src/router.tsx

기존 route 선언 코드 **변경 없음**.
파일 끝에 IM import + route 추가, `routeTree`에 등록:

```diff
+ import { IMIncidentsPage }   from './pages/im/IncidentsPage';
+ import { IMRemediationPage } from './pages/im/RemediationPage';
+ import { IMSecurityPage }    from './pages/im/SecurityPage';
+ import { IMTargetsPage }     from './pages/im/TargetsPage';

+ const imIncidentsRoute   = createRoute({ getParentRoute: () => protectedRoute, path: '/im/incidents',   component: IMIncidentsPage   });
+ const imRemediationRoute = createRoute({ getParentRoute: () => protectedRoute, path: '/im/remediation', component: IMRemediationPage });
+ const imSecurityRoute    = createRoute({ getParentRoute: () => protectedRoute, path: '/im/security',    component: IMSecurityPage    });
+ const imTargetsRoute     = createRoute({ getParentRoute: () => protectedRoute, path: '/im/targets',     component: IMTargetsPage     });

  const routeTree = rootRoute.addChildren([
    ...
    protectedRoute.addChildren([
      ...,                       // 기존 라우트 변경 없음
+     imIncidentsRoute,
+     imRemediationRoute,
+     imSecurityRoute,
+     imTargetsRoute,
    ]),
  ]);
```

### 3. apps/dashboard/.env.production

```diff
  VITE_API_URL=https://api.seolphung.com
+ VITE_IM_API_URL=https://im-api.seolphung.com
```

---

## 배포 스크립트

### scripts/deploy-lambda.sh (최소 수정)

기존 case 문에 `im-api` 한 줄 추가:

```diff
+ elif [[ "$PACKAGE_NAME" == "im-api" ]]; then
+   BUNDLE_PATH="apps/im-api/dist/index.js"
+   PKG_FILTER="@aigo/im-api"
```

### scripts/deploy-im-agents.sh (신규)

`deploy-orchestrator.sh` 패턴 그대로, 멀티 에이전트 지원 파라미터만 추가:

```bash
# Usage: ./scripts/deploy-im-agents.sh <agent-name>
# agent-name: im-supervisor | im-scope | im-summary | im-security
#             im-normalize-event | im-webhook-receiver | im-security-event | im-action-executor
```

---

## CI/CD — im-deploy.yml (신규)

`cd-deploy.yml` 구조를 그대로 따름:

```yaml
name: IM Deploy
on:
  push:
    branches: [main]
    paths:
      - 'apps/im-api/**'
      - 'agents/im-*/**'
      - 'workers/im-*/**'
      - 'infra/terraform/envs/im/**'
      - 'infra/terraform/modules/im-*/**'
      - 'infra/terraform/global/im-iam/**'

jobs:
  detect-changes:       # cd-deploy.yml detect-changes와 동일 패턴, IM 경로 기준
  deploy-infra:         # infra/terraform/envs/im/ terraform apply
  deploy-im-api:        # Node.js — deploy-lambda.sh im-api aigo-im-api
  deploy-im-agents:     # Python — deploy-im-agents.sh (matrix: 8개 Lambda)
  deploy-dashboard:     # apps/dashboard 변경 시에만
```

---

## 구현 순서 (Phase)

| # | 작업 | 파일 | 비고 |
|---|------|------|------|
| 1 | IAM Roles | `infra/terraform/global/im-iam/main.tf` | CM global/iam 패턴 |
| 2 | IM DynamoDB 모듈 | `infra/terraform/modules/im-dynamodb/main.tf` | CM dynamodb 모듈 패턴 |
| 3 | IM Terraform 환경 | `infra/terraform/envs/im/` | data source + 리소스 |
| 4 | im-api (골격) | `apps/im-api/` | dashboard-api 패턴 |
| 5 | im-normalize-event | `workers/im-normalize-event/` | |
| 6 | im-webhook-receiver | `workers/im-webhook-receiver/` | |
| 7 | im-security-event | `workers/im-security-event/` | |
| 8 | im-scope agent | `agents/im-scope/` | |
| 9 | im-summary agent | `agents/im-summary/` | |
| 10 | im-supervisor agent | `agents/im-supervisor/` | |
| 11 | im-security agent | `agents/im-security/` | |
| 12 | im-action-executor | `workers/im-action-executor/` | |
| 13 | 배포 스크립트 | `scripts/deploy-im-agents.sh` + deploy-lambda.sh 수정 | |
| 14 | CI/CD | `.github/workflows/im-deploy.yml` | |
| 15 | 프런트엔드 페이지 | `apps/dashboard/src/pages/im/` | |
| 16 | 프런트엔드 연결 | Layout.tsx, router.tsx, .env | 마지막에 연결 |

각 Phase 시작 전 어떤 파일을 어떤 내용으로 수정·생성하는지 먼저 설명하고 진행.
