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
- [x] Phase G-3 — 커스텀 도메인 연결 완료 (app.seolphung.com, ACM us-east-1)
- [x] Phase H — 초기 데이터 설정 (Cognito 사용자, Organization, KB 문서)
- [x] Phase I-1 — API /health + CloudFront 헬스체크 PASSING
- [ ] Phase I-2 — GitHub Webhook 테스트 (실제 PR로 확인 필요)
- [x] Phase I-3 — Dashboard 로그인 테스트 완료
- [x] Phase I-4 — CloudWatch 알람 15개 전체 OK

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
