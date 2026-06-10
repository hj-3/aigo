# Runbook: 리전 장애 — Tokyo Failover

**대상**: On-call 엔지니어  
**예상 소요**: 20–30분  
**트리거**: Seoul(ap-northeast-2) 전체 장애 또는 Route 53 Health Check 연속 실패

---

## 1. 장애 확인

```bash
# Seoul API 응답 확인
curl -I https://api.{domain}/health

# Route 53 Health Check 상태 확인
aws route53 get-health-check-status \
  --health-check-id {HEALTH_CHECK_ID} \
  --region us-east-1

# AWS Service Health Dashboard 확인
# https://health.aws.amazon.com
```

## 2. Tokyo Failover 실행

### 2-1. DNS 수동 전환 (Route 53 자동 Failover가 안 된 경우)

```bash
# Primary record weight를 0으로 변경
aws route53 change-resource-record-sets \
  --hosted-zone-id {HOSTED_ZONE_ID} \
  --change-batch file://dns-failover.json
```

### 2-2. Tokyo 인프라 배포

GitHub Actions에서 수동 트리거:

```
Actions → "CD - Deploy" → Run workflow
  Branch: main
  Region override: ap-northeast-1
```

또는 CLI에서:

```bash
# Tokyo용 AWS 자격증명 설정 (OIDC Role)
export AWS_DEFAULT_REGION=ap-northeast-1

cd infra/terraform/envs/prod
terraform init -reconfigure \
  -backend-config="region=ap-northeast-1" \
  -backend-config="bucket=aigo-tf-state-dr"

terraform apply -var="aws_region=ap-northeast-1" -auto-approve
```

### 2-3. Agent 재배포

```bash
./scripts/deploy-agent.sh orchestrator latest ap-northeast-1
./scripts/deploy-agent.sh code-reviewer latest ap-northeast-1
./scripts/deploy-agent.sh infra-reviewer latest ap-northeast-1
./scripts/deploy-agent.sh risk-reviewer latest ap-northeast-1
./scripts/deploy-agent.sh security-agent latest ap-northeast-1
./scripts/deploy-agent.sh incident-agent latest ap-northeast-1
./scripts/deploy-agent.sh fix-agent latest ap-northeast-1
```

## 3. 서비스 검증

```bash
# API 헬스체크
curl https://api.{domain}/health

# Dashboard 접속 확인
curl -I https://app.{domain}

# DynamoDB Global Tables 확인
aws dynamodb describe-table --table-name aigo-Reports \
  --region ap-northeast-1 \
  --query "Table.GlobalTableVersion"

# 테스트 Webhook 발송
curl -X POST https://api.{domain}/webhooks/github \
  -H "X-Hub-Signature-256: sha256=test" \
  -d '{"action":"ping"}'
```

## 4. Slack 공지

```
[DR Failover 완료]
- 장애 시작: {시각}
- Failover 완료: {시각}
- 현재 운영 리전: ap-northeast-1 (Tokyo)
- 서비스 상태: 정상
- Seoul 복구 후 원복 예정
```

## 5. Seoul 복구 후 원복

1. Seoul 인프라 정상 확인
2. DynamoDB Global Tables 동기화 상태 확인
3. Route 53 Failover record 원복 (Seoul Primary로)
4. Tokyo 임시 리소스 정리

---

**에스컬레이션**: 30분 이내 Failover 불가 시 → 팀 리드 연락
