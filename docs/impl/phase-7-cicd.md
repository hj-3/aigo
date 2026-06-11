# Phase 7: CI/CD & Deployment

## 개요

GitHub Actions + OIDC 기반 CI/CD 파이프라인 및 배포 스크립트 구현.

**현재 상태 (2026-06-11 기준): 전체 파이프라인 PASSING**

---

## GitHub Actions Workflows

### 트리거 설계 원칙

| 이벤트 | 트리거 대상 | 이유 |
|--------|------------|------|
| PR → main (open/update) | CI 워크플로우 4개 | 변경 파일 경로 기반 선택 실행 |
| main push (PR merge) | CD 워크플로우 1개 | detect-changes 잡이 변경 컴포넌트 판별 후 선택 배포 |
| workflow_dispatch | CI + CD 모두 | 수동 실행 (컴포넌트 지정 가능) |

CI 워크플로우는 **main push 트리거 없음** — PR merge 후 CD가 배포를 담당하므로 중복 실행 불필요.  
`branches: [main]` 제한으로 feature 브랜치 간 PR은 CI가 트리거되지 않는다.

---

### 1. ci-infra.yml (Terraform CI)

**트리거:** main 대상 PR에서 `infra/**` 또는 워크플로우 파일 변경 시

**Jobs:**
1. `validate`: terraform fmt -check, terraform validate, tflint
2. `plan`: terraform plan + PR 댓글 게시

**OIDC:** AWS 자격증명 장기 보관 없음 (github-actions-deploy IAM role AssumeRoleWithWebIdentity)

---

### 2. ci-agents.yml (Python CI)

**트리거:** main 대상 PR에서 `agents/**`, `tools/**`, `libs/**`, `workers/heavy/**`, `prompts/**` 변경 시

**Jobs:**
1. `lint-and-type-check`: ruff check, ruff format --check, pyright
2. `test`: pytest
3. `docker-build`: Heavy Worker Docker 이미지 빌드 (push 없음)

---

### 3. ci-dashboard.yml (React CI)

**트리거:** main 대상 PR에서 `apps/dashboard/**`, `packages/**` 변경 시

**Jobs:**
1. `type-check-lint-build`: packages build → dashboard type-check → lint → Vite build

---

### 4. ci-api.yml (TypeScript Lambda CI)

**트리거:** main 대상 PR에서 `connectors/**`, `workers/lightweight/**`, `apps/dashboard-api/**`, `packages/**` 변경 시

**Jobs:**
1. `build-and-test`:
   - `pnpm -r --filter="{packages/**}" build` (shared packages 먼저)
   - type-check → lint → test → esbuild bundle 검증

---

### 5. cd-deploy.yml (배포)

**트리거:** main 브랜치 push (PR merge) + workflow_dispatch

**concurrency:** `terraform-deploy` 그룹 (`cancel-in-progress: false`) — 병렬 Terraform 잠금 충돌 방지

**Jobs:**

#### detect-changes (0번 잡, 항상 실행)
`git diff HEAD~1 HEAD`로 변경된 파일 목록을 확인해 컴포넌트별 변경 여부를 outputs로 출력:

| output | 감지 경로 |
|--------|----------|
| `infra` | `infra/**` |
| `api` | `connectors/**, workers/lightweight/**, apps/dashboard-api/**, packages/**` |
| `dashboard` | `apps/dashboard/**, packages/**` |

`workflow_dispatch`일 때는 `inputs.component` 값으로 직접 결정.

#### deploy-infra
- **조건**: `detect-changes.outputs.infra == 'true'`
- 순서: `global/iam` apply → `envs/prod` apply → Terraform outputs 읽기

#### deploy-api (Lambda matrix, 6개 병렬)
- **조건**: infra 성공 또는 skipped + `detect-changes.outputs.api == 'true'`

```
connector-github    → aigo-github-connector
connector-slack     → aigo-slack-connector
connector-aws-event → aigo-aws-event-connector
connector-dashboard-cmd → aigo-dashboard-cmd-connector
worker-lightweight  → aigo-lightweight-worker
dashboard-api       → aigo-dashboard-api
```

steps:
1. pnpm install --frozen-lockfile
2. **pnpm -r --filter="{packages/**}" build** ← @aigo/logger, @aigo/aws-clients, @aigo/types 먼저 빌드
3. pnpm -F "@aigo/$name" bundle
4. bash scripts/deploy-lambda.sh

#### deploy-heavy-worker (ECS)
- **조건**: infra 성공 또는 skipped + `detect-changes.outputs.api == 'true'`
- ECR login → Docker build + push → jq로 읽기전용 필드 제거 → register-task-definition

