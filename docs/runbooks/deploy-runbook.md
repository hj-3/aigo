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

- [x] GitHub App 생성 완료
- [x] App ID: (Secrets Manager에 저장됨)
- [x] Installation ID: (Secrets Manager에 저장됨)
- [x] Private Key `.pem` 파일 다운로드 완료
- [x] Webhook Secret 메모 완료 (Secrets Manager에 저장됨)

### C-2. Slack App 등록

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. App Name: `AgentOps`, Workspace 선택
3. **OAuth & Permissions** → **Bot Token Scopes** 추가:
   - `chat:write`, `chat:write.public`, `channels:read`
4. **Install to Workspace** → Bot User OAuth Token (`xoxb-...`) 메모
5. **Basic Information** → **Signing Secret** 메모
6. **Slash Commands** → 각각 생성 (URL은 Phase F에서 업데이트):
   - `/approve`, `/reject`, `/investigate`

- [x] Slack App 생성 완료
- [x] Bot Token (`xoxb-...`) 메모 완료
- [x] Signing Secret 메모 완료

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

- [x] `aigo/github-app` 시크릿 생성 완료
- [x] `aigo/slack` 시크릿 생성 완료

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

- [x] `terraform.tfvars` 작성 완료
- [x] `terraform apply` 성공
- [x] 모든 output 값 메모 완료 (api_endpoint, cloudfront_domain, cognito_* 확인)

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

- [x] 8개 GitHub Secrets 모두 설정 완료

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

- [x] 7개 Agent 배포 완료 (Terraform bedrock_agentcore 모듈로 자동 배포, 상태: PREPARED)

### G-2. CD 파이프라인 실행

GitHub 리포지토리 → **Actions** → **CD: Deploy** → **Run workflow**

- [x] deploy-infra: global/iam + envs/prod Terraform apply 성공
- [x] deploy-api: Lambda 6개 배포 완료
  - aigo-github-connector, aigo-slack-connector, aigo-aws-event-connector
  - aigo-dashboard-cmd-connector, aigo-lightweight-worker, aigo-dashboard-api
- [x] deploy-heavy-worker: ECR 이미지 빌드 + ECS Task Definition 등록 완료
- [x] deploy-dashboard: S3 sync + CloudFront 무효화 완료

> **현재 상태 (2026-06-11):** CD 전체 파이프라인 PASSING.  
> Dashboard는 CloudFront 기본 도메인으로 접근 가능. 커스텀 도메인 연결은 아래 Phase G-3 참조.

### G-3. 커스텀 도메인 연결 (선택 사항)

현재 배포 상태: CloudFront 기본 도메인(`xxxx.cloudfront.net`)으로만 접근 가능.  
커스텀 도메인(`app.your-domain.com`)을 연결하려면 아래 3단계가 필요하다.

> **Terraform 범위 밖 작업:** Route53 및 ACM은 현재 Terraform으로 관리되지 않는다.  
> 아래는 AWS 콘솔 또는 CLI로 직접 수행한다.

#### G-3-1. ACM 인증서 발급 (us-east-1 필수)

CloudFront는 **반드시 us-east-1** 리전의 ACM 인증서를 요구한다.

```bash
# us-east-1에서 인증서 요청
aws acm request-certificate \
  --domain-name "app.your-domain.com" \
  --validation-method DNS \
  --region us-east-1

# 출력된 CertificateArn 메모
# → arn:aws:acm:us-east-1:ACCOUNT:certificate/UUID
```

DNS 검증: ACM 콘솔에서 CNAME 레코드 확인 → Route53에 추가 → 인증서 상태 `ISSUED` 대기.

#### G-3-2. Route53 호스팅 영역 생성

도메인 등록처가 Route53이 아닌 경우 호스팅 영역만 생성하고 NS 레코드를 외부 등록처에 위임.

```bash
# 호스팅 영역 생성
aws route53 create-hosted-zone \
  --name "your-domain.com" \
  --caller-reference "$(date +%s)"

# 출력된 NameServers 4개를 도메인 등록처의 NS 레코드에 설정
```

**AWS 콘솔 경로:** Route53 → Hosted zones → Create hosted zone → Domain name 입력 → Public hosted zone

#### G-3-3. CloudFront Alias A 레코드 추가

```bash
CF_DIST_ID="EXXXXXXXXXXXX"   # Phase D output
CF_DOMAIN=$(aws cloudfront get-distribution \
  --id $CF_DIST_ID \
  --query 'Distribution.DomainName' --output text)

# Route53 A 레코드 (Alias) 추가
HOSTED_ZONE_ID="Z0XXXXXXXXXXXXXXXXX"  # 위에서 생성한 호스팅 영역 ID

aws route53 change-resource-record-sets \
  --hosted-zone-id $HOSTED_ZONE_ID \
  --change-batch "{
    \"Changes\": [{
      \"Action\": \"CREATE\",
      \"ResourceRecordSet\": {
        \"Name\": \"app.your-domain.com\",
        \"Type\": \"A\",
        \"AliasTarget\": {
          \"HostedZoneId\": \"Z2FDTNDATAQYW2\",
          \"DNSName\": \"$CF_DOMAIN\",
          \"EvaluateTargetHealth\": false
        }
      }
    }]
  }"
```

> `Z2FDTNDATAQYW2` 는 CloudFront의 고정 호스팅 영역 ID (모든 리전 동일).

#### G-3-4. Terraform CloudFront 설정에 도메인 반영

`infra/terraform/envs/prod/terraform.tfvars`에 추가 후 CD 실행:

```hcl
domain_name         = "your-domain.com"
acm_certificate_arn = "arn:aws:acm:us-east-1:ACCOUNT:certificate/UUID"
```

이렇게 하면 CloudFront `aliases = ["app.your-domain.com"]` 가 설정됨.

- [ ] ACM 인증서 발급 완료 (us-east-1)
- [ ] Route53 호스팅 영역 생성 완료
- [ ] DNS 검증 완료 (인증서 ISSUED)
- [ ] A 레코드 추가 완료
- [ ] terraform.tfvars에 domain_name + acm_certificate_arn 반영 + CD 실행

---

## Phase H — 초기 데이터 설정

> **전제:** Phase G CD 파이프라인 전체 PASSING 이후 진행.  
> 아래 명령은 로컬 터미널에서 `aws configure`로 설정된 관리자 계정으로 실행.

### H-1. Cognito 첫 번째 OWNER 사용자 생성

Cognito User Pool은 Terraform으로 생성됐지만 초기 관리자 계정은 코드로 관리하지 않으므로  
CLI로 직접 생성한다.

```bash
# Cognito User Pool ID 확인 (Terraform output 또는 콘솔)
USER_POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 \
  --region ap-northeast-2 \
  --query "UserPools[?Name=='aigo'].Id" --output text)

echo "User Pool ID: $USER_POOL_ID"
# → ap-northeast-2_AKb8Xkx3b  (실제 배포된 값)
```

```bash
ADMIN_EMAIL="admin@your-domain.com"   # ← 실제 이메일로 교체
ADMIN_PASSWORD="YourStrongPass123!"   # ← 12자+, 대소문자+숫자+특수문자

# 사용자 생성 (이메일 발송 없음)
aws cognito-idp admin-create-user \
  --region ap-northeast-2 \
  --user-pool-id "$USER_POOL_ID" \
  --username "$ADMIN_EMAIL" \
  --temporary-password "TempPass123!" \
  --user-attributes \
    Name=email,Value="$ADMIN_EMAIL" \
    Name=email_verified,Value=true \
    Name=custom:orgId,Value="org-001" \
    Name=custom:role,Value="OWNER" \
  --message-action SUPPRESS

# FORCE_CHANGE_PASSWORD → CONFIRMED 상태로 전환
aws cognito-idp admin-set-user-password \
  --region ap-northeast-2 \
  --user-pool-id "$USER_POOL_ID" \
  --username "$ADMIN_EMAIL" \
  --password "$ADMIN_PASSWORD" \
  --permanent

# Cognito 그룹(OWNER)에 추가
aws cognito-idp admin-add-user-to-group \
  --region ap-northeast-2 \
  --user-pool-id "$USER_POOL_ID" \
  --username "$ADMIN_EMAIL" \
  --group-name OWNER

echo "✅ OWNER 사용자 생성 완료: $ADMIN_EMAIL"
```

