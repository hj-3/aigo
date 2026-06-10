# CI/CD 전략

## 설계 원칙

- **OIDC 인증**: 장기 AWS 자격증명(Access Key) 사용 금지. GitHub OIDC Provider → IAM Role 방식만 허용
- **Path-based 선택 배포**: 변경된 컴포넌트만 빌드·배포. 전체 배포 금지
- **무중단 배포**: Lambda Alias + 가중치 기반 canary 배포
- **자동 롤백**: 배포 후 에러율 임계치 초과 시 자동 롤백
- **시크릿 Zero**: 코드·환경변수·workflow에 시크릿 직접 없음. Secrets Manager 참조만 허용

---

## 브랜치 전략

```
main
  │  ← 프로덕션 상태. 직접 push 금지. PR 머지만 허용
  │  ← v{major}.{minor}.{patch} 태그 → 프로덕션 배포 트리거
  │
  ├── feature/{ticket}-{description}
  │     └── PR → main (CI 통과 + 리뷰어 1명 이상 승인 필수)
  │
  └── hotfix/{ticket}-{description}
        └── main에서 분기 → PR → main
              └── 긴급 배포 workflow 트리거
```

**브랜치 보호 규칙 (main)**:
- 직접 push 금지
- PR 필수 (리뷰어 1명 이상)
- CI 모든 체크 통과 필수
- Force push 금지
- 삭제 금지

---

## GitHub OIDC 인증 구성

```
GitHub Actions
    │
    │ (OIDC 토큰 발급)
    ▼
AWS STS AssumeRoleWithWebIdentity
    │
    ▼
IAM Role: aigo-github-ci-role
    │
    ├── 조건: repo:aigo-platform/aigo:ref:refs/heads/main
    ├── 조건: repo:aigo-platform/aigo:ref:refs/tags/v*
    └── 권한: 배포에 필요한 최소 권한만
```

**CI Role 권한 (최소 권한)**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::aigo-artifacts/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:PublishVersion",
        "lambda:UpdateAlias"
      ],
      "Resource": "arn:aws:lambda:ap-northeast-2:{account}:function:aigo-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "arn:aws:ecr:ap-northeast-2:{account}:repository/aigo-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateInvalidation"
      ],
      "Resource": "arn:aws:cloudfront::{account}:distribution/{distId}"
    }
  ]
}
```

---

## Workflow 구성

### CI Workflows

모든 CI는 PR 생성/업데이트 시 실행. 컴포넌트별 path filter로 필요한 것만 실행.

#### ci-infra.yml

```yaml
name: CI - Infrastructure

on:
  pull_request:
    paths:
      - 'infra/**'
      - '.github/workflows/ci-infra.yml'

jobs:
  terraform:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
      pull-requests: write

    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::{account}:role/aigo-github-ci-role
          aws-region: ap-northeast-2

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "~1.9"

      - name: Terraform Format Check
        run: terraform fmt -check -recursive
        working-directory: infra/terraform

      - name: Terraform Init
        run: terraform init
        working-directory: infra/terraform/envs/prod

      - name: Terraform Validate
        run: terraform validate
        working-directory: infra/terraform/envs/prod

      - name: Checkov Security Scan
        uses: bridgecrewio/checkov-action@v12
        with:
          directory: infra/terraform
          framework: terraform
          soft_fail: false

      - name: tfsec
        uses: aquasecurity/tfsec-action@v1
        with:
          working_directory: infra/terraform

      - name: Terraform Plan
        id: plan
        run: terraform plan -no-color -out=tfplan
        working-directory: infra/terraform/envs/prod

      - name: Post Plan to PR
        uses: actions/github-script@v7
        with:
          script: |
            const output = `#### Terraform Plan 📋
            \`\`\`
            ${{ steps.plan.outputs.stdout }}
            \`\`\``;
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: output
            })
```

#### ci-agents.yml

```yaml
name: CI - Agents

