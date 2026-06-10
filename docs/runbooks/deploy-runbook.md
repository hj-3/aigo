# AgentOps Platform — 배포 런북

> 이 문서를 위에서 아래로 순서대로 따라가면 완전한 배포가 완료된다.  
> 각 단계 완료 후 `[ ]`를 `[x]`로 체크한다.

---

## 사전 확인

- [ ] AWS 계정 접근 권한 확인 (Admin 또는 필요 권한 보유)
- [ ] AWS CLI 설치 및 `aws configure` 완료
- [ ] Terraform v1.9+ 설치: `terraform -version`
- [ ] GitHub 리포지토리 생성 완료
- [ ] GitHub CLI 설치: `gh --version`

---

## Phase A — Terraform 상태 저장소 생성

Terraform 상태를 저장할 S3 버킷만 생성한다.  
잠금은 `use_lockfile = true`(Terraform 1.10+)로 S3 네이티브 잠금을 사용하므로 DynamoDB 테이블 불필요.

```bash
AWS_REGION="ap-northeast-2"

# S3 상태 버킷
aws s3api create-bucket \
  --bucket aigo-tf-state \
  --region $AWS_REGION \
  --create-bucket-configuration LocationConstraint=$AWS_REGION

aws s3api put-bucket-versioning \
  --bucket aigo-tf-state \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket aigo-tf-state \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

- [x] S3 버킷 `aigo-tf-state` 생성 완료

---

## Phase B — Global IAM 배포 (GitHub OIDC 역할)

GitHub Actions가 AWS에 접근할 수 있도록 OIDC 역할을 먼저 생성한다.

```bash
cd infra/terraform/global/iam

# terraform.tfvars 작성
cat > terraform.tfvars <<EOF
aws_account_id = "YOUR_ACCOUNT_ID"   # ← 실제 AWS 계정 ID
github_org     = "YOUR_ORG_NAME"     # ← GitHub 조직명 또는 사용자명
project        = "aigo"
aws_region     = "ap-northeast-2"
EOF

terraform init
terraform plan
terraform apply
```

완료 후 출력된 `github_actions_role_arn` 값을 메모한다:

```
github_actions_role_arn = "arn:aws:iam::XXXXXXXXXXXX:role/aigo-github-actions-deploy"
```

- [x] `infra/terraform/global/iam/` 적용 완료
- [x] `github_actions_role_arn` 메모 완료

---

## Phase C — 외부 서비스 등록

### C-1. GitHub App 등록

1. GitHub → **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**
2. 다음 값으로 설정:

   | 항목 | 값 |
   |------|-----|
   | GitHub App name | `AIGoAgent-Bot` |
   | Homepage URL | `https://your-domain.com` |
   | Webhook URL | (임시로 `https://example.com` 입력, Phase F에서 업데이트) |
   | Webhook secret | 터미널에서 `openssl rand -hex 32` 실행 → 출력된 64자리 문자열을 복사해서 입력 (이 값을 따로 메모 — Phase C-3에서 재사용) |

3. 권한 설정:
   - **Repository permissions**: Pull requests (Read & Write), Contents (Read & Write), Checks (Read & Write), Issues (Read & Write)
   - **Subscribe to events**: Pull request, Push

4. App 생성 후 확인:
   - App ID 메모
   - Private Key 생성 → `.pem` 파일 다운로드
   - App 설치: **Install App** → 대상 Organization 선택
   - 설치 후 URL의 숫자 = Installation ID 메모

- [ ] GitHub App 생성 완료
- [ ] App ID: `___________`
- [ ] Installation ID: `___________`
- [ ] Private Key `.pem` 파일 다운로드 완료
- [ ] Webhook Secret 메모 완료 (터미널에서 생성한 값)

### C-2. Slack App 등록

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. App Name: `AgentOps`, Workspace 선택
3. **OAuth & Permissions** → **Bot Token Scopes** 추가:
   - `chat:write`, `chat:write.public`, `channels:read`
4. **Install to Workspace** → Bot User OAuth Token (`xoxb-...`) 메모
5. **Basic Information** → **Signing Secret** 메모
6. **Slash Commands** → 각각 생성 (URL은 Phase F에서 업데이트):
   - `/approve`, `/reject`, `/investigate`

