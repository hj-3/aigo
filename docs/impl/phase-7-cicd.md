# Phase 7: CI/CD & Deployment

## 개요
GitHub Actions + OIDC 기반 CI/CD 파이프라인 및 배포 스크립트 구현.

## GitHub Actions Workflows

### 1. ci-infra.yml (Terraform CI)
**트리거:** infra/** 변경 시 PR + main push

**Jobs:**
1. `validate`: terraform fmt, terraform validate, tflint
2. `plan`: terraform plan + PR 댓글에 결과 게시

**OIDC:** AWS 자격증명 장기 보관 없음 (github-actions-deploy IAM role AssumeRoleWithWebIdentity)

### 2. ci-agents.yml (Python CI)
**트리거:** agents/**, tools/**, libs/**, workers/heavy/** 변경

**Jobs:**
1. `lint-and-type-check`: ruff check, ruff format --check, pyright
2. `test`: pytest
3. `docker-build`: Heavy Worker Docker 이미지 빌드 (push 없음)

### 3. ci-dashboard.yml (React CI)
**트리거:** apps/dashboard/**, packages/** 변경

**Jobs:**
1. `type-check-lint-build`: packages type-check → dashboard type-check → lint → Vite build

### 4. ci-api.yml (TypeScript Lambda CI)
**트리거:** connectors/**, workers/lightweight/**, apps/dashboard-api/**, packages/** 변경

**Jobs:**
1. `build-and-test`: type-check → lint → test → esbuild bundle 검증

### 5. cd-deploy.yml (배포)
**트리거:** main 브랜치 push + workflow_dispatch (컴포넌트 선택)

**Jobs:**
1. `deploy-infra`: Terraform apply (production environment 승인 필요)
2. `deploy-api`: Lambda 함수 matrix 배포 (6개 병렬)
   - connector-github, connector-slack, connector-aws-event, connector-dashboard-cmd
   - worker-lightweight, dashboard-api
3. `deploy-heavy-worker`: ECR 이미지 빌드+푸시 + ECS Task Definition 업데이트
4. `deploy-dashboard`: S3 sync + CloudFront 무효화

## 배포 스크립트

### scripts/deploy-lambda.sh
**Canary 배포 전략:**
1. Lambda 코드 업데이트 + 새 버전 publish
2. live alias를 기존 10% → 신규 10% canary 라우팅
3. 60초 대기 후 CloudWatch error-rate alarm 확인
4. Alarm 없음 → 100% 프로모션
5. Alarm 발생 → 자동 롤백 (이전 버전 100%)

### scripts/rollback.sh
수동 롤백: 지정 버전으로 live alias 즉시 전환.
버전 미지정 시 현재 버전 - 1로 롤백.

### scripts/deploy-agent.sh
Strands Agent를 Bedrock AgentCore에 배포:
1. uv pip install → zip 패키징
2. S3 업로드 (agent-packages 버킷)
3. Bedrock prepare-agent + create-agent-version
4. Agent alias를 새 버전으로 업데이트

## 보안 설계

### OIDC (No Long-lived Credentials)
- GitHub Actions → AWS 자격증명: OIDC web identity
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` 사용 절대 금지
- IAM Role: github-actions-deploy (최소 권한)

### Secrets 관리
- AWS Secrets Manager: GitHub App 인증, Slack Bot Token, Webhook Secret
- GitHub Secrets: AWS Account ID, Domain, CloudFront Distribution ID 등
- terraform.tfvars: 절대 커밋 금지 (.gitignore 등록)

### 환경 보호
- `production` GitHub Environment 사용
- Terraform apply: 승인 필요 (`environment: production`)