on:
  pull_request:
    paths:
      - 'agents/**'
      - 'libs/**'
      - 'prompts/**'
      - '.github/workflows/ci-agents.yml'

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: astral-sh/setup-uv@v3
        with:
          version: "latest"

      - name: Install dependencies
        run: uv sync --all-packages

      - name: Lint (ruff)
        run: uv run ruff check agents/ libs/

      - name: Format Check (ruff)
        run: uv run ruff format --check agents/ libs/

      - name: Type Check (pyright)
        run: uv run pyright agents/ libs/

      - name: Run Tests
        run: uv run pytest agents/ libs/ -v --cov --cov-report=xml

      - name: Coverage Check
        run: uv run pytest --cov --cov-fail-under=80

      - name: Package Agents
        run: |
          for agent in agents/*/; do
            name=$(basename $agent)
            cd $agent
            uv build --wheel
            cd ../..
          done
```

#### ci-dashboard.yml

```yaml
name: CI - Dashboard

on:
  pull_request:
    paths:
      - 'apps/dashboard/**'
      - 'packages/**'
      - '.github/workflows/ci-dashboard.yml'

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - name: Type Check
        run: pnpm --filter dashboard tsc --noEmit

      - name: Lint
        run: pnpm --filter dashboard eslint src/

      - name: Test
        run: pnpm --filter dashboard vitest run --coverage

      - name: Build
        run: pnpm --filter dashboard build
```

#### ci-api.yml

```yaml
name: CI - API & Connectors

on:
  pull_request:
    paths:
      - 'apps/dashboard-api/**'
      - 'connectors/**'
      - 'workers/lightweight/**'
      - 'packages/**'

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - name: Type Check (all)
        run: pnpm -r tsc --noEmit

      - name: Lint
        run: pnpm -r eslint src/

      - name: Test
        run: pnpm -r vitest run

      - name: Build (esbuild bundle)
        run: pnpm -r build
```

---

### CD Workflow

#### cd-deploy.yml (프로덕션 배포)

```yaml
name: CD - Deploy

on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  # 1단계: 빌드 및 아티팩트 업로드
  build:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::{account}:role/aigo-github-ci-role
          aws-region: ap-northeast-2

      # Lambda ZIP 빌드
      - name: Build Lambda ZIPs
        run: |
          pnpm install --frozen-lockfile
          pnpm -r build
          # 각 Lambda를 ZIP으로 패키징 → S3 업로드

      # Agent ZIP 빌드
      - name: Build Agent ZIPs
        run: |
          uv sync --all-packages
          for agent in agents/*/; do
            # ZIP 패키징 → S3 업로드
          done

      # Dashboard 빌드
      - name: Build Dashboard
        run: |
          pnpm --filter dashboard build

      # ECS 이미지 빌드
      - name: Build & Push ECS Image
        run: |
          aws ecr get-login-password | docker login --username AWS --password-stdin {ecr}
          docker build -t aigo-heavy-worker workers/heavy/
          docker tag aigo-heavy-worker {ecr}/aigo-heavy-worker:{tag}
          docker push {ecr}/aigo-heavy-worker:{tag}

  # 2단계: Terraform apply (인프라 변경 시)
  infra:
    needs: build
    runs-on: ubuntu-latest
    environment: production  # GitHub Environment: 지정된 리뷰어 승인 필요
    permissions:
      id-token: write

    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::{account}:role/aigo-github-ci-role
          aws-region: ap-northeast-2
      - uses: hashicorp/setup-terraform@v3
      - name: Terraform Apply
        run: terraform apply -auto-approve
        working-directory: infra/terraform/envs/prod

  # 3단계: Lambda 배포 (canary)
  deploy-lambda:
    needs: infra
    runs-on: ubuntu-latest
    permissions:
      id-token: write

    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::{account}:role/aigo-github-ci-role
          aws-region: ap-northeast-2

      - name: Deploy Lambda (Canary 10%)
        run: |
          # Lambda 함수별 새 버전 발행
          # alias live: 90% 기존 + 10% 신규
          for func in github-connector slack-connector dashboard-api lightweight-worker; do
            VERSION=$(aws lambda publish-version --function-name aigo-$func --query Version --output text)
            PREV_VERSION=$(aws lambda get-alias --function-name aigo-$func --name live --query FunctionVersion --output text)
            aws lambda update-alias \
              --function-name aigo-$func \
              --name live \
              --routing-config "AdditionalVersionWeights={\"$VERSION\":0.1}" \
              --function-version $PREV_VERSION
          done

      - name: Wait & Monitor (5 minutes)
        run: sleep 300

      - name: Check Error Rate
        id: check
        run: |
          # CloudWatch에서 에러율 확인
          ERROR_RATE=$(aws cloudwatch get-metric-statistics ...)
          if (( $(echo "$ERROR_RATE > 5" | bc -l) )); then
            echo "error_rate_exceeded=true" >> $GITHUB_OUTPUT
          fi

      - name: Rollback if Error Rate High
        if: steps.check.outputs.error_rate_exceeded == 'true'
        run: |
          # alias를 이전 버전으로 100% 복원
          echo "Error rate exceeded. Rolling back..."
          for func in github-connector slack-connector dashboard-api lightweight-worker; do
            aws lambda update-alias \
              --function-name aigo-$func \
              --name live \
              --function-version $PREV_VERSION \
              --routing-config "AdditionalVersionWeights={}"
          done
          exit 1

      - name: Full Rollout (100%)
        if: steps.check.outputs.error_rate_exceeded != 'true'
        run: |
          for func in github-connector slack-connector dashboard-api lightweight-worker; do
            aws lambda update-alias \
              --function-name aigo-$func \
              --name live \
              --function-version $VERSION \
              --routing-config "AdditionalVersionWeights={}"
          done

  # 4단계: Dashboard 배포
  deploy-dashboard:
    needs: infra
    runs-on: ubuntu-latest
    permissions:
      id-token: write

    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::{account}:role/aigo-github-ci-role
          aws-region: ap-northeast-2

      - name: S3 Sync
        run: aws s3 sync apps/dashboard/dist/ s3://aigo-frontend/ --delete

      - name: CloudFront Invalidation
        run: aws cloudfront create-invalidation --distribution-id {distId} --paths "/*"

  # 5단계: Agent 배포 (AgentCore)
  deploy-agents:
    needs: infra
    runs-on: ubuntu-latest
    permissions:
      id-token: write

    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::{account}:role/aigo-github-ci-role
          aws-region: ap-northeast-2

      - name: Deploy Agents to AgentCore
        run: |
          for agent in orchestrator code-reviewer infra-reviewer risk-reviewer security-agent incident-agent fix-agent; do
            ./scripts/deploy-agent.sh $agent {version}
          done

  # 6단계: Smoke Test
  smoke-test:
    needs: [deploy-lambda, deploy-dashboard, deploy-agents]
    runs-on: ubuntu-latest

    steps:
      - name: Health Check
        run: |
          curl -f https://api.{domain}/health || exit 1
          curl -f https://app.{domain}/ || exit 1