- [ ] Slack App 생성 완료
- [ ] Bot Token (`xoxb-...`) 메모 완료
- [ ] Signing Secret 메모 완료

### C-3. Secrets Manager 초기화

```bash
AWS_REGION="ap-northeast-2"

# GitHub App 시크릿
aws secretsmanager create-secret \
  --region $AWS_REGION \
  --name "aigo/github-app" \
  --description "GitHub App credentials for AgentOps" \
  --secret-string '{
    "appId": "YOUR_APP_ID",
    "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
    "installationId": "YOUR_INSTALLATION_ID",
    "webhookSecret": "YOUR_WEBHOOK_SECRET"
  }'

# Slack 시크릿
aws secretsmanager create-secret \
  --region $AWS_REGION \
  --name "aigo/slack" \
  --description "Slack App credentials for AgentOps" \
  --secret-string '{
    "botToken": "xoxb-...",
    "signingSecret": "YOUR_SIGNING_SECRET"
  }'
```

- [ ] `aigo/github-app` 시크릿 생성 완료
- [ ] `aigo/slack` 시크릿 생성 완료

---

## Phase D — terraform.tfvars 작성 및 인프라 배포

```bash
cd infra/terraform/envs/prod

# terraform.tfvars.example → terraform.tfvars 복사 후 수정
cp terraform.tfvars.example terraform.tfvars
```

`terraform.tfvars` 파일에서 다음 값을 실제 값으로 교체:

```hcl
aws_account_id = "XXXXXXXXXXXX"         # 12자리 AWS 계정 ID
github_org     = "your-org-name"        # GitHub 조직명
alert_email    = "ops@your-domain.com"  # CloudWatch 알림 수신 이메일
domain_name    = "aigo.your-domain.com" # 도메인 없으면 "" 로 설정
```

```bash
terraform init
terraform plan -out=tfplan
# plan 내용 검토 후
terraform apply tfplan
```

완료 후 output 값 메모:

```
api_gateway_url              = "https://XXXXXXXXXX.execute-api.ap-northeast-2.amazonaws.com/prod"
dashboard_bucket_name        = "aigo-dashboard-XXXXXXXXXX"
cloudfront_distribution_id   = "EXXXXXXXXXXXX"
cloudfront_domain            = "XXXXXXX.cloudfront.net"
cognito_user_pool_id         = "ap-northeast-2_XXXXXXXXX"
cognito_client_id            = "XXXXXXXXXXXXXXXXXXXXXXXXXX"
cognito_domain               = "aigo-XXXXXXXX.auth.ap-northeast-2.amazoncognito.com"
```

- [ ] `terraform.tfvars` 작성 완료
- [ ] `terraform apply` 성공
- [ ] 모든 output 값 메모 완료

---

## Phase E — GitHub Secrets 설정

GitHub 리포지토리 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret 이름 | 값 |
|------------|-----|
| `AWS_ACCOUNT_ID` | AWS 계정 12자리 ID |
| `AWS_GITHUB_ACTIONS_ROLE_ARN` | Phase B output의 `github_actions_role_arn` |
| `GH_ORG` | GitHub 조직명 (코드 레포 소유 계정/조직) |
| `ALERT_EMAIL` | 알림 이메일 |
| `DOMAIN_NAME` | 도메인명 (없으면 CloudFront 도메인) |
| `API_GATEWAY_URL` | Phase D output의 `api_gateway_url` |
| `DASHBOARD_BUCKET_NAME` | Phase D output의 `dashboard_bucket_name` |
| `CLOUDFRONT_DISTRIBUTION_ID` | Phase D output의 `cloudfront_distribution_id` |

- [ ] 8개 GitHub Secrets 모두 설정 완료

---

## Phase F — 외부 서비스 URL 업데이트

Phase D에서 확인한 `api_gateway_url`로 외부 서비스 URL을 업데이트한다.

### GitHub App Webhook URL 업데이트

GitHub → **Settings** → **Developer settings** → **GitHub Apps** → 앱 선택 → **Edit**