#### deploy-dashboard (S3 + CloudFront)
- **조건**: infra 성공 또는 skipped + `detect-changes.outputs.dashboard == 'true'`
- **Cognito 설정값 자체 조회**: `terraform init -reconfigure` + `terraform output -raw` (deploy-infra 출력 비의존)
- Vite build (VITE_* 환경변수 주입) → S3 sync → CloudFront invalidation `/*`

> **설계 이유**: deploy-dashboard가 deploy-infra 잡 outputs에 의존하면 infra가 skip될 때 VITE_COGNITO_* 값을 얻지 못한다. 대신 직접 Terraform state를 읽어 항상 최신값 사용.

---

## 배포 스크립트

### scripts/deploy-lambda.sh

**Canary 배포 전략:**
1. `update-function-code --publish` → 새 버전 번호 획득
2. 현재 `live` alias 버전 조회
3. **첫 배포 감지** (CURRENT == NEW): canary 건너뛰고 100% 즉시 배포
4. 일반 배포: `update-alias` with `AdditionalVersionWeights:{"NEW":0.1}` (10% canary)
5. 60초 대기 → CloudWatch 알람 `${FUNCTION_NAME}-error-rate` 확인
6. ALARM → 롤백 (이전 버전 100%) / OK → 100% 프로모션

**핵심 수정 이력:**
- 가중치: `10` (정수, 범위초과) → `0.1` (소수 0.0–1.0)
- routing-config 형식: shorthand `{}` → JSON `{"AdditionalVersionWeights":{...}}`
- routing-config 초기화: `'{}'` → `'{"AdditionalVersionWeights":{}}'`
- 알람명: `${FUNCTION_NAME}-error-rate-alarm` → `${FUNCTION_NAME}-error-rate` (Terraform 일치)

### scripts/deploy-agent.sh

Strands Agent를 Bedrock AgentCore에 배포:
1. uv pip install → zip 패키징
2. S3 업로드 (aigo-agent-packages 버킷)
3. bedrock prepare-agent + create-agent-version
4. Agent alias를 새 버전으로 업데이트

### scripts/rollback.sh

수동 롤백: 지정 버전으로 live alias 즉시 전환.
버전 미지정 시 현재 버전 - 1로 롤백.

---

## IAM 역할 구조 (github-actions-deploy)

정책 4개 (인라인 → 관리형 정책, 10,240 byte 한도 초과로 전환):

| 정책명 | 주요 권한 |
|--------|----------|
| `github_actions_core` | Lambda 배포 액션, S3(artifacts/agent-packages), TF state/lock, KMS, Bedrock Agent, SSMRead |
| `github_actions_tf_infra` | ec2:*, ecs:*, ecr:*, iam:*, kms:*, **lambda:** |
| `github_actions_tf_data` | s3:*, dynamodb:*, sqs:*, secretsmanager:*, sns:*, events:*, schemas:* |
| `github_actions_tf_platform` | cloudwatch:*, logs:*, cognito-idp:*, apigateway:*, cloudfront:*, wafv2:*, guardduty:*, aoss:*, **bedrock:***, **cloudtrail:***, **ssm:** |

> **참고:** Terraform refresh 단계에서 각 서비스의 Describe/Get 액션이 필요하여 service wildcard 채택. 서비스 구동 안정화 이후 최소 권한으로 tightening 권장.

---

## 운영 노트

### Terraform stale lock 자동 해제
`cd-deploy.yml`에서 매 apply 전 S3 `.tflock` 파일 존재 여부 확인 후 unconditional force-unlock.  
`concurrency: cancel-in-progress: false`로 병렬 실행 방지.

### ECR 리포지토리
`infra/terraform/modules/ecs/main.tf`에서 `aws_ecr_repository.heavy_worker` 관리.  
암호화: AES256 (KMS key policy 충돌 회피).  
Lifecycle: 최근 10개 이미지 유지.

### 수정 이력 전체

| 문서 | 내용 | 섹션 수 |
|------|------|---------|
| `docs/impl/cicd-fixes.md` | GitHub Actions 워크플로우 오류 | #1–#24 |
| `docs/impl/terraform-apply-fixes.md` | Terraform apply 오류 + 인프라 설정 오류 | #1–#23 |

CI/CD 파이프라인 이슈 → `cicd-fixes.md`  
Terraform 모듈/리소스 설정 이슈 → `terraform-apply-fixes.md`

---

## 보안 설계

| 항목 | 구현 |
|------|------|
| AWS 자격증명 | OIDC WebIdentity (장기 키 없음) |
| Terraform 상태 | S3 네이티브 잠금 (`use_lockfile = true`, Terraform 1.10+) |
| 비밀 관리 | AWS Secrets Manager (앱 시크릿), GitHub Secrets (배포 설정값) |
| 환경 보호 | `production` GitHub Environment (Terraform apply 승인 필요) |
| 코드 서명 | 없음 (향후 적용 가능) |
