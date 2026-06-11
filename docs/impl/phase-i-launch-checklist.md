# Phase I: 배포 검증 (Deployment Verification)

> 전체 스택이 배포된 후, 실제 트래픽을 받기 전 수행하는 엔드-투-엔드 동작 검증.  
> 각 항목을 순서대로 실행하고 결과를 기록한다.

---

## 전제 조건 — 인프라 배포 현황

Phase I 진입 시점 기준 배포 상태 (2026-06-11):

| 리소스 | 이름/ID | 상태 |
|--------|---------|------|
| CloudFront | d14fywc3dbqqf3.cloudfront.net | ✅ Deployed |
| API Gateway | jxvucbg4c0 (aigo-api) | ✅ Active |
| Lambda × 7 | aigo-github-connector 외 6개 | ✅ 배포됨 |
| ECS Cluster | aigo-cluster | ✅ Active |
| DynamoDB × 14 | aigo-AnalysisJobs 외 13개 | ✅ Active |
| SQS × 10 | analysis/fix/fix/incident/notification × 2 | ✅ Active |
| Cognito | ap-northeast-2_AKb8Xkx3b | ✅ Active |
| Bedrock KB | BTLXQGMG9F (4 DS × COMPLETE) | ✅ COMPLETE |
| Bedrock Agents × 7 | orchestrator, code-reviewer 외 5개 | ✅ PREPARED |
| Secrets Manager × 5 | aigo/github/*, aigo/slack/* | ⚠️ 미설정 |

---

## I-1: 프론트엔드 접속 검증

**목적**: CloudFront → S3 → React 앱이 정상 로드되는지 확인.

**확인 URL**: `https://d14fywc3dbqqf3.cloudfront.net`

체크리스트:
- [ ] HTTP 200 응답 (4xx/5xx 없음)
- [ ] React 앱 SPA 로드 (index.html 반환)
- [ ] Console에 CSP 오류 없음
- [ ] Google Fonts 로드 성공 (Network 탭에서 fonts.googleapis.com 200)
- [ ] `/login` 페이지로 자동 리다이렉트 확인

```bash
# HTTP 상태 코드 확인
curl -s -o /dev/null -w "%{http_code}" https://d14fywc3dbqqf3.cloudfront.net/
```

---

## I-2: Cognito 로그인 검증

**목적**: Managed Login UI 표시 및 로그인 흐름 완성 확인.

**Cognito 도메인**: `https://aigo-auth.auth.ap-northeast-2.amazoncognito.com`

체크리스트:
- [ ] 관리형 로그인 UI 스타일 표시 (레거시 UI 아님)
- [ ] 회원가입 버튼 존재 (8자 이상 비밀번호 허용 확인)
- [ ] 테스트 계정으로 로그인 성공
- [ ] 로그인 후 CloudFront 도메인(`/`)으로 리다이렉트
- [ ] Dashboard 페이지 정상 로드

**테스트 계정 생성** (최초 1회):
```bash
aws cognito-idp admin-create-user \
  --region ap-northeast-2 \
  --user-pool-id ap-northeast-2_AKb8Xkx3b \
  --username test@example.com \
  --temporary-password "Test1234!" \
  --user-attributes Name=email,Value=test@example.com Name=email_verified,Value=true

# 영구 비밀번호 설정 (초기 로그인 후 변경 요구 제거)
aws cognito-idp admin-set-user-password \
  --region ap-northeast-2 \
  --user-pool-id ap-northeast-2_AKb8Xkx3b \
  --username test@example.com \
  --password "Test1234!" \
  --permanent
```

---

## I-3: API Gateway 헬스체크

**목적**: Lambda Cold Start 없이 API가 응답하는지 확인.

**엔드포인트**: `https://jxvucbg4c0.execute-api.ap-northeast-2.amazonaws.com`

```bash
# 헬스체크 (인증 없음)
curl -s https://jxvucbg4c0.execute-api.ap-northeast-2.amazonaws.com/health | jq .

# 인증 필요 엔드포인트 — ID 토큰으로 테스트
TOKEN=$(aws cognito-idp initiate-auth \
  --region ap-northeast-2 \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id 4hc9ig8nkokctbvu9l25irigct \
  --auth-parameters USERNAME=test@example.com,PASSWORD="Test1234!" \
  --query "AuthenticationResult.IdToken" --output text)

curl -s -H "Authorization: Bearer $TOKEN" \
  https://jxvucbg4c0.execute-api.ap-northeast-2.amazonaws.com/repositories | jq .
```

체크리스트:
- [ ] `/health` → 200
- [ ] `/repositories` (인증 포함) → 200 또는 빈 배열 (403 아님)
- [ ] Lambda 응답 시간 < 5초 (cold start 포함)

---

## I-4: SQS → Lambda 연동 검증

**목적**: SQS 메시지가 Lambda trigger로 처리되는지 확인.

```bash
# 테스트 메시지를 analysis-queue에 전송
aws sqs send-message \
  --region ap-northeast-2 \
  --queue-url https://sqs.ap-northeast-2.amazonaws.com/440744256869/aigo-analysis-queue.fifo \
  --message-body '{"test": true, "source": "phase-i-verify"}' \
  --message-group-id "test" \
  --message-deduplication-id "phase-i-$(date +%s)"

# Lambda 처리 로그 확인 (30초 대기)
sleep 5
aws logs filter-log-events \
  --region ap-northeast-2 \
  --log-group-name "/aws/lambda/aigo-lightweight-worker" \
  --start-time $(($(date +%s) - 60))000 \
  --filter-pattern "phase-i-verify" \
  --query "events[*].message" \
  --output text
```

체크리스트:
- [ ] 메시지 전송 성공 (MessageId 반환)
- [ ] Lambda 로그에 처리 기록 확인
- [ ] DLQ 메시지 없음 확인

```bash
# DLQ 메시지 수 확인
aws sqs get-queue-attributes \
  --region ap-northeast-2 \
  --queue-url https://sqs.ap-northeast-2.amazonaws.com/440744256869/aigo-analysis-dlq.fifo \
  --attribute-names ApproximateNumberOfMessages
```

---

## I-5: Bedrock Agent 호출 검증

**목적**: Bedrock Agent가 응답하는지 확인.

```bash
# Orchestrator Agent 직접 호출 테스트
aws bedrock-agent-runtime invoke-agent \
  --region ap-northeast-2 \
  --agent-id XWEJHKV4YP \
  --agent-alias-id LHCUPLBGFA \
  --session-id "phase-i-test-$(date +%s)" \
  --input-text "Hello, this is a connectivity test. Respond with OK." \
  --output text 2>/dev/null | head -5
```

체크리스트:
- [ ] Agent 응답 반환 (오류 없음)
- [ ] Knowledge Base 조회 포함 응답 (KB ingestion 정상)

---

## I-6: Phase C — GitHub/Slack 연동 (미완료 — 실 운영 전 필수)

> 이 단계는 GitHub App과 Slack App을 실제로 등록해야 완료 가능.  
> 현재 Secrets Manager에 placeholder 상태.

### 필요 작업

**GitHub App 등록** (https://github.com/settings/apps/new):
- Name: `aigo-devops`
- Webhook URL: `https://jxvucbg4c0.execute-api.ap-northeast-2.amazonaws.com/webhook/github`
- Webhook Secret: 임의 문자열 생성 후 Secrets Manager에 저장
- Permissions: Pull requests (Read & Write), Contents (Read), Checks (Write)
- Subscribe to: Pull request, Pull request review, Push

GitHub App 등록 후 Secrets Manager 업데이트:
```bash
aws secretsmanager put-secret-value \
  --region ap-northeast-2 \
  --secret-id aigo/github/app-credentials \
  --secret-string '{
    "app_id": "<APP_ID>",
    "client_id": "<CLIENT_ID>",
    "client_secret": "<CLIENT_SECRET>",
    "private_key": "<PEM_CONTENT>"
  }'

aws secretsmanager put-secret-value \
  --region ap-northeast-2 \
  --secret-id aigo/github/webhook-secret \
  --secret-string '{"webhook_secret": "<WEBHOOK_SECRET>"}'
```

**Slack App 등록** (https://api.slack.com/apps):
- Name: `aigo-devops`
- Slash Commands: `/aigo` → `https://jxvucbg4c0.execute-api.ap-northeast-2.amazonaws.com/slack/command`
- Bot Token Scopes: `chat:write`, `channels:read`, `app_mentions:read`

Slack App 등록 후:
```bash
aws secretsmanager put-secret-value \
  --region ap-northeast-2 \
  --secret-id aigo/slack/bot-token \
  --secret-string '{"bot_token": "xoxb-...", "signing_secret": "<SIGNING_SECRET>"}'
```

체크리스트:
- [ ] GitHub App 생성 + Secrets Manager 업데이트
- [ ] Slack App 생성 + Bot Token 저장
- [ ] GitHub 테스트 리포지토리에 App 설치
- [ ] PR 생성 시 webhook 수신 확인 (CloudWatch Logs)
- [ ] `/aigo help` Slack 명령 응답 확인

---

## I-7: 모니터링 기준선 확인

**목적**: CloudWatch 알람이 정상 상태(OK)인지 확인.

```bash
# 알람 상태 확인
aws cloudwatch describe-alarms \
  --region ap-northeast-2 \
  --alarm-name-prefix "aigo-" \
  --query "MetricAlarms[*].[AlarmName,StateValue]" \
  --output table
```

체크리스트:
- [ ] 모든 알람 INSUFFICIENT_DATA 또는 OK (ALARM 없음)
- [ ] DLQ 메시지 수 = 0
- [ ] Lambda 에러율 = 0

---

## 최종 검증 요약

| 항목 | 상태 |
|------|------|
| I-1: 프론트엔드 접속 | ⬜ 미확인 |
| I-2: Cognito 로그인 | ⬜ 미확인 |
| I-3: API Gateway 헬스체크 | ⬜ 미확인 |
| I-4: SQS → Lambda 연동 | ⬜ 미확인 |
| I-5: Bedrock Agent 호출 | ⬜ 미확인 |
| I-6: GitHub/Slack 연동 | ⚠️ Phase C 진행 필요 |
| I-7: 모니터링 기준선 | ⬜ 미확인 |
