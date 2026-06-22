# Incident Management — Operations Guide

## 1. 격리 구조 요약

IM(Incident Management)은 기존 aigo 코어 서비스와 완전히 격리된 독립 스택으로 운영됩니다.

| 항목 | 코어 서비스 | IM |
|------|------------|-----|
| Terraform 상태 | `aigo-tf-state` / `prod/terraform.tfstate` | `aigo-tf-state` / `im/prod/terraform.tfstate` |
| Terraform 환경 | `infra/terraform/envs/prod/` | `infra/terraform/envs/im/` |
| CD 워크플로우 | `.github/workflows/cd-deploy.yml` | `.github/workflows/cd-im.yml` |
| CI 워크플로우 | `ci-agents.yml`, `ci-api.yml`, `ci-dashboard.yml`, `ci-infra.yml` | `ci-im.yml` |
| 소스 경로 | `apps/dashboard*`, `connectors/`, `workers/lightweight`, `agents/orchestrator` | `apps/im-api/`, `agents/im-*`, `workers/im-*` |

### Terraform 상태 격리

두 환경은 같은 S3 버킷(`aigo-tf-state`)을 사용하지만 **state key가 완전히 다릅니다**. 서로의 state를 절대 공유하지 않습니다.

```
aigo-tf-state/
├── prod/terraform.tfstate          ← 코어 서비스 (envs/prod)
├── global/iam/terraform.tfstate    ← 코어 IAM (global/iam)
└── im/prod/terraform.tfstate       ← IM 전용 (envs/im)
```

### CI/CD 격리

- **트리거 경로 격리**: `cd-deploy.yml`은 `infra/terraform/envs/im/**`와 `infra/terraform/modules/im-*/**` 변경을 무시합니다. IM infra 변경은 `cd-im.yml`만 실행합니다.
- **동시성 그룹 공유**: 두 CD 워크플로우 모두 `concurrency: group: terraform-deploy`를 사용해 Terraform 병렬 실행을 방지합니다.
- **적용 범위 격리**: `cd-deploy.yml`은 `envs/prod`만 apply, `cd-im.yml`은 `envs/im`만 apply합니다.

---

## 2. IM Deploy

### 2-1. 전체 IM 스택 배포 (처음 구축 시)

```bash
# 1. IM Terraform 인프라 적용
cd infra/terraform/envs/im
terraform init
terraform apply -var="aws_account_id=<ACCOUNT_ID>" -var="alert_email=<EMAIL>"

# 2. IM API Lambda 배포
cd <repo-root>
bash scripts/deploy-lambda.sh im-api aigo-im-api

# 3. IM 에이전트 & 워커 Lambda 배포 (각 항목에 대해 반복)
bash scripts/deploy-im-lambda.sh agents/im-supervisor  aigo-im-supervisor-agent
bash scripts/deploy-im-lambda.sh agents/im-scope       aigo-im-scope-agent
bash scripts/deploy-im-lambda.sh agents/im-summary     aigo-im-summary-agent
bash scripts/deploy-im-lambda.sh agents/im-security    aigo-im-security-agent
bash scripts/deploy-im-lambda.sh agents/im-chat        aigo-im-chat-agent
bash scripts/deploy-im-lambda.sh workers/im-normalize-event   aigo-im-normalize-event
bash scripts/deploy-im-lambda.sh workers/im-webhook-receiver  aigo-im-webhook-receiver
bash scripts/deploy-im-lambda.sh workers/im-security-event    aigo-im-security-event
bash scripts/deploy-im-lambda.sh workers/im-poll-investigation aigo-im-poll-investigation
bash scripts/deploy-im-lambda.sh workers/im-action-executor   aigo-im-action-executor
```

### 2-2. GitHub Actions를 통한 자동 배포

`main` 브랜치에 IM 관련 경로(`apps/im-api/**`, `agents/im-*/**`, `workers/im-*/**`, `infra/terraform/envs/im/**`, `infra/terraform/modules/im-*/**`) 변경이 push되면 `cd-im.yml`이 자동으로 실행됩니다.

