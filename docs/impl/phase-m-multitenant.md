# Phase M — Multi-Tenancy SaaS Transformation

## 목표

외부 사용자가 자가 등록하고, GitHub App을 본인의 리포지토리에 설치하고, Slack 워크스페이스를 연결하여 독립적으로 서비스를 사용할 수 있도록 전환한다.

---

## 아키텍처 변경 요약

### 인증 흐름 (Before → After)

| Before | After |
|--------|-------|
| Admin이 Cognito 콘솔에서 사용자 생성 | 사용자 직접 가입 (self-signup) |
| Cognito 기본 이메일 (50개/일 제한) | SES 프로덕션 이메일 (무제한) |
| 단일 GitHub App installationId (공유) | 조직별 installationId (Integrations 테이블) |
| 단일 Slack Bot Token (공유) | 조직별 Bot Token (SSM Parameter Store) |

### 멀티테넌시 데이터 격리

- 모든 리소스에 `orgId` 포함
- DynamoDB 쿼리 시 반드시 `orgId` 필터 적용
- SSM 경로: `/{project}/integrations/slack/{orgId}/bot-token`

---

## 새로운 사용자 등록 플로우

```
1. /register 페이지에서 email + password + name 입력
2. Cognito signUp → 이메일 발송 (SES)
3. 인증 코드 입력 → confirmSignUp
4. Cognito Post-Confirmation Lambda 트리거
   → Users 테이블에 레코드 생성
   → OWNER 그룹 추가
5. /onboarding 페이지로 자동 리디렉션
   Step 1: 조직 생성 (POST /onboarding/setup-org)
   Step 2: GitHub App 설치 (github.com/apps/aigo-app/installations/new)
   Step 3: Slack OAuth 2.0 (GET /auth/slack/callback)
   Step 4: 첫 번째 저장소 등록 (POST /repositories)
6. POST /onboarding/complete → custom:onboardingCompleted = "true"
7. 대시보드 메인 페이지로 이동
```

---

## 신규/수정 인프라

### Terraform 모듈

| 모듈 | 변경 |
|------|------|
| `modules/ses` | NEW — 도메인 인증, DKIM/SPF, Cognito 발송 권한 |
| `modules/dynamodb` | Repositories GSI2 추가, Integrations GSI2 추가, OrgInvitations 테이블 추가 |
| `modules/cognito` | self-signup, SES 이메일, post-confirmation Lambda, onboardingCompleted 속성 |
| `modules/bedrock-agentcore` | 7개→3개 (code-reviewer, infra-reviewer, risk-reviewer, security-agent 제거) |
| `global/iam` | connector/api 역할에 SSM 권한, Cognito Admin 권한 추가 |
| `envs/prod/main.tf` | SES 모듈 추가, 새 Lambda 3개, API GW 신규 라우트, Cognito 업데이트 |

### 신규 Lambda

| 이름 | 역할 |
|------|------|
| `github-app-setup` | GitHub App `installation.created/deleted` 웹훅 처리 → Integrations 테이블 기록 |
| `slack-oauth` | Slack OAuth 2.0 콜백 → Bot Token을 SSM에 저장 |
| `post-confirmation` | Cognito 이메일 확인 후 트리거 → Users 테이블 레코드 생성 |

### 수정된 Lambda

| 이름 | 변경 내용 |
|------|---------|
| `github-connector` | GSI2로 PROVIDER_REPO 조회, installation.id→orgId 매핑 |
| `lightweight-worker` | Integrations 테이블에서 per-org installationId 조회 |

---

## DynamoDB 스키마 변경

### Repositories 테이블 — GSI2 추가

```
PK: REPO#{repoId}
SK: METADATA
GSI2PK: PROVIDER_REPO#{providerRepoId}   ← 신규 (webhook routing)
```

### Integrations 테이블 — GSI2 추가

```
PK: ORG#{orgId}
SK: INTEGRATION#GITHUB | INTEGRATION#SLACK
GSI1PK: ORG#{orgId}
GSI1SK: INTEGRATION#GITHUB | INTEGRATION#SLACK
GSI2PK: INSTALLATION#{installationId}   ← 신규 (webhook → orgId lookup)
       SLACK_TEAM#{teamId}              ← 신규
```

### OrgInvitations 테이블 — 신규

```
PK: ORG#{orgId}
SK: INVITATION#{invitationId}
GSI1PK: EMAIL#{email}                   ← 초대 이메일로 조회
GSI1SK: {createdAt}
TTL: 7일 후 자동 삭제
```

---

## API 신규 라우트

### 공개 (인증 불필요)
- `POST /webhooks/github/app` — GitHub App installation webhook
- `GET /auth/slack/callback` — Slack OAuth callback (redirect)

### 온보딩 (인증 필요, onboardingCompleted 불필요)
- `POST /onboarding/setup-org` — 조직 생성
- `GET /onboarding/status` — 온보딩 단계 확인
- `POST /onboarding/complete` — 온보딩 완료 마킹