**확인:**
```bash
aws cognito-idp admin-get-user \
  --region ap-northeast-2 \
  --user-pool-id "$USER_POOL_ID" \
  --username "$ADMIN_EMAIL" \
  --query "UserStatus"
# → "CONFIRMED" 이어야 함
```

- [x] 첫 OWNER 사용자 생성 완료 (UserStatus: CONFIRMED) — hyjoon333@gmail.com
- [x] OWNER 그룹 추가 완료

---

### H-2. Organizations DynamoDB 레코드 생성

Dashboard API가 `aigo-Organizations` 테이블에서 조직 정보를 읽는다.  
초기 레코드가 없으면 대시보드 로그인 후 데이터 조회가 실패한다.

```bash
ORG_ID="org-001"
ORG_NAME="Your Organization"   # ← 실제 조직명으로 교체

aws dynamodb put-item \
  --region ap-northeast-2 \
  --table-name aigo-Organizations \
  --item "{
    \"PK\": {\"S\": \"ORG#${ORG_ID}\"},
    \"SK\": {\"S\": \"METADATA\"},
    \"orgId\": {\"S\": \"${ORG_ID}\"},
    \"name\": {\"S\": \"${ORG_NAME}\"},
    \"autoAnalyzeOnPR\": {\"BOOL\": true},
    \"approvalRequired\": {\"BOOL\": true},
    \"riskThreshold\": {\"S\": \"HIGH\"},
    \"timezone\": {\"S\": \"Asia/Seoul\"},
    \"createdAt\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"},
    \"updatedAt\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
  }"

echo "✅ Organizations 레코드 생성 완료"
```

**확인:**
```bash
aws dynamodb get-item \
  --region ap-northeast-2 \
  --table-name aigo-Organizations \
  --key '{"PK":{"S":"ORG#org-001"},"SK":{"S":"METADATA"}}' \
  --query "Item.name.S"
# → "Your Organization"
```

- [x] Organizations 초기 레코드 생성 완료 (org-001, AIGOadmin)

---

### H-3. Knowledge Base 문서 업로드

Bedrock KB(`BTLXQGMG9F`)가 검색할 문서를 S3 `aigo-kb` 버킷에 업로드한다.  
문서가 없으면 Agent가 KB 검색 시 빈 결과를 반환한다.

#### H-3-1. KB 문서 디렉토리 구조 생성

```bash
mkdir -p docs/kb/coding-standards
mkdir -p docs/kb/infrastructure-standards
mkdir -p docs/kb/security-policies
mkdir -p docs/kb/risk-policies
```

각 디렉토리에 `.md` 또는 `.txt` 문서 파일을 작성한다.  
최소한 각 카테고리에 1개 이상의 문서가 있어야 KB 동기화가 의미 있다.

**문서 예시 (`docs/kb/coding-standards/typescript.md`):**
```markdown
# TypeScript Coding Standards

## Naming Conventions
- Variables and functions: camelCase
- Classes and interfaces: PascalCase
...
```

**메타데이터 사이드카 파일** (각 문서와 같은 이름 + `.metadata.json`):
```json
{ "metadataAttributes": { "category": "coding_standards" } }
```

카테고리 값: `coding_standards` | `infrastructure_standards` | `security_policies` | `risk_policies`

#### H-3-2. S3 업로드

```bash
KB_BUCKET="aigo-kb"

# 각 카테고리 업로드
for CATEGORY in coding-standards infrastructure-standards security-policies risk-policies; do
  if [ -d "docs/kb/${CATEGORY}" ]; then
    aws s3 sync "docs/kb/${CATEGORY}/" "s3://${KB_BUCKET}/${CATEGORY}/" \
      --region ap-northeast-2
    echo "✅ ${CATEGORY} 업로드 완료"
  fi
done
```

#### H-3-3. Bedrock KB 동기화 트리거

```bash
KB_ID="BTLXQGMG9F"   # Terraform 배포된 실제 KB ID

# Data Source ID 목록 조회
DATA_SOURCE_IDS=$(aws bedrock-agent list-data-sources \
  --region ap-northeast-2 \
  --knowledge-base-id "$KB_ID" \
  --query "dataSourceSummaries[*].dataSourceId" \
  --output text)

# 각 Data Source 인제스션 시작
for DS_ID in $DATA_SOURCE_IDS; do
  JOB=$(aws bedrock-agent start-ingestion-job \
    --region ap-northeast-2 \
    --knowledge-base-id "$KB_ID" \
    --data-source-id "$DS_ID" \
    --query "ingestionJob.ingestionJobId" \
    --output text)
  echo "인제스션 시작: $DS_ID → Job ID: $JOB"
done

echo "⏱️  인제스션 완료까지 수 분 소요. 아래 명령으로 상태 확인:"
echo "aws bedrock-agent list-ingestion-jobs --region ap-northeast-2 --knowledge-base-id $KB_ID"
```

**인제스션 상태 확인:**
```bash
aws bedrock-agent list-ingestion-jobs \
  --region ap-northeast-2 \
  --knowledge-base-id "$KB_ID" \
  --query "ingestionJobSummaries[*].[status,statistics.numberOfDocumentsScanned]" \
  --output table
# COMPLETE 상태 확인
```

- [x] KB 문서 작성 완료 (4개 카테고리 × 최소 2개 문서)
- [x] S3 `aigo-kb` 업로드 완료
- [x] Bedrock 인제스션 Job 실행 완료 (상태: COMPLETE, 4개 DS 모두 완료)

---

## Phase J — Orchestrator Lambda 배포

> **신규 (2026-06-12):** Lightweight Worker가 Bedrock AgentCore 직접 호출 대신
> Orchestrator Python Lambda를 비동기 호출하도록 아키텍처 변경.
> Strands SDK가 Lambda 내에서 실행되어 모든 도구 (ddb_tools, github_tools, slack_tools)를 정상 사용 가능.

### J-1. Global IAM 업데이트

Orchestrator Lambda 역할 신규 추가 + Worker 역할에 `lambda:InvokeFunction` 추가.

```bash
cd infra/terraform/global/iam
terraform init
terraform plan
terraform apply
```

완료 후 출력 확인:
```
lambda_orchestrator_role_arn = "arn:aws:iam::XXXX:role/aigo-lambda-orchestrator-role"
```

- [x] `global/iam` Terraform apply 완료 (aigo-lambda-orchestrator-role 생성, worker 역할에 InvokeFunction 추가)

### J-2. Orchestrator 패키지 빌드 및 S3 업로드

```bash
# 빌드 + S3 업로드 (Lambda 코드 업데이트까지 자동)
./scripts/deploy-orchestrator.sh

# 또는 빌드만 (업로드 없이 검증)
./scripts/deploy-orchestrator.sh --skip-upload
```

- [x] orchestrator ZIP 빌드 완료 (27MB, strands-agents + boto3 + 모든 도구 포함)
- [x] `s3://aigo-artifacts/lambda/orchestrator/latest.zip` 업로드 완료 (v4 배포)

### J-3. Prod Terraform 업데이트

`lambda_orchestrator` 모듈 신규 + `lambda_lightweight_worker` timeout 변경.

```bash
cd infra/terraform/envs/prod
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

**변경 내용:**
- `aigo-orchestrator` Lambda 생성 (python3.12, 3008MB, 900s)
- `aigo-lightweight-worker` timeout: 900s → 120s
- Monitoring 대상 Lambda에 `aigo-orchestrator` 추가

- [x] `envs/prod` Terraform apply 완료 (lambda_orchestrator 모듈 생성)
- [x] `aigo-orchestrator` Lambda 생성 확인 (python3.12, 3008MB, 900s)

### J-4. Lightweight Worker 재배포

`@aws-sdk/client-lambda` 의존성으로 교체, Lambda invoke 방식으로 코드 변경.

```bash
# 빌드
cd workers/lightweight
pnpm install   # @aws-sdk/client-lambda 설치
pnpm build     # TypeScript 컴파일 + esbuild 번들