**수동 전체 배포 (workflow_dispatch):**
1. GitHub → Actions → `CD — Incident Management Deploy`
2. `Run workflow` → `component: all` 선택 → `Run workflow`

**컴포넌트별 개별 배포:**
- `infra`: Terraform만 apply
- `api`: im-api Lambda만 배포
- `agents`: 에이전트/워커 Lambda만 배포

---

## 3. IM Destroy

> **주의**: IM Destroy는 인시던트 이력 데이터(DynamoDB)를 포함한 모든 IM 리소스를 삭제합니다.
> DynamoDB 테이블은 `prevent_destroy` lifecycle이 설정되어 있지 않으므로 `terraform destroy`로 삭제됩니다.

```bash
cd infra/terraform/envs/im

# 상태 확인
terraform plan -destroy -var="aws_account_id=<ACCOUNT_ID>" -var="alert_email=<EMAIL>"

# 삭제 실행
terraform destroy -var="aws_account_id=<ACCOUNT_ID>" -var="alert_email=<EMAIL>"
```

**Destroy 대상 리소스:**
- DynamoDB 테이블 (incidents, investigation, recovery_actions, settings, accounts, integrations, targets)
- Lambda 함수 (im-api, im-supervisor-agent, im-scope-agent, im-summary-agent, im-security-agent, im-chat-agent, im-normalize-event, im-webhook-receiver, im-security-event, im-poll-investigation, im-action-executor)
- Step Functions 상태 머신
- EventBridge 이벤트 버스 및 규칙
- API Gateway (HTTP API)
- SES 이메일 자격증명
- IAM 역할 및 정책 (IM 전용)
- S3 버킷 (`aigo-im-reports-<account_id>`)

**코어 서비스에 영향 없음**: `envs/prod`의 state는 건드리지 않습니다.

---

## 4. CI/CD 워크플로우 상세

### IM 전용 워크플로우

| 파일 | 역할 | 트리거 |
|------|------|--------|
| `.github/workflows/ci-im.yml` | PR 검증 — TypeScript 타입체크, Python lint/test, TF validate/plan | PR (IM 경로 변경 시) |
| `.github/workflows/cd-im.yml` | 자동 배포 — TF apply → Lambda 배포 | push to main (IM 경로) |

### 코어 서비스 워크플로우 (IM 미포함)

| 파일 | 역할 | IM 경로 무시 |
|------|------|-------------|
| `ci-agents.yml` | 오케스트레이터 에이전트 lint/test | `!agents/im-*/**` 제외 |
| `ci-api.yml` | 대시보드 API / 커넥터 | IM API 경로 없음 |
| `ci-dashboard.yml` | React 대시보드 | IM 관련 없음 |
| `ci-infra.yml` | prod Terraform validate/plan | `!infra/terraform/envs/im/**` 제외 |
| `cd-deploy.yml` | 코어 전체 배포 | IM infra 경로 변경 무시 |

### IM CI 단독 실행 방법

```bash
# GitHub CLI로 수동 실행
gh workflow run ci-im.yml --ref main

# PR에서 특정 파일 경로 변경으로 자동 트리거
# apps/im-api/, agents/im-*/, workers/im-*/, infra/terraform/envs/im/, infra/terraform/modules/im-*/ 중 하나 이상 변경
```

---

## 5. 기본 서비스 독립성 검증

IM이 없거나 IM만 삭제해도 코어 aigo 서비스에 영향이 없습니다.

### 독립성 근거

**1. Terraform 상태 분리**
- `envs/prod`는 `envs/im`의 리소스를 참조(reference)하지 않습니다.
- `envs/im`은 `envs/prod`의 리소스를 `data` source로만 참조합니다 (VPC, KMS, S3 artifacts 버킷 등).
- IM destroy 후 `envs/prod` terraform apply는 정상 동작합니다.