```
Webhook URL: https://API_GATEWAY_URL/github/webhook
```

### Slack Slash Command URL 업데이트

api.slack.com → 앱 선택 → **Slash Commands** → 각 커맨드 Edit

```
/approve    →  https://API_GATEWAY_URL/slack/commands
/reject     →  https://API_GATEWAY_URL/slack/commands
/investigate → https://API_GATEWAY_URL/slack/commands
```

Slack **Interactivity & Shortcuts** → **Request URL**:
```
https://API_GATEWAY_URL/slack/events
```

- [ ] GitHub App Webhook URL 업데이트 완료
- [ ] Slack Slash Command URL 3개 업데이트 완료

---

## Phase G — 애플리케이션 배포 (GitHub Actions)

### G-1. Bedrock Agent 배포

```bash
# 7개 에이전트를 순서대로 배포 (Orchestrator 마지막)
./scripts/deploy-agent.sh code-reviewer
./scripts/deploy-agent.sh infra-reviewer
./scripts/deploy-agent.sh risk-reviewer
./scripts/deploy-agent.sh security-agent
./scripts/deploy-agent.sh incident-agent
./scripts/deploy-agent.sh fix-agent
./scripts/deploy-agent.sh orchestrator
```

- [ ] 7개 Agent 배포 완료

### G-2. CD 파이프라인 실행

GitHub 리포지토리 → **Actions** → **CD: Deploy** → **Run workflow**

선택 항목:
- [x] Deploy Infrastructure (건너뜀 - Phase D에서 완료)
- [x] Deploy Lambda Functions
- [x] Deploy Heavy Worker (ECS)
- [x] Deploy Dashboard

- [ ] Lambda 6개 배포 완료 (github-connector, slack-connector, aws-event-connector, dashboard-cmd-connector, worker-lightweight, dashboard-api)
- [ ] ECS heavy-worker 이미지 배포 완료
- [ ] Dashboard S3 + CloudFront 배포 완료

---

## Phase H — 초기 데이터 설정

### H-1. Cognito 첫 번째 OWNER 사용자 생성

```bash
USER_POOL_ID="ap-northeast-2_XXXXXXXXX"  # Phase D output

aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username "admin@your-domain.com" \
  --temporary-password "TempPass123!" \
  --user-attributes \
    Name=email,Value="admin@your-domain.com" \
    Name=email_verified,Value=true \
    Name=custom:orgId,Value="org-001" \
    Name=custom:role,Value="OWNER" \
  --message-action SUPPRESS

# 임시 비밀번호를 영구 비밀번호로 변경
aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username "admin@your-domain.com" \
  --password "YourStrongPassword123!" \
  --permanent
```

- [ ] 첫 OWNER 사용자 생성 완료

### H-2. 조직 DynamoDB 레코드 생성

```bash
aws dynamodb put-item \
  --table-name aigo-Organizations \
  --item '{
    "PK": {"S": "ORG#org-001"},
    "SK": {"S": "METADATA"},
    "orgId": {"S": "org-001"},
    "name": {"S": "Your Organization"},
    "autoAnalyzeOnPR": {"BOOL": true},
    "approvalRequired": {"BOOL": true},
    "riskThreshold": {"S": "HIGH"},
    "timezone": {"S": "Asia/Seoul"},
    "createdAt": {"S": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}
  }' \
  --region ap-northeast-2
```

- [ ] Organizations 초기 레코드 생성 완료

### H-3. Knowledge Base 문서 업로드