# 배포 (기존 스크립트 사용)
./scripts/deploy-lambda.sh worker-lightweight aigo-lightweight-worker
```

- [x] Lightweight Worker 빌드 성공 (TypeScript 0 errors, esbuild 257.7kb)
- [x] `aigo-lightweight-worker` Lambda 재배포 완료 (v16, lambda-client.ts 방식)

### J-5. E2E 검증

```bash
# 테스트 PR 생성 후 흐름 확인
# 1. GitHub PR → Webhook → github-connector Lambda
# 2. github-connector → SQS analysis-queue
# 3. SQS → lightweight-worker Lambda
# 4. lightweight-worker → orchestrator Lambda (async)
# 5. orchestrator → 4개 서브에이전트 → DynamoDB → GitHub comment → Slack

# DynamoDB에서 job 완료 확인
aws dynamodb get-item \
  --table-name aigo-AnalysisJobs \
  --key '{"PK":{"S":"JOB#<JOB_ID>"},"SK":{"S":"METADATA"}}' \
  --query "Item.[status.S,reportId.S]" \
  --region ap-northeast-2

# Reports 테이블 확인
aws dynamodb scan \
  --table-name aigo-Reports \
  --limit 1 \
  --region ap-northeast-2 | jq '.Items[0]'
```

- [x] 테스트 PR #31 (hj-3/gympt-app) 사용
- [x] AnalysisJob `MQA9USA9CRF9BNS` status = COMPLETED 확인
- [x] Reports 테이블 `MQA9USA9CRF9BNS-report` 생성 확인 (LOW/APPROVE/PENDING)
- [x] GitHub PR에 분석 코멘트 게시 확인 (https://github.com/hj-3/gympt-app/pull/31#issuecomment-4688165060)
- [ ] Slack 알림 수신 확인 → SLACK_CHANNEL_ID 미설정으로 channel_not_found 오류 (J-5 참조)

> **SLACK_CHANNEL_ID 설정 (필수):** Slack 알림이 `channel_not_found` 오류를 반환하면
> Slack 채널 ID를 Lambda 환경변수에 설정한다.
> Slack 채널 우클릭 → "채널 세부정보 보기" → 하단 채널 ID 복사 (`C0XXXXXXXXX` 형식).
>
> ```bash
> # Terraform으로 관리 — infra/terraform/envs/prod/main.tf의 lambda_common_env에 추가:
> SLACK_CHANNEL_ID = "C0XXXXXXXXX"
>
> # 또는 즉시 반영:
> aws lambda update-function-configuration \
>   --function-name aigo-orchestrator \
>   --environment "Variables={SLACK_CHANNEL_ID=C0XXXXXXXXX}" \
>   --region ap-northeast-2
> ```

---

## Phase K — CI/CD 통합, 대시보드 수정, 인프라 검증

> **신규 (2026-06-12):** CI/CD에 Orchestrator Lambda 배포 추가, 대시보드 DynamoDB GSI 불일치 수정,
> VPC Endpoint / NAT Gateway 검증 완료.

### K-1. CI/CD — Orchestrator Lambda 배포 추가

`cd-deploy.yml`에 다음 변경:
- `detect-changes` outputs에 `orchestrator` 추가
- `agents/orchestrator/**`, `tools/**`, `libs/common/**`, `scripts/deploy-orchestrator.sh` 변경 감지
- `deploy-orchestrator-lambda` job 신규 추가 (Python 3.12, `uv`, `scripts/deploy-orchestrator.sh` 실행)
- `workflow_dispatch` 컴포넌트 목록에 `orchestrator` 추가

- [x] `cd-deploy.yml` 업데이트 완료 (orchestrator 감지 + 배포 job 추가)

### K-2. 대시보드 DynamoDB GSI 불일치 수정

**원인:** `save_report`(ddb_tools.py)가 `GSI1PK`/`GSI2PK`만 기록했으나
dashboard-api는 `GSI3-orgApprovalStatus-createdAt-index` (`GSI3PK = "ORG#{orgId}"`)를 조회.
추가로 `save_report`가 AnalysisJobs의 status를 COMPLETED로 업데이트할 때
`GSI2PK = "ORG#{orgId}#COMPLETED"`도 함께 업데이트하지 않아 dashboard 잡 조회 불일치.

**수정 내용 (`tools/ddb_tools.py` → `save_report`):**
1. Reports 항목에 `GSI3PK = "ORG#{org_id}"`, `GSI3SK = "PENDING#{now}"` 추가
2. GSI1 의미 수정: `GSI1PK = "JOB#{job_id}"` (기존: `"ORG#{org_id}"`)
3. AnalysisJobs 업데이트 시 `GSI2PK = "ORG#{org_id}#COMPLETED"` 함께 반영

**기존 데이터 백필:**
```bash
# Reports 기존 항목 GSI3 백필
aws dynamodb update-item \
  --table-name aigo-Reports \
  --key '{"PK":{"S":"REPORT#MQA9USA9CRF9BNS-report"},"SK":{"S":"METADATA"}}' \
  --update-expression "SET GSI3PK=:pk, GSI3SK=:sk, GSI1PK=:jpk, GSI1SK=:jsk" \
  --expression-attribute-values '{":pk":{"S":"ORG#org-001"},":sk":{"S":"PENDING#2026-06-12T06:45:33.903023+00:00"},":jpk":{"S":"JOB#MQA9USA9CRF9BNS"},":jsk":{"S":"2026-06-12T06:45:33.903023+00:00"}}' \
  --region ap-northeast-2

# AnalysisJobs 기존 항목 GSI2PK 백필
aws dynamodb update-item \
  --table-name aigo-AnalysisJobs \
  --key '{"PK":{"S":"JOB#MQA9USA9CRF9BNS"},"SK":{"S":"METADATA"}}' \
  --update-expression "SET GSI2PK=:pk" \
  --expression-attribute-values '{":pk":{"S":"ORG#org-001#COMPLETED"}}' \
  --region ap-northeast-2
```

- [x] `ddb_tools.py` `save_report` 수정 완료 (GSI3PK 추가, GSI2PK 동기화)
- [x] 기존 DynamoDB 항목 백필 완료 (MQA9USA9CRF9BNS-report, MQA9USA9CRF9BNS)
- [x] Orchestrator Lambda 재배포 완료 (수정된 ddb_tools.py 포함)

### K-3. VPC Endpoint / NAT Gateway 검증

**검증 결과 (2026-06-12):**

| 항목 | 결과 |
|------|------|
| NAT Gateway | `enable_nat_gateway = true` — 3 AZ 모두 활성 (GitHub/Slack API 외부 호출 가능) |
| Gateway Endpoints (S3, DynamoDB) | 4개 라우팅 테이블(isolated + private-2a/2b/2c) 모두 연결 ✅ |
| Interface Endpoints (11개) | 3개 private 서브넷(10.0.10-12.0/24) 연결, 상태 available ✅ |
| Interface Endpoints 서브넷 | private tier (Lambda 실행 위치와 일치) ✅ |

**Interface Endpoints 목록 (모두 private 서브넷 연결):**
- events, bedrock-runtime, ecr.dkr, ecr.api, sqs, logs, secretsmanager, kms, sts, ssm, xray

**결론:**
- 불필요한 VPC Endpoint 없음 — 모두 Lambda/ECS 워크로드가 사용하는 서비스
- NAT Gateway는 GitHub API, Slack API 등 인터넷 외부 호출에 필요 → 유지 필요
- isolated 서브넷에는 Interface Endpoint 없음 (AgentCore MCP 서버 용도, 현재 미사용)

- [x] VPC Endpoint 라우팅 테이블 연결 검증 완료
- [x] NAT Gateway 필요성 확인 (GitHub/Slack 외부 호출 경로)
- [x] 불필요한 Endpoint 없음 확인

---

## Phase I — 배포 검증

> **현재 상태 (2026-06-11):** I-1, I-4 PASSING. I-3 수동 확인 필요. I-2는 Phase F (Webhook URL 업데이트) 완료 후 가능.

### I-1. 헬스체크

```bash
API_URL="https://jxvucbg4c0.execute-api.ap-northeast-2.amazonaws.com/prod"

# API Gateway 헬스체크
curl -s "$API_URL/health" | jq .
# → {"status":"ok"}

# Dashboard 접근
echo "Dashboard URL: https://d14fywc3dbqqf3.cloudfront.net"
```

> **수정 이력:** `/health` 라우트가 JWT 보호 대상이었음 → `AuthorizationType: NONE` 으로 수정 (`modules/api-gateway/main.tf`).  
> `/health` 핸들러 누락 → `apps/dashboard-api/src/index.ts`에 `app.get('/health', ...)` 추가.

- [x] API Gateway `/health` → `{"status":"ok"}` (200)
- [x] CloudFront Dashboard → HTTP 200

### I-2. GitHub Webhook 테스트

> **전제:** Phase F (GitHub App Webhook URL 업데이트) 완료 필요.

테스트 리포지토리에 PR을 생성하고 다음을 확인:
- [ ] GitHub App이 Webhook을 수신 (GitHub App → Advanced → Recent Deliveries 확인)
- [ ] github-connector Lambda 실행 로그 확인 (CloudWatch)
- [ ] DynamoDB `aigo-AnalysisJobs` 테이블에 레코드 생성 확인
- [ ] SQS `analysis-queue` 메시지 발행 확인

### I-3. 대시보드 로그인 테스트

```
Dashboard URL: https://d14fywc3dbqqf3.cloudfront.net
Login: hyjoon333@gmail.com (OWNER, org-001)
```

- [ ] `https://d14fywc3dbqqf3.cloudfront.net` 접근 → Cognito Hosted UI 리다이렉트 확인
- [ ] hyjoon333@gmail.com 계정으로 로그인 성공
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

- [x] 모든 알람 `OK` 상태 확인 (15개 알람 전체 OK)

---

## 배포 완료 체크리스트

- [x] Phase A — Terraform 상태 저장소 생성
- [x] Phase B — Global IAM (GitHub OIDC) 배포
- [x] Phase C — GitHub App + Slack App 등록 + Secrets Manager 초기화
- [x] Phase D — 인프라 Terraform apply (CD auto-apply)
- [x] Phase E — GitHub Secrets 설정
- [x] Phase F — Webhook/Slash Command URL 업데이트
- [x] Phase G-1 — Bedrock Agent 7개 배포 (Terraform으로 자동 완료, 상태: PREPARED)
- [x] Phase G-2 — CD 파이프라인 (Lambda + ECS + Dashboard) PASSING
- [x] Phase J — Orchestrator Lambda 배포 완료 (E2E 검증: Job COMPLETED, PR 코멘트 게시)
- [x] Phase K-1 — CI/CD Orchestrator Lambda 배포 추가 (cd-deploy.yml orchestrator job)
- [x] Phase K-2 — 대시보드 DynamoDB GSI 불일치 수정 (GSI3PK 추가, GSI2PK 동기화)
- [x] Phase K-3 — VPC Endpoint / NAT Gateway 검증 완료 (11 Interface + 2 Gateway, all OK)
- [x] Phase L-1 — 멀티 페르소나 Strands Agent 전환 (단일 Agent, 4 페르소나, KB 직접 검색, Risk Score 0-100)
- [x] Phase L-2 — subagent_tools 정리 (invoke_devops_agent만 유지, code/infra/risk/security 제거)
- [x] Phase L-3 — ddb_tools.save_report risk_score 파라미터 추가, kb_tools graceful degradation
- [x] Phase L-4 — 전체 문서 업데이트 (architecture, agents, data-model, phase-4, phase-5, prompts, gap-analysis)
- [x] Phase G-3 — 커스텀 도메인 연결 완료 (app.seolphung.com, ACM us-east-1)
- [x] Phase H — 초기 데이터 설정 (Cognito 사용자, Organization, KB 문서)
- [x] Phase I-1 — API /health + CloudFront 헬스체크 PASSING
- [ ] Phase I-2 — GitHub Webhook 테스트 (실제 PR로 확인 필요)
- [x] Phase I-3 — Dashboard 로그인 테스트 완료
- [x] Phase I-4 — CloudWatch 알람 15개 전체 OK
- [ ] Phase M-1 — SES 모듈 배포 + 도메인 인증 완료 (seolphung.com DKIM/SPF)
- [ ] Phase M-2 — SES 샌드박스 해제 (AWS 콘솔 → Request production access)
- [ ] Phase M-3 — GitHub App 생성 (Webhook URL: /webhooks/github/app)
- [ ] Phase M-4 — Slack App 생성 (OAuth Redirect: /auth/slack/callback)
- [ ] Phase M-5 — IAM 업데이트 apply (SSM/Cognito 권한)
- [ ] Phase M-6 — DynamoDB 업데이트 apply (GSI2 × 2, OrgInvitations 테이블)
- [ ] Phase M-7 — Bedrock Agent 4개 제거 (code-reviewer, infra-reviewer, risk-reviewer, security-agent)
- [ ] Phase M-8 — Cognito 업데이트 apply (self-signup, SES, post-confirmation Lambda)
- [ ] Phase M-9 — 신규 Lambda 3개 배포 (github-app-setup, slack-oauth, post-confirmation)
- [ ] Phase M-10 — 수정된 Lambda 재배포 (github-connector, lightweight-worker)
- [ ] Phase M-11 — 프론트엔드 빌드 배포 (RegisterPage, OnboardingPage, TeamPage)
- [ ] Phase M-12 — E2E 검증: 회원가입 → 온보딩 → PR 분석
- [ ] Phase N-1 — DynamoDB + IAM + Guardrail apply (AgentMemory table, BedrockInvokeAgent, SSM Slack read)
- [ ] Phase N-2 — Orchestrator Lambda 재배포 (Guardrail ID 환경변수 포함)
- [ ] Phase N-3 — Heavy Worker ECS 재빌드 (Fix Agent Bedrock AgentCore 통합)
- [ ] Phase N-4 — Dashboard API Lambda 재배포 (approval + audit)
- [ ] Phase N-5 — Slack OAuth Connector 재배포 (channelId SSM 저장)
- [ ] Phase N-6 — 프론트엔드 재빌드 (riskScore 표시)
- [ ] Phase N-7 — E2E 검증: Check Run → AgentMemory → Approval → AuditLog → per-org Slack

---

## Phase M — 멀티테넌시 SaaS 전환

> **목적:** 외부 사용자가 자체 회원가입 → GitHub App 설치 → Slack 연동 → 리포지토리 등록을 하여 독립적으로 서비스를 사용할 수 있도록 전환.  
> **전제:** Phase A–K 완료 상태에서 진행.

---

### M-1. GitHub App 권한 및 이벤트 업데이트

기존 GitHub App(Phase C에서 생성)에 Check Run 쓰기 권한과 Installation 이벤트 수신을 추가한다.

1. GitHub → **Settings** → **Developer settings** → **GitHub Apps** → `AIGoAgent-Bot` → **Edit**
2. **Permissions** 업데이트:

   | 권한 | 변경 |
   |------|------|
   | Checks | Read & Write (신규 추가) |
   | Pull requests | Read & Write (기존 유지) |
   | Contents | Read & Write (기존 유지) |
   | Issues | Read & Write (기존 유지) |

3. **Subscribe to events** 추가:
   - `Installation` (신규) — 사용자가 App을 GitHub Org에 설치/제거할 때 수신
   - `Pull request` (기존 유지)

4. **GitHub App slug** 확인 (설치 URL에 사용):
   - GitHub App 편집 화면 URL: `https://github.com/settings/apps/AIGoAgent-Bot`
   - slug = `aigoagent-bot` (앱 이름 소문자-하이픈 변환)

- [ ] M-1 완료: Checks 권한 추가, Installation 이벤트 구독

---

### M-2. Slack OAuth App 생성

Slack 알림용 Bot Token과 별도로, per-org OAuth 인증을 위한 Slack App을 생성한다.  
(기존 Phase C의 Slack App을 업데이트하거나 새로 생성 — 권장은 동일 App에 OAuth 추가)

1. [api.slack.com/apps](https://api.slack.com/apps) → App 선택(또는 신규 생성) → **OAuth & Permissions**
2. **Redirect URLs** 추가:
   ```
   https://api.seolphung.com/auth/slack/callback
   ```
3. **Bot Token Scopes** 추가:
   ```
   chat:write
   chat:write.public
   channels:read
   incoming-webhook
   ```
4. App의 **Basic Information** 페이지에서 메모:
   - `App ID`
   - `Client ID`
   - `Client Secret`
   - `Signing Secret`

- [ ] M-2 완료: Slack OAuth App 설정, Client ID/Secret 메모

---

### M-3. SES 도메인 인증 준비

SES가 `noreply@seolphung.com` 주소로 이메일을 발송하려면 먼저 SES 모듈을 배포해야 한다.  
Route 53에 호스팅 영역이 이미 있어야 한다(Phase G-3 완료 전제).

```bash
# Route 53 Zone ID 확인
aws route53 list-hosted-zones-by-name \
  --dns-name seolphung.com \
  --query "HostedZones[0].Id" \
  --output text
# → /hostedzone/XXXXXXXXXXXX
# Zone ID = XXXXXXXXXXXX (슬래시 제거)
```

- [ ] M-3 완료: Route 53 Zone ID 확인

---

### M-4. terraform.tfvars 업데이트

`infra/terraform/envs/prod/terraform.tfvars`에 Phase M에서 추가된 변수들을 넣는다:

```hcl
# 기존 변수들 유지 ...

# GitHub App (Phase M 신규)
github_app_id   = "1234567"           # ← GitHub App ID (숫자)
github_app_slug = "aigoagent-bot"     # ← App slug (설치 URL용)

# Slack OAuth (Phase M 신규)
slack_client_id     = "XXXX.YYYY"     # ← Slack App Client ID
slack_client_secret = "abc123..."     # ← Slack App Client Secret

# SES 도메인 (Phase M 신규)
domain_name       = "seolphung.com"
route53_zone_id   = "XXXXXXXXXXXX"    # ← Route 53 Zone ID
```

- [ ] M-4 완료: terraform.tfvars 업데이트

---

### M-5. Secrets Manager — Slack OAuth 시크릿 생성

```bash
# Slack OAuth credentials (slack_client_secret은 tfvars로 전달하지만
# 런타임 조회용 시크릿도 별도 생성)
aws secretsmanager create-secret \
  --name "aigo/slack-oauth" \
  --description "Slack OAuth App credentials for per-org token exchange" \
  --secret-string '{
    "clientId": "XXXX.YYYY",
    "clientSecret": "abc123...",
    "signingSecret": "xyz..."
  }' \
  --region ap-northeast-2
```

> **기존 `aigo/slack` 시크릿** (Phase C 생성)은 그대로 유지한다. 이것은 글로벌 알림용 fallback bot token.

- [ ] M-5 완료: aigo/slack-oauth 시크릿 생성

---

### M-6. Global IAM Terraform apply

Phase M에서 추가된 IAM 정책:
- Lambda Connector: `ssm:PutParameter`, `ssm:DeleteParameter` on `/aigo/integrations/slack/*`
- Lambda API: `ssm:GetParameter` on `/aigo/integrations/slack/*`
- Lambda Orchestrator: `ssm:GetParameter` on `/aigo/integrations/slack/*`
- Lambda Connector/API: `cognito-idp:AdminUpdateUserAttributes`, `AdminAddUserToGroup`, `AdminGetUser`
- ECS Task: `bedrock:InvokeAgent` (Fix Agent 호출용)

```bash
cd infra/terraform/global/iam

terraform plan -var-file=terraform.tfvars
# 변경 사항 확인: SSMSlackTokens, CognitoAdminOps, BedrockInvokeAgent 정책 추가

terraform apply -var-file=terraform.tfvars
```

- [ ] M-6 완료: Global IAM apply (SSM, Cognito, Bedrock 권한 추가)

---

### M-7. Prod Terraform apply — 1단계 (DynamoDB + Bedrock 제거)

> **주의:** 이 단계는 순서가 중요하다. DynamoDB 먼저, 이후 Cognito/SES.

```bash
cd infra/terraform/envs/prod

# 1단계: DynamoDB 스키마 업데이트 (GSI 추가, 새 테이블)
terraform apply \
  -target=module.dynamodb \
  -var-file=terraform.tfvars

# 확인: 새 테이블 및 인덱스
aws dynamodb list-tables --region ap-northeast-2 | grep aigo | sort
# 출력에 다음이 있어야 함:
# aigo-OrgInvitations, aigo-AgentMemory (신규)
# 기존 테이블들 유지

# 2단계: Bedrock AgentCore (에이전트 4개 제거, 3개만 유지)
terraform apply \
  -target=module.bedrock_agentcore \
  -var-file=terraform.tfvars
```

- [ ] M-7a 완료: DynamoDB GSI2 추가 + OrgInvitations + AgentMemory 테이블 생성
- [ ] M-7b 완료: Bedrock AgentCore 에이전트 3개로 축소

---

### M-8. Prod Terraform apply — 2단계 (SES + Cognito)

> SES 먼저 배포 후 Cognito를 배포해야 SES role ARN 참조가 가능하다.

```bash
cd infra/terraform/envs/prod

# SES 모듈 (도메인 인증 리소스 생성)
terraform apply \
  -target=module.ses \
  -var-file=terraform.tfvars

# SES 도메인 인증 상태 확인 (최대 72시간 소요)
aws ses get-identity-verification-attributes \
  --identities "seolphung.com" \
  --region ap-northeast-2 \
  --query "VerificationAttributes.\"seolphung.com\".VerificationStatus"
# 처음엔 "Pending", DKIM 전파 후 "Success" 가 됨
# → Terraform이 Route53 레코드를 자동 생성했으므로 보통 수분~수시간 내 Success

# Cognito (SES 연동, self-signup 활성화, post-confirmation Lambda trigger)
terraform apply \
  -target=module.cognito \
  -var-file=terraform.tfvars
```

- [ ] M-8a 완료: SES 모듈 배포, Route53 DKIM/SPF/DMARC 레코드 생성
- [ ] M-8b 완료: SES 도메인 인증 Success 확인
- [ ] M-8c 완료: Cognito self-signup 활성화, SES 이메일 발송 설정

---

### M-9. SES 샌드박스 해제 요청

SES는 기본 샌드박스 상태에서 하루 200건, 검증된 이메일에만 발송 가능.  
프로덕션 서비스를 위해 샌드박스 해제가 필요하다.

1. AWS 콘솔 → **SES** → **Account dashboard** → **Request production access**
2. 다음 내용으로 케이스 제출:
   - **Mail type:** Transactional
   - **Website URL:** https://app.seolphung.com
   - **Use case description:** AI DevOps 분석 플랫폼, 사용자 회원가입 이메일 인증 코드 발송. 사용자가 직접 회원가입 요청. 수신거부 링크 불필요.
   - **Daily sending volume:** 10,000 이하
3. 보통 24~48시간 내 승인됨.

> **승인 전 테스트:** SES에 검증된 이메일 주소를 추가해 테스트 가능:
> ```bash
> aws ses verify-email-identity \
>   --email-address ganddoree@gmail.com \
>   --region ap-northeast-2
> ```

- [ ] M-9 완료: SES 샌드박스 해제 요청 제출 (또는 승인 완료)

---

### M-10. Prod Terraform apply — 3단계 (나머지 전체)

```bash
cd infra/terraform/envs/prod

# 전체 apply (남은 변경사항: Lambda 신규 생성, API Gateway 라우트, ECS env, Guardrail)
terraform apply -var-file=terraform.tfvars

# 완료 후 신규 Lambda ARN 확인
aws lambda list-functions \
  --query "Functions[?starts_with(FunctionName,'aigo-')].FunctionName" \
  --output text \
  --region ap-northeast-2
# 다음이 있어야 함:
# aigo-github-app-setup, aigo-slack-oauth, aigo-post-confirmation

# Bedrock Guardrail 확인
aws bedrock list-guardrails \
  --region ap-northeast-2 \
  --query "guardrails[?name=='aigo-orchestrator-guardrail']"
```

- [ ] M-10 완료: 전체 Terraform apply (Lambda 3개 신규 + API Gateway + ECS env + Guardrail)

---

### M-11. Lambda 코드 배포 — 신규 3개

신규 Lambda는 Terraform apply로 함수 정의는 됐지만 코드가 없어 실행 불가.  
각 함수에 코드를 배포한다.

```bash
# 1. github-app-setup Lambda
cd connectors/github-app-setup
npm install && npm run build

zip -r /tmp/github-app-setup.zip dist/ node_modules/

aws lambda update-function-code \
  --function-name aigo-github-app-setup \
  --zip-file fileb:///tmp/github-app-setup.zip \
  --region ap-northeast-2

# 2. slack-oauth Lambda
cd connectors/slack-oauth
npm install && npm run build

zip -r /tmp/slack-oauth.zip dist/ node_modules/

aws lambda update-function-code \
  --function-name aigo-slack-oauth \
  --zip-file fileb:///tmp/slack-oauth.zip \
  --region ap-northeast-2

# 3. post-confirmation Lambda
cd connectors/post-confirmation
npm install && npm run build

zip -r /tmp/post-confirmation.zip dist/ node_modules/

aws lambda update-function-code \
  --function-name aigo-post-confirmation \
  --zip-file fileb:///tmp/post-confirmation.zip \
  --region ap-northeast-2
```

- [ ] M-11a 완료: aigo-github-app-setup 코드 배포
- [ ] M-11b 완료: aigo-slack-oauth 코드 배포
- [ ] M-11c 완료: aigo-post-confirmation 코드 배포

---

### M-12. Lambda 코드 재배포 — 수정된 기존 Lambda

Phase M에서 변경된 Lambda들을 재배포한다.

```bash
# github-connector (multi-tenant GSI2 조회, installationId 라우팅)
./scripts/deploy-lambda.sh connector-github

# lightweight-worker (installationId per-org 지원)
./scripts/deploy-lambda.sh worker-lightweight

# orchestrator (Check Run, Memory, Incident routing, Guardrail, per-org Slack)
./scripts/deploy-orchestrator.sh

# dashboard-api (onboarding, team, integrations, approval, audit)
./scripts/deploy-lambda.sh dashboard-api

# 배포 후 환경변수 자동 설정 확인 (Terraform이 관리)
aws lambda get-function-configuration \
  --function-name aigo-orchestrator \
  --query "Environment.Variables.[BEDROCK_GUARDRAIL_ID,SSM_SLACK_TOKEN_PATH,INCIDENT_AGENT_ID]" \
  --region ap-northeast-2
```

- [ ] M-12a 완료: github-connector 재배포
- [ ] M-12b 완료: lightweight-worker 재배포
- [ ] M-12c 완료: orchestrator 재배포 (Guardrail ID 환경변수 포함)
- [ ] M-12d 완료: dashboard-api 재배포

---

### M-13. Heavy Worker ECS 재빌드 배포

Fix Agent Bedrock AgentCore 호출 로직이 추가된 heavy worker를 재빌드한다.

```bash
# ECR 로그인
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws ecr get-login-password --region ap-northeast-2 | \
  docker login --username AWS --password-stdin \
  "${AWS_ACCOUNT_ID}.dkr.ecr.ap-northeast-2.amazonaws.com"

# 빌드 (workers/heavy/ 디렉토리)
cd workers/heavy
docker build -t aigo-worker-heavy .

# 태깅 & 푸시
docker tag aigo-worker-heavy:latest \
  "${AWS_ACCOUNT_ID}.dkr.ecr.ap-northeast-2.amazonaws.com/aigo-worker-heavy:latest"

docker push \
  "${AWS_ACCOUNT_ID}.dkr.ecr.ap-northeast-2.amazonaws.com/aigo-worker-heavy:latest"

# ECS Task Definition 업데이트 (이미지 태그 변경 후 배포)
# → CD 파이프라인이 자동으로 처리하거나 수동으로:
aws ecs update-service \
  --cluster aigo-cluster \
  --service aigo-heavy-worker \
  --force-new-deployment \
  --region ap-northeast-2
```

- [ ] M-13 완료: Heavy Worker ECS 이미지 재빌드 + 배포

---

### M-14. GitHub App Webhook URL 업데이트

새 Installation 이벤트를 수신할 Webhook URL을 GitHub App에 추가 등록한다.

1. GitHub App 편집 화면 → **Webhook URL**
2. 기존 URL 확인: `https://api.seolphung.com/webhooks/github`
3. 단일 Webhook URL로 모든 이벤트 수신 (github-connector가 event type으로 분기):
   - PR events → 분석 큐
   - Installation events → github-app-setup Lambda (API Gateway → `/webhooks/github/app` 라우트)
4. API Gateway에 두 라우트 모두 등록됐는지 확인:
   ```bash
   aws apigatewayv2 get-routes \
     --api-id $(aws apigatewayv2 get-apis --query "Items[?Name=='aigo-api'].ApiId" --output text --region ap-northeast-2) \
     --region ap-northeast-2 \
     --query "Items[?contains(RouteKey,'webhooks')].RouteKey"
   # → ["POST /webhooks/github", "POST /webhooks/github/app"]
   ```

- [ ] M-14 완료: GitHub App Webhook 라우트 확인 (PR + Installation 모두 수신)

---

### M-15. Slack App OAuth Redirect 최종 확인

```bash
# API Gateway에 Slack OAuth Callback 라우트 확인
aws apigatewayv2 get-routes \
  --api-id API_GW_ID \
  --region ap-northeast-2 \
  --query "Items[?contains(RouteKey,'slack')].RouteKey"
# → ["GET /auth/slack/callback"]
```

Slack App 설정 (api.slack.com)에서:
- **OAuth & Permissions** → Redirect URLs: `https://api.seolphung.com/auth/slack/callback` 확인

- [ ] M-15 완료: Slack OAuth Redirect URL 일치 확인

---

### M-16. Cognito Lambda Permission 수동 확인

Terraform apply 시 `aws_lambda_permission.cognito_post_confirmation`이 생성되어야 한다.  
만약 누락되면 수동으로 추가:

```bash
aws lambda add-permission \
  --function-name aigo-post-confirmation \
  --statement-id cognito-post-confirmation \
  --action lambda:InvokeFunction \
  --principal cognito-idp.amazonaws.com \
  --source-arn "arn:aws:cognito-idp:ap-northeast-2:$(aws sts get-caller-identity --query Account --output text):userpool/*" \
  --region ap-northeast-2
```

Cognito User Pool에 Post Confirmation Trigger 설정 확인:
```bash
aws cognito-idp describe-user-pool \
  --user-pool-id $(terraform -chdir=infra/terraform/envs/prod output -raw cognito_user_pool_id) \
  --query "UserPool.LambdaConfig.PostConfirmation" \
  --region ap-northeast-2
# → "arn:aws:lambda:ap-northeast-2:ACCOUNT:function:aigo-post-confirmation"
```

- [ ] M-16 완료: Cognito Post Confirmation Lambda trigger 설정 확인

---

### M-17. KB 문서 category 메타데이터 태그 설정

Bedrock Knowledge Base 문서 필터링을 위해 S3 객체에 metadata sidecar 파일이 필요하다.  
각 문서 파일명 + `.metadata.json`을 동일 경로에 생성한다.

```bash
S3_BUCKET="aigo-kb"

# coding-standards/ 하위 모든 문서에 메타데이터 태그
for key in $(aws s3 ls s3://${S3_BUCKET}/coding-standards/ --recursive \
  --query "Contents[?!ends_with(Key,'.metadata.json')].Key" --output text); do
  
  aws s3 cp - "s3://${S3_BUCKET}/${key}.metadata.json" << EOF
{"metadataAttributes":{"category":"coding_standards"}}
EOF
done

# infrastructure-standards/
for key in $(aws s3 ls s3://${S3_BUCKET}/infrastructure-standards/ --recursive \
  --query "Contents[?!ends_with(Key,'.metadata.json')].Key" --output text); do
  aws s3 cp - "s3://${S3_BUCKET}/${key}.metadata.json" << EOF
{"metadataAttributes":{"category":"infrastructure"}}
EOF
done

# security-policies/
for key in $(aws s3 ls s3://${S3_BUCKET}/security-policies/ --recursive \
  --query "Contents[?!ends_with(Key,'.metadata.json')].Key" --output text); do
  aws s3 cp - "s3://${S3_BUCKET}/${key}.metadata.json" << EOF
{"metadataAttributes":{"category":"security"}}
EOF
done

# risk-policies/
for key in $(aws s3 ls s3://${S3_BUCKET}/risk-policies/ --recursive \
  --query "Contents[?!ends_with(Key,'.metadata.json')].Key" --output text); do
  aws s3 cp - "s3://${S3_BUCKET}/${key}.metadata.json" << EOF
{"metadataAttributes":{"category":"risk"}}
EOF
done

# 메타데이터 반영을 위해 Knowledge Base 재인제스션
KB_ID=$(cd infra/terraform/envs/prod && terraform output -raw bedrock_kb_id)
for DS_ID in $(aws bedrock-agent list-data-sources \
  --knowledge-base-id $KB_ID \
  --query "dataSourceSummaries[*].dataSourceId" \
  --output text --region ap-northeast-2); do
  aws bedrock-agent start-ingestion-job \
    --knowledge-base-id $KB_ID \
    --data-source-id $DS_ID \
    --region ap-northeast-2
  echo "인제스션 시작: $DS_ID"
done
```

- [ ] M-17 완료: KB 문서 category 메타데이터 태그 설정 + 재인제스션

---

### M-18. 프론트엔드 빌드 배포

Phase M에서 추가/수정된 페이지가 포함된 프론트엔드를 재빌드한다.

```bash
cd apps/dashboard

# 환경변수 확인 (.env.production)
cat .env.production
# VITE_COGNITO_USER_POOL_ID=ap-northeast-2_XXX
# VITE_COGNITO_CLIENT_ID=XXXX
# VITE_API_BASE_URL=https://api.seolphung.com
# VITE_APP_URL=https://app.seolphung.com

npm install
npm run build

# S3 업로드
aws s3 sync dist/ s3://aigo-frontend/ --delete
aws cloudfront create-invalidation \
  --distribution-id $(cd ../../infra/terraform/envs/prod && terraform output -raw cloudfront_distribution_id) \
  --paths "/*"
```

- [ ] M-18 완료: 프론트엔드 빌드 + CloudFront 배포

---

### M-19. E2E 검증 — 멀티테넌시 플로우

```bash
# 1. 회원가입 테스트
# → https://app.seolphung.com/register 에서 신규 이메일로 회원가입
# → 인증 코드 이메일 수신 확인 (SES 발송)
# → 코드 입력 후 /onboarding 으로 리다이렉트 확인

# 2. 온보딩 플로우 확인
# → Step 1: 조직명 입력 → Organizations DDB 레코드 생성 확인
aws dynamodb query \
  --table-name aigo-Organizations \
  --index-name GSI1-orgId-provider-index \
  --key-condition-expression "GSI1PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"GITHUB_LOGIN#YOUR_ORG"}}' \
  --region ap-northeast-2

# → Step 2: GitHub App 설치 → installation 이벤트 수신
# GitHub App 설치 후 CloudWatch 로그 확인
aws logs filter-log-events \
  --log-group-name /aws/lambda/aigo-github-app-setup \
  --start-time $(date -d '5 minutes ago' +%s)000 \
  --region ap-northeast-2

# → Integrations 테이블에 GITHUB 레코드 생성 확인
aws dynamodb get-item \
  --table-name aigo-Integrations \
  --key '{"PK":{"S":"ORG#YOUR_ORG_ID"},"SK":{"S":"INTEGRATION#GITHUB"}}' \
  --region ap-northeast-2

# → Step 3: Slack 연결 → SSM 토큰 저장 확인
aws ssm get-parameter \
  --name "/aigo/integrations/slack/YOUR_ORG_ID/bot-token" \
  --with-decryption \
  --region ap-northeast-2

# → Step 4: 리포지토리 등록 → /onboarding/complete

# 3. PR 분석 테스트 (멀티테넌시 검증)
# → 등록한 리포에 PR 생성
# → github-connector가 installationId로 orgId 조회 확인 (GSI2)
# → 오케스트레이터가 GitHub Check Run 생성 확인
# → 오케스트레이터가 per-org Slack 알림 발송 확인
# → PR에 riskScore 포함된 코멘트 게시 확인
```

- [ ] M-19a 완료: 회원가입 → 이메일 인증 플로우
- [ ] M-19b 완료: 온보딩 4단계 (조직 → GitHub → Slack → 리포지토리)
- [ ] M-19c 완료: PR 분석 → Check Run → per-org Slack → riskScore PR 코멘트
- [ ] M-19d 완료: 대시보드에서 riskScore 숫자 표시 확인

---

## Phase N — Gap Analysis 구현 배포

> **전제:** Phase M 완료 상태에서 진행.  
> Phase N의 대부분은 Phase M Terraform apply 시 이미 함께 배포된다.  
> 별도 배포가 필요한 항목만 아래에 표시.

---

### N-1. DynamoDB + IAM + Guardrail Terraform apply

```bash
cd infra/terraform/global/iam
terraform apply -var-file=terraform.tfvars
# 변경: ECS Task BedrockInvokeAgent, Orchestrator SSMSlackTokensRead

cd infra/terraform/envs/prod

# DynamoDB (AgentMemory table #15 추가)
terraform apply -target=module.dynamodb -var-file=terraform.tfvars

# Bedrock Guardrail 생성
terraform apply \
  -target=aws_bedrock_guardrail.orchestrator \
  -target=aws_lambda_function_event_invoke_config.orchestrator_guardrail \
  -var-file=terraform.tfvars

# 확인
aws bedrock list-guardrails \
  --region ap-northeast-2 \
  --query "guardrails[?name=='aigo-orchestrator-guardrail'].[id,version,status]"
```

- [ ] N-1a 완료: AgentMemory table 생성 확인
- [ ] N-1b 완료: IAM 업데이트 (ECS BedrockInvokeAgent, Orchestrator SSM Read)
- [ ] N-1c 완료: Bedrock Guardrail 생성 확인

---

### N-2. Orchestrator Lambda 재배포 (Guardrail ID 포함)

Guardrail이 생성된 후 `BEDROCK_GUARDRAIL_ID` 환경변수가 Lambda에 주입되어야 한다.

```bash
cd infra/terraform/envs/prod

# Lambda 환경변수 업데이트 (Guardrail ID 반영)
terraform apply \
  -target=module.lambda_orchestrator \
  -var-file=terraform.tfvars

# Orchestrator 코드 재배포
./scripts/deploy-orchestrator.sh

# 환경변수 확인
aws lambda get-function-configuration \
  --function-name aigo-orchestrator \
  --query "Environment.Variables.BEDROCK_GUARDRAIL_ID" \
  --region ap-northeast-2
# → "guardrailId 값" (빈 문자열이 아니어야 함)
```

- [ ] N-2 완료: Orchestrator 재배포 + Guardrail ID 환경변수 확인

---

### N-3. Heavy Worker ECS 배포 (Fix Agent 통합)

```bash
# heavy-worker 이미지 재빌드 (FIX_AGENT_ID 등 환경변수 ECS Task에 주입됨)
cd workers/heavy

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.ap-northeast-2.amazonaws.com/aigo-worker-heavy"

docker build -t aigo-worker-heavy .
docker tag aigo-worker-heavy:latest "${ECR_REPO}:latest"
docker push "${ECR_REPO}:latest"

# ECS Task Definition 갱신 (FIX_AGENT_ID, FIX_AGENT_ALIAS_ID 포함)
cd infra/terraform/envs/prod
terraform apply -target=module.ecs -var-file=terraform.tfvars

# 확인: ECS Task Definition 환경변수
aws ecs describe-task-definition \
  --task-definition aigo-heavy-worker \
  --region ap-northeast-2 \
  --query "taskDefinition.containerDefinitions[0].environment[?name=='FIX_AGENT_ID']"
```

- [ ] N-3 완료: Heavy Worker 재빌드 + ECS Task Definition FIX_AGENT_ID 포함 확인

---

### N-4. Dashboard API Lambda 재배포 (Approval + Audit)

```bash
# dashboard-api 재빌드 및 배포
./scripts/deploy-lambda.sh dashboard-api

# API Gateway 라우트 확인
aws apigatewayv2 get-routes \
  --api-id API_GW_ID \
  --region ap-northeast-2 \
  --query "Items[?contains(RouteKey,'approve') || contains(RouteKey,'approvals') || contains(RouteKey,'complete')].RouteKey"
# → ["POST /reports/{reportId}/approve", "GET /reports/{reportId}/approvals", "POST /onboarding/complete"]
```

- [ ] N-4 완료: Dashboard API 재배포 + 새 라우트 확인

---

### N-5. Slack OAuth Connector 재배포 (channelId SSM 저장)

```bash
./scripts/deploy-lambda.sh slack-oauth
# 또는
cd connectors/slack-oauth
npm run build && zip -r /tmp/slack-oauth.zip dist/ node_modules/
aws lambda update-function-code \
  --function-name aigo-slack-oauth \
  --zip-file fileb:///tmp/slack-oauth.zip \
  --region ap-northeast-2
```

- [ ] N-5 완료: Slack OAuth Connector 재배포

---

### N-6. 프론트엔드 재빌드 배포 (riskScore 표시)

```bash
cd apps/dashboard
npm run build

aws s3 sync dist/ s3://aigo-frontend/ --delete
aws cloudfront create-invalidation \
  --distribution-id CLOUDFRONT_ID \
  --paths "/*"
```

- [ ] N-6 완료: 프론트엔드 재배포 (riskScore 표시 포함)

---

### N-7. E2E 검증 — Gap Analysis 구현 확인

```bash
# 1. GitHub Check Run 확인
# → 테스트 PR 생성 후 GitHub PR 페이지에서 Check 탭 확인
# → "AgentOps / PR Analysis" Check Run이 in_progress → completed 로 변경되는지 확인

# 2. AgentMemory 저장 확인
aws dynamodb query \
  --table-name aigo-AgentMemory \
  --index-name GSI1-repo-time-index \
  --key-condition-expression "GSI1PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"ORG#YOUR_ORG_ID#REPO#YOUR_REPO_ID"}}' \
  --region ap-northeast-2

# 3. Approval → Memory 확인
# → 대시보드에서 리포트 승인 클릭
# → AgentMemory에 APPROVAL_FEEDBACK 레코드 생성 확인
aws dynamodb query \
  --table-name aigo-AgentMemory \
  --index-name GSI2-author-time-index \
  --key-condition-expression "GSI2PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"ORG#YOUR_ORG_ID#APPROVALS"}}' \
  --region ap-northeast-2

# 4. Audit Log 확인
aws dynamodb query \
  --table-name aigo-AuditLogs \
  --index-name GSI1-orgId-createdAt-index \
  --key-condition-expression "GSI1PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"ORG#YOUR_ORG_ID"}}' \
  --limit 5 \
  --scan-index-forward false \
  --region ap-northeast-2

# 5. riskScore PR 코멘트 확인
# → PR 코멘트에 "Risk Score: XX/100" + score bar 있는지 확인

# 6. per-org Slack 알림 확인
# → 온보딩 시 연결한 Slack workspace/채널에 알림 수신 확인
```

- [ ] N-7a 완료: GitHub Check Run in_progress → completed 확인
- [ ] N-7b 완료: AgentMemory PR_ANALYSIS 레코드 생성 확인
- [ ] N-7c 완료: 승인 후 APPROVAL_FEEDBACK 메모리 저장 확인
- [ ] N-7d 완료: AuditLogs에 API 호출 기록 확인
- [ ] N-7e 완료: PR 코멘트에 riskScore 숫자 + score bar 표시 확인
- [ ] N-7f 완료: per-org Slack 채널 알림 수신 확인

---

## 인프라 비용 참고

### KB 벡터 검색 — S3 Vector (현재 운영 방식)

> **현재 상태:** AOSS `enabled = false` — Bedrock KB + AOSS는 비활성화됨.  
> KB 검색은 S3 JSON 인덱스 + Titan Embeddings v2 코사인 유사도로 동작.

| 방식 | 월 비용 |
|------|---------|
| Bedrock KB + AOSS (이전) | ~$700/월 (4 OCU 고정) |
| **S3 Vector KB (현재)** | **~$1/월** |

**인덱스 구축/업데이트:**
```bash
python scripts/build-kb-index.py
# docs/kb/**/*.md → Titan Embeddings → s3://aigo-kb/vector-index/index.json
```

상세 내용: [docs/impl/kb-s3-vector.md](../impl/kb-s3-vector.md)

### Amazon OpenSearch Serverless (AOSS) — 비활성화됨

> **중요:** AOSS Vector Search 컬렉션은 **일시 중지(pause)가 불가능**하다.  
> 현재 `enabled = false`로 비활성화 — 과금 없음.

| 항목 | 비용 (활성화 시) |
|------|------|
| 최소 OCU | 인덱싱 2 OCU + 검색 2 OCU = 4 OCU |
| OCU 단가 | $0.24/시간 |
| **월 고정 비용** | **4 × $0.24 × 24h × 30일 ≈ $691** |

**현재 설정 (prod):** `enabled = false` — 월 $0.

---

## 현재 Lambda 버전 현황 (2026-06-16 기준)

| Lambda 함수 | 현재 버전 | 주요 변경 |
|-------------|---------|---------|
| `aigo-orchestrator` | v14 | S3 Vector KB (Titan Embeddings, v14), LLM 페르소나 선택 Step 0c (v13) |
| `aigo-lightweight-worker` | v22 | SQS retry ConditionalCheckFailed 수정 |
| `aigo-dashboard-api` | v31 | SES try-catch 추가 (non-fatal), esbuild 번들 수정 |
| `aigo-github-connector` | latest | EventBridge aigo-bus PutEvents 전환 |
| `aigo-notification-worker` | latest | REVIEW_SUBMITTED → GitHub formal review |
| `aigo-post-confirmation` | latest | Cognito post-confirmation trigger |

> **최신 버전 (2026-06-18 기준)**: `docs/impl/system-status.md` §5 참조.

| Lambda 함수 | 최신 버전 (2026-06-18) | 누적 주요 변경 |
|-------------|----------------------|-------------|
| `aigo-orchestrator` | **v23** | riskThreshold 문자열 dict 매핑, auto_merge_pr, AgentRuns 이중 기록 |
| `aigo-lightweight-worker` | **v28** | aws-clients dist 재빌드(SQS 표준큐 버그), command/incident ESM 추가 |
| `aigo-dashboard-api` | **v42** | findings JOB# 쿼리 키, approve 단일 엔드포인트, settings riskThreshold |
| `aigo-github-connector` | **v25** | EventBridge 제거 → SQS 직접 전송, MessageGroupId=orgId |
| `aigo-notification-worker` | **v11** | REJECTED 시 closePr 추가, APPROVED 시 mergePr |

---

## esbuild 번들 설정 (중요)

모든 Node.js Lambda의 `package.json` bundle 스크립트에서 `--external:@aws-sdk/*` 제거됨.

**이전 (문제 있음):**
```json
"bundle": "esbuild src/index.ts --bundle ... --external:@aws-sdk/*"
```

**현재 (올바름):**
```json
"bundle": "esbuild src/index.ts --bundle --platform=node --target=node22 --outfile=dist/index.js"
```

**이유:** `@aws-sdk/client-dynamodb@3.700.0`이 `@smithy/core`를 peer dependency로 요구하는데,  
`--external:@aws-sdk/*`로 번들에서 제외하면 Lambda 런타임에서 `@smithy/core` 없이 실행 중  
`ImportModuleError`가 발생한다. esbuild가 전부 번들하면 단일 `dist/index.js` (~3.6MB, zip ~600KB)로  
의존성 문제가 사라진다.

CI/CD (`scripts/deploy-lambda.sh`) 는 `dist/index.js`만 zip → 영향 없음.

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
- [impl/phase-m-multitenant.md](../impl/phase-m-multitenant.md) — Phase M 상세 구현 내역
- [docs/03-data-model.md](../03-data-model.md) — DynamoDB 15개 테이블 스키마