**2. 소스 코드 분리**
- `apps/im-api/`는 독립 패키지 (`@aigo/im-api`)로, 코어 대시보드 API와 별개입니다.
- `agents/im-*`, `workers/im-*`는 오케스트레이터(`agents/orchestrator`)와 공유 코드 없음.
- 공유 패키지(`packages/`)는 단방향 의존성: IM이 `@aigo/aws-clients` 등을 사용하지만 역방향 없음.

**3. AWS 리소스 분리**
- IM Lambda 함수는 코어 SQS 큐, S3 버킷, Step Functions에 접근하지 않습니다.
- 코어 Lambda/ECS는 IM EventBridge 버스, DynamoDB 테이블을 참조하지 않습니다.
- IM API Gateway는 코어 API Gateway와 별개의 엔드포인트입니다.

**4. EventBridge 격리**
- IM은 전용 이벤트 버스 `aigo-im-event-bus`를 사용합니다.
- 코어 서비스가 사용하는 `default` 버스의 규칙과 충돌 없음.
- GuardDuty → security_event_handler만 default 버스를 구독하며, 이는 IM 전용 Lambda입니다.

### 코어 서비스만 단독 배포

```bash
# IM 없이 코어만 배포 (기존 방식 그대로)
cd infra/terraform/envs/prod
terraform apply [...]

# 또는 GitHub Actions
gh workflow run cd-deploy.yml -f component=all
```

### IM 없이 코어 CI 실행

IM 경로(`apps/im-api/**`, `agents/im-*/**` 등)를 변경하지 않으면 `ci-im.yml`과 `cd-im.yml`은 실행되지 않습니다.

---

## 6. 연계 계정(Linked Account) 설정

IM이 다른 AWS 계정의 CloudWatch 알람을 모니터링하려면 해당 계정에 IM 연계 모듈을 적용해야 합니다.

```hcl
# 연계 계정의 Terraform 코드에 추가
module "im_linked" {
  source = "github.com/your-org/aigo//infra/terraform/modules/im-linked-account"

  central_account_id  = "<중앙 계정 ID>"
  central_event_bus_arn = "arn:aws:events:ap-northeast-2:<중앙 계정 ID>:event-bus/aigo-im-event-bus"
  im_api_role_arn     = "<im-api IAM role ARN>"
  aws_region          = "ap-northeast-2"
}
```

이 모듈이 생성하는 리소스:
- EventBridge 규칙: CloudWatch ALARM 상태 → 중앙 이벤트 버스로 전달
- EventBridge 규칙: AWS Health 이벤트 → 중앙 이벤트 버스로 전달
- IAM 역할 `aigo-im-eventbridge-forward-role`: EventBridge 전달 권한
- IAM 역할 `aigo-im-cross-account-role`: im-api의 CloudWatch 조회 + ECS/Lambda/SSM 실행 권한 (ExternalId: `aigo-im-monitoring`)

---

## 7. Troubleshooting

### Terraform lock 해제

```bash
# IM Terraform lock이 걸린 경우
cd infra/terraform/envs/im
terraform force-unlock <LOCK_ID>

# lock ID 확인
aws s3 cp s3://aigo-tf-state/im/prod/terraform.tfstate.lock /tmp/im.lock && cat /tmp/im.lock | jq '.ID'
```

### Lambda 수동 재배포 (단일 함수)

```bash
# 예: scope 에이전트만 재배포
bash scripts/deploy-im-lambda.sh agents/im-scope aigo-im-scope-agent
```

### Step Functions 실행 상태 확인

```bash
# 최근 실행 목록
aws stepfunctions list-executions \
  --state-machine-arn arn:aws:states:ap-northeast-2:<ACCOUNT_ID>:stateMachine:aigo-im-investigation \
  --max-results 10

# 특정 실행 이벤트 조회
aws stepfunctions get-execution-history \
  --execution-arn <EXECUTION_ARN>
```
