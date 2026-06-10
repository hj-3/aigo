# Runbook: Lambda / Agent 롤백

## Lambda 롤백 (Alias 기반)

```bash
# 1. 현재 alias 상태 확인
aws lambda get-alias \
  --function-name aigo-{function-name} \
  --name live

# 2. 이전 버전 확인
aws lambda list-versions-by-function \
  --function-name aigo-{function-name} \
  --query "Versions[-5:].[Version,LastModified]"

# 3. 이전 버전으로 alias 즉시 롤백
aws lambda update-alias \
  --function-name aigo-{function-name} \
  --name live \
  --function-version {PREV_VERSION} \
  --routing-config "AdditionalVersionWeights={}"
```

**전체 Lambda 한번에 롤백**:

```bash
FUNCTIONS=(github-connector slack-connector dashboard-api approval-api lightweight-worker notification-worker)
PREV_VERSION={VERSION_NUMBER}

for func in "${FUNCTIONS[@]}"; do
  aws lambda update-alias \
    --function-name aigo-$func \
    --name live \
    --function-version $PREV_VERSION \
    --routing-config "AdditionalVersionWeights={}"
  echo "Rolled back: $func"
done
```

## Agent 롤백 (AgentCore)

```bash
# 이전 버전 ZIP이 S3에 있음
# 이전 버전 배포
./scripts/deploy-agent.sh {agent-name} {prev-version}

# 또는 모든 Agent 롤백
for agent in orchestrator code-reviewer infra-reviewer risk-reviewer security-agent incident-agent fix-agent; do
  ./scripts/deploy-agent.sh $agent {prev-version}
done
```

## Dashboard 롤백 (S3 버전 복원)

```bash
# 이전 버전 목록 확인
aws s3api list-object-versions \
  --bucket aigo-frontend \
  --prefix "index.html" \
  --query "Versions[0:5].[VersionId,LastModified]"

# 이전 버전으로 복원
aws s3api copy-object \
  --copy-source "aigo-frontend/index.html?versionId={VERSION_ID}" \
  --bucket aigo-frontend \
  --key index.html

# CloudFront 캐시 무효화
aws cloudfront create-invalidation \
  --distribution-id {DIST_ID} \
  --paths "/*"
```

## 검증

```bash
# API 헬스체크
curl https://api.{domain}/health

# 버전 확인
curl https://api.{domain}/version
```
