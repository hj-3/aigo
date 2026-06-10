# Runbook: Incident 대응 절차

## P1 — 서비스 전체 중단

**RTO 목표**: 15분

```
1. [0–3분]   CloudWatch Alarm → Slack 알림 확인
2. [3–8분]   원인 파악 (DLQ 메시지, Lambda 에러율, Agent 실패율)
3. [8–13분]  조치 실행 (롤백 또는 Fix 배포)
4. [13–15분] 서비스 복구 확인
```

### 원인별 빠른 진단

```bash
# Lambda 에러율 확인
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=aigo-github-connector \
  --start-time $(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Sum

# DLQ 메시지 수 확인
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-2.amazonaws.com/{account}/aigo-analysis-dlq \
  --attribute-names ApproximateNumberOfMessages

# 최근 CloudTrail 변경 이력
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventSource,AttributeValue=lambda.amazonaws.com \
  --start-time $(date -u -d '2 hours ago' +%Y-%m-%dT%H:%M:%SZ) \
  --query "Events[?ErrorCode==null].[EventTime,EventName,Username]"

# AgentCore 실패 AgentRun 조회
aws dynamodb query \
  --table-name aigo-AgentRuns \
  --index-name jobId-agentType-index \
  --filter-expression "#status = :failed" \
  --expression-attribute-names '{"#status":"status"}' \
  --expression-attribute-values '{":failed":{"S":"FAILED"}}' \
  --limit 10
```

## P2 — Agent 분석 실패

```bash
# 1. DLQ 메시지 확인 및 재처리
aws sqs receive-message \
  --queue-url https://sqs.ap-northeast-2.amazonaws.com/{account}/aigo-analysis-dlq \
  --max-number-of-messages 10

# 2. 문제 있는 Job ID 확인 후 수동 재처리
aws sqs send-message \
  --queue-url https://sqs.ap-northeast-2.amazonaws.com/{account}/aigo-analysis-queue \
  --message-body '{"jobId":"{JOB_ID}","rerun":true}'

# 3. Agent 롤백 필요 시
./scripts/deploy-agent.sh orchestrator {prev-version}
```

## P3 — GitHub Webhook 수신 중단

```bash
# 1. 서명 검증 실패 알람 확인
aws cloudwatch get-metric-statistics \
  --namespace AgentOps/Security \
  --metric-name WebhookSignatureFailure \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 --statistics Sum

# 2. Webhook Secret 확인
aws secretsmanager get-secret-value \
  --secret-id aigo/github/webhook-secret \
  --query SecretString

# 3. GitHub App 설치 상태 확인 (GitHub Admin에서)
# https://github.com/organizations/{org}/settings/installations
```

## Slack 상태 공지 템플릿

```
🚨 [INCIDENT P1] AgentOps 서비스 장애
발생: {시각}
영향: PR 분석 중단 / {영향 범위}
원인: 조사 중
조치: {담당자}가 대응 중
다음 업데이트: 15분 후
```

복구 공지:

```
✅ [RESOLVED] AgentOps 서비스 복구
복구 완료: {시각}
총 영향 시간: {X}분
원인: {원인}
조치: {조치 내용}
재발 방지: {예정 조치}
```