```bash
KB_BUCKET="aigo-kb"  # Terraform output 확인

# 폴더 구조 생성 및 문서 업로드
# coding-standards/
aws s3 cp docs/kb/coding-standards/ s3://$KB_BUCKET/coding-standards/ --recursive
aws s3 cp docs/kb/coding-standards.metadata.json s3://$KB_BUCKET/coding-standards/.metadata.json

# infrastructure-standards/
aws s3 cp docs/kb/infrastructure-standards/ s3://$KB_BUCKET/infrastructure-standards/ --recursive

# security-policies/
aws s3 cp docs/kb/security-policies/ s3://$KB_BUCKET/security-policies/ --recursive

# risk-policies/
aws s3 cp docs/kb/risk-policies/ s3://$KB_BUCKET/risk-policies/ --recursive

# Bedrock KB 동기화 트리거
KB_ID=$(aws ssm get-parameter --name "/aigo/bedrock/kb-id" --query "Parameter.Value" --output text)
DATA_SOURCE_IDS=$(aws bedrock-agent list-data-sources --knowledge-base-id $KB_ID --query "dataSourceSummaries[*].dataSourceId" --output text)
for DS_ID in $DATA_SOURCE_IDS; do
  aws bedrock-agent start-ingestion-job --knowledge-base-id $KB_ID --data-source-id $DS_ID
done
```

각 문서의 `.metadata.json` 사이드카 형식:
```json
{ "metadataAttributes": { "category": "coding_standards" } }
```

카테고리 값: `coding_standards` | `infrastructure_standards` | `security_policies` | `risk_policies`

- [ ] KB 문서 S3 업로드 완료
- [ ] Bedrock 인제스션 Job 실행 완료

---

## Phase I — 배포 검증

### I-1. 헬스체크

```bash
API_URL="https://API_GATEWAY_URL"

# API Gateway 헬스체크
curl -s "$API_URL/health" | jq .

# Dashboard 접근
echo "Dashboard URL: https://CLOUDFRONT_DOMAIN"
```

### I-2. GitHub Webhook 테스트

테스트 리포지토리에 PR을 생성하고 다음을 확인:
- [ ] GitHub App이 Webhook을 수신 (GitHub App → Advanced → Recent Deliveries 확인)
- [ ] github-connector Lambda 실행 로그 확인 (CloudWatch)
- [ ] DynamoDB `aigo-AnalysisJobs` 테이블에 레코드 생성 확인
- [ ] SQS `analysis-queue` 메시지 발행 확인

### I-3. 대시보드 로그인 테스트

- [ ] `https://CLOUDFRONT_DOMAIN` 접근 → Cognito Hosted UI 리다이렉트 확인
- [ ] Phase H-1에서 생성한 계정으로 로그인 성공
- [ ] Dashboard 메인 화면 정상 표시

### I-4. CloudWatch 알람 확인

```bash
# 생성된 알람 목록 확인
aws cloudwatch describe-alarms \
  --alarm-name-prefix "aigo-" \
  --query "MetricAlarms[*].[AlarmName,StateValue]" \
  --output table \
  --region ap-northeast-2
```

- [ ] 모든 알람 `OK` 상태 확인

---

## 배포 완료 체크리스트

- [ ] Phase A — Terraform 상태 저장소 생성
- [ ] Phase B — Global IAM (GitHub OIDC) 배포
- [ ] Phase C — GitHub App + Slack App 등록 + Secrets Manager 초기화
- [ ] Phase D — 인프라 Terraform apply
- [ ] Phase E — GitHub Secrets 8개 설정
- [ ] Phase F — Webhook/Slash Command URL 업데이트
- [ ] Phase G — 애플리케이션 배포 (Agents + Lambda + ECS + Dashboard)
- [ ] Phase H — 초기 데이터 설정 (Cognito 사용자, Organization, KB 문서)
- [ ] Phase I — 배포 검증

---

## 롤백

```bash
# Lambda 롤백 (이전 버전으로)
./scripts/rollback.sh connector-github
./scripts/rollback.sh dashboard-api

# Terraform 롤백 (상태 파일 기준)
cd infra/terraform/envs/prod
terraform apply -target=module.SPECIFIC_MODULE -var-file=terraform.tfvars
```

---

## 참고 문서

- [04-infrastructure](./04-infrastructure.md) — VPC, 서비스별 구성
- [08-security](./08-security.md) — 인증/인가, WAF, IAM
- [impl/phase-8-infra-ops](./impl/phase-8-infra-ops.md) — Monitoring/Security 모듈
- [runbooks/rollback](./runbooks/rollback.md) — Lambda / Agent 롤백 절차
- [runbooks/incident-response](./runbooks/incident-response.md) — 장애 대응 절차