```

#### cd-hotfix.yml (긴급 배포)

```yaml
name: CD - Hotfix

on:
  push:
    branches:
      - 'hotfix/*'

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production-hotfix  # 별도 Environment, 더 빠른 승인
    # ... hotfix는 canary 없이 즉시 전체 배포
```

---

## 배포 방식 요약

| 컴포넌트 | 배포 방식 | Rollback |
|----------|-----------|----------|
| Lambda | Alias + Canary (10% → 100%) | Alias 이전 버전으로 복원 |
| Dashboard (S3+CF) | S3 Sync + CF Invalidation | S3 이전 버전 복원 + CF Invalidation |
| ECS Heavy Worker | ECR Tag 업데이트 | 이전 Task Definition 버전 |
| Agents (AgentCore) | ZIP 업로드 + 버전 업데이트 | 이전 버전 ZIP으로 복원 |
| Terraform (인프라) | `terraform apply` | `terraform apply` (이전 상태) |

---

## 버전 관리

### Semantic Versioning

```
v{major}.{minor}.{patch}

major: Breaking change (API 스키마 변경, DB 마이그레이션 필요)
minor: 새 기능 추가 (하위 호환)
patch: 버그 수정, 보안 패치
```

### Prompt 버전 관리

```
prompts/
  v1/         ← 첫 번째 안정 버전
  v2/         ← 향후 개선 버전
  current -> v1  ← symlink

AgentCore Runtime 배포 시 prompt 버전을 명시적으로 지정.
A/B 테스트 가능: 일부 요청만 v2로 라우팅.
```

---

## CI 속도 최적화

| 전략 | 적용 |
|------|------|
| pnpm cache | `actions/setup-node` cache: pnpm |
| uv cache | `astral-sh/setup-uv` 캐시 |
| Path filter | 변경된 컴포넌트만 CI 실행 |
| Parallel jobs | 독립적인 테스트는 병렬 실행 |
| Docker layer cache | ECR 레이어 캐시 활용 |
| esbuild | TypeScript 번들 속도 최적화 |

---

## 보안 체크 항목 (CI 필수 통과)

| 체크 | 도구 | 실패 시 |
|------|------|---------|
| IaC 보안 스캔 | Checkov | CI 실패 |
| IaC 보안 스캔 | tfsec | CI 실패 |
| 시크릿 감지 | truffleHog / gitleaks | CI 실패 |
| Python 취약점 | `uv pip audit` | CI 경고 (Critical 이상 실패) |
| Node.js 취약점 | `pnpm audit` | CI 경고 (Critical 이상 실패) |
| SBOM 생성 | syft | 아티팩트 저장 |