### 팀 관리
- `GET /team/members` — 팀원 목록
- `POST /team/invite` — 초대 이메일 발송
- `PATCH /team/members/:userId/role` — 역할 변경
- `DELETE /team/members/:userId` — 팀원 제거

### 저장소 관리
- `POST /repositories` — 저장소 등록
- `DELETE /repositories/:repoId` — 등록 해제
- `PATCH /repositories/:repoId/config` — 분석 설정 변경

### 연동
- `GET /integrations` — GitHub/Slack 연결 상태
- `DELETE /integrations/slack` — Slack 연결 해제

---

## Slack Bot Token 저장 구조

```
SSM Parameter Store (SecureString):
/{project}/integrations/slack/{orgId}/bot-token

notification-worker가 Slack 알림 발송 시:
1. orgId → SSM에서 bot-token 조회
2. Slack Web API chat.postMessage 호출
```

---

## 배포 절차 (Phase M)

### 사전 준비

1. GitHub App 생성 (github.com/settings/apps)
   - Webhook URL: `https://api.seolphung.com/webhooks/github/app`
   - Permissions: `pull_requests: read`, `contents: read`
   - Events: `pull_request`, `installation`
   - Note: App ID, slug, private key

2. Slack App 생성 (api.slack.com/apps)
   - OAuth Redirect URL: `https://api.seolphung.com/auth/slack/callback`
   - Bot Token Scopes: `chat:write`, `chat:write.public`, `channels:read`
   - Note: Client ID, Client Secret

3. SES 도메인 인증 (us-east-1 아님, ap-northeast-2)
   - seolphung.com 도메인의 Route53 Zone ID 확인

### Terraform 배포 (2단계)

**Stage 1 — Global IAM 업데이트**
```bash
cd infra/terraform/global/iam
terraform init
terraform plan -var="aws_account_id=ACCOUNT_ID" -var="github_org=your-org"
terraform apply
```

**Stage 2 — Prod 환경 배포**
```bash
cd infra/terraform/envs/prod

# terraform.tfvars 업데이트
cat >> terraform.tfvars << EOF
github_app_id     = "YOUR_GITHUB_APP_ID"
github_app_slug   = "aigo-app"
slack_client_id   = "YOUR_SLACK_CLIENT_ID"
slack_client_secret = "YOUR_SLACK_CLIENT_SECRET"
EOF

terraform init
terraform plan
terraform apply
```

### Lambda 패키지 배포

```bash
# 각 신규 Lambda 빌드 및 업로드
for fn in github-app-setup slack-oauth post-confirmation; do
  cd connectors/$fn
  pnpm bundle
  aws s3 cp dist/index.js s3://aigo-artifacts/lambda/$fn/latest.zip
  aws lambda update-function-code --function-name aigo-$fn --s3-bucket aigo-artifacts --s3-key lambda/$fn/latest.zip
  cd ../..
done

# 수정된 Lambda 재배포
cd connectors/github
pnpm bundle
aws s3 cp dist/index.js s3://aigo-artifacts/lambda/github-connector/latest.zip
aws lambda update-function-code --function-name aigo-github-connector ...

cd workers/lightweight
pnpm bundle
aws s3 cp dist/index.js s3://aigo-artifacts/lambda/lightweight-worker/latest.zip
aws lambda update-function-code --function-name aigo-lightweight-worker ...
```

### Secrets Manager 업데이트

```bash
# GitHub App 자격증명 업데이트
aws secretsmanager put-secret-value \
  --secret-id aigo/github/app-credentials \
  --secret-string '{"appId":"YOUR_APP_ID","privateKey":"-----BEGIN RSA PRIVATE KEY-----\n...","webhookSecret":"YOUR_WEBHOOK_SECRET"}'

# Slack OAuth 자격증명 (선택 — env var로도 가능)
aws secretsmanager put-secret-value \
  --secret-id aigo/slack/oauth-credentials \
  --secret-string '{"clientId":"...","clientSecret":"...","signingSecret":"..."}'
```

### SES 샌드박스 해제

AWS 콘솔 → SES → Account dashboard → "Request production access"
- 사용 사례: transactional emails (계정 확인 이메일)
- 예상 발송량: <10,000/일

### 검증

```bash
# 1. 회원가입 테스트
curl -X POST https://app.seolphung.com/register
# → 이메일 수신 확인

# 2. 온보딩 플로우
# → /onboarding 페이지에서 단계별 완료 확인

# 3. GitHub App 설치 후 테스트 PR 생성
# → /webhooks/github/app 수신 확인
# → AnalysisJob 생성 확인
```

---

## 완료 기준

- [ ] 신규 사용자 자가 등록 가능
- [ ] SES 이메일 발송 동작 (인증 코드)
- [ ] GitHub App 설치 후 Integrations 테이블에 installationId 기록
- [ ] Slack OAuth 후 SSM에 bot-token 저장
- [ ] PR 웹훅 → 올바른 orgId로 AnalysisJob 생성
- [ ] 대시보드에서 팀원 초대 및 역할 관리 가능
- [ ] 저장소 등록/해제 가능
- [ ] Settings → 연동 섹션에서 GitHub/Slack 상태 표시
