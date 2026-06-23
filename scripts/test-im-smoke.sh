#!/usr/bin/env bash
# IM Smoke Test — validates AWS resources after deployment
# Usage: ./scripts/test-im-smoke.sh [--region ap-northeast-2]
# Exits 0 only if all checks pass.
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-northeast-2}"
PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}  ✅ $1${NC}"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}  ❌ $1${NC}"; FAIL=$((FAIL+1)); }
info() { echo -e "${YELLOW}  ℹ  $1${NC}"; }
section() { echo -e "\n${YELLOW}━━━ $1 ━━━${NC}"; }

# ── Lambda 함수 목록 ──────────────────────────────────────────────────────────
IM_FUNCTIONS=(
  aigo-im-api
  aigo-im-normalize-event
  aigo-im-webhook-receiver
  aigo-im-security-event
  aigo-im-poll-investigation
  aigo-im-supervisor-agent
  aigo-im-scope-agent
  aigo-im-summary-agent
  aigo-im-security-agent
  aigo-im-chat-agent
  aigo-im-action-executor
)

# ── DynamoDB 테이블 + 필수 GSI (실제 생성된 PascalCase 이름 기준) ──────────
declare -A DDB_GSIS
DDB_GSIS["aigo-im-Incidents"]="GSI1-orgId-status-index GSI2-account-detectedAt-index"
DDB_GSIS["aigo-im-InvestigationResults"]=""
DDB_GSIS["aigo-im-RecoveryActions"]="GSI1-orgId-incident-index"
DDB_GSIS["aigo-im-RemediationSettings"]=""
DDB_GSIS["aigo-im-LinkedAccounts"]=""
DDB_GSIS["aigo-im-ExternalIntegrations"]="GSI1-integrationId-index"
DDB_GSIS["aigo-im-InvestigationTargets"]="GSI1-account-alarmName-index"

# ── 필수 Lambda 환경변수 (실제 env var 키 기준) ───────────────────────────────
declare -A LAMBDA_ENVS
LAMBDA_ENVS["aigo-im-api"]="IM_INCIDENTS_TABLE IM_INVESTIGATION_TABLE IM_RECOVERY_ACTIONS_TABLE IM_SETTINGS_TABLE IM_LINKED_ACCOUNTS_TABLE IM_INTEGRATIONS_TABLE IM_TARGETS_TABLE IM_SFN_ARN IM_REPORTS_BUCKET"
LAMBDA_ENVS["aigo-im-normalize-event"]="IM_INCIDENTS_TABLE IM_TARGETS_TABLE IM_SFN_ARN"
LAMBDA_ENVS["aigo-im-scope-agent"]="IM_INVESTIGATION_TABLE"
LAMBDA_ENVS["aigo-im-summary-agent"]="IM_INCIDENTS_TABLE IM_REPORTS_BUCKET IM_SETTINGS_TABLE"
LAMBDA_ENVS["aigo-im-security-agent"]="IM_SECURITY_EVENTS_TABLE"
LAMBDA_ENVS["aigo-im-action-executor"]="IM_RECOVERY_ACTIONS_TABLE IM_SETTINGS_TABLE"
LAMBDA_ENVS["aigo-im-supervisor-agent"]="IM_INCIDENTS_TABLE IM_INVESTIGATION_TABLE"
LAMBDA_ENVS["aigo-im-poll-investigation"]="IM_INCIDENTS_TABLE IM_INVESTIGATION_TABLE"

echo ""
echo "╔═══════════════════════════════════════════════════╗"
echo "║       AIGO Incident Management — Smoke Test        ║"
echo "╚═══════════════════════════════════════════════════╝"
echo "  Region: $AWS_REGION"
echo "  Time:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ─────────────────────────────────────────────────────────────────────────────
section "1. Lambda Functions"
for fn in "${IM_FUNCTIONS[@]}"; do
  state=$(aws lambda get-function-configuration \
    --function-name "$fn" \
    --region "$AWS_REGION" \
    --query 'State' \
    --output text 2>/dev/null || echo "NOT_FOUND")

  if [[ "$state" == "Active" ]]; then
    ok "$fn — Active"
  elif [[ "$state" == "NOT_FOUND" ]]; then
    fail "$fn — NOT FOUND"
  else
    fail "$fn — state=$state"
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
section "2. Lambda Aliases (:live)"
for fn in "${IM_FUNCTIONS[@]}"; do
  ver=$(aws lambda get-alias \
    --function-name "$fn" \
    --name live \
    --region "$AWS_REGION" \
    --query 'FunctionVersion' \
    --output text 2>/dev/null || echo "NOT_FOUND")

  if [[ "$ver" != "NOT_FOUND" && "$ver" != "" ]]; then
    ok "$fn:live → v$ver"
  else
    fail "$fn:live — alias missing"
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
section "3. Lambda Environment Variables"
for fn in "${!LAMBDA_ENVS[@]}"; do
  required_vars="${LAMBDA_ENVS[$fn]}"
  env_json=$(aws lambda get-function-configuration \
    --function-name "$fn" \
    --region "$AWS_REGION" \
    --query 'Environment.Variables' \
    --output json 2>/dev/null || echo '{}')

  for var in $required_vars; do
    val=$(echo "$env_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$var','MISSING'))" 2>/dev/null || echo "MISSING")
    if [[ "$val" != "MISSING" && "$val" != "" ]]; then
      ok "$fn → $var"
    else
      fail "$fn → $var MISSING"
    fi
  done
done

# ─────────────────────────────────────────────────────────────────────────────
section "4. DynamoDB Tables & GSIs"
for table in "${!DDB_GSIS[@]}"; do
  table_status=$(aws dynamodb describe-table \
    --table-name "$table" \
    --region "$AWS_REGION" \
    --query 'Table.TableStatus' \
    --output text 2>/dev/null || echo "NOT_FOUND")

  if [[ "$table_status" == "ACTIVE" ]]; then
    ok "Table: $table — ACTIVE"
  else
    fail "Table: $table — $table_status"
    continue
  fi

  required_gsis="${DDB_GSIS[$table]}"
  if [[ -z "$required_gsis" ]]; then continue; fi

  actual_gsis=$(aws dynamodb describe-table \
    --table-name "$table" \
    --region "$AWS_REGION" \
    --query 'Table.GlobalSecondaryIndexes[].IndexName' \
    --output text 2>/dev/null || echo "")

  for gsi in $required_gsis; do
    if echo "$actual_gsis" | grep -q "$gsi"; then
      ok "  GSI: $gsi"
    else
      fail "  GSI: $gsi MISSING (actual: $actual_gsis)"
    fi
  done
done

# ─────────────────────────────────────────────────────────────────────────────
section "5. Step Functions"
SFN_ARN=$(aws stepfunctions list-state-machines \
  --region "$AWS_REGION" \
  --query "stateMachines[?contains(name, 'im-investigation')].stateMachineArn | [0]" \
  --output text 2>/dev/null || echo "None")

if [[ "$SFN_ARN" != "None" && "$SFN_ARN" != "" ]]; then
  ok "State machine found: $SFN_ARN"
  exec_count=$(aws stepfunctions list-executions \
    --state-machine-arn "$SFN_ARN" \
    --region "$AWS_REGION" \
    --query 'length(executions)' \
    --output text 2>/dev/null || echo "0")
  info "Total executions so far: $exec_count"
else
  fail "IM investigation state machine NOT FOUND"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "6. EventBridge Bus & Rules"
BUS_ARN=$(aws events describe-event-bus \
  --name aigo-im-event-bus \
  --region "$AWS_REGION" \
  --query 'Arn' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [[ "$BUS_ARN" != "NOT_FOUND" ]]; then
  ok "Event bus: aigo-im-event-bus"

  rule_count=$(aws events list-rules \
    --event-bus-name aigo-im-event-bus \
    --region "$AWS_REGION" \
    --query 'length(Rules)' \
    --output text 2>/dev/null || echo "0")
  info "Rules on IM bus: $rule_count"

  # normalize_event:live가 cloudwatch-alarm 규칙의 타겟인지 확인
  target_check=$(aws events list-targets-by-rule \
    --rule aigo-im-rule-cloudwatch-alarm \
    --event-bus-name aigo-im-event-bus \
    --region "$AWS_REGION" \
    --query "Targets[?contains(Arn, 'normalize-event')]" \
    --output text 2>/dev/null || echo "")
  if [[ -n "$target_check" ]]; then
    ok "normalize_event is target of aigo-im-rule-cloudwatch-alarm"
  else
    fail "normalize_event NOT wired to aigo-im-rule-cloudwatch-alarm"
  fi
else
  fail "Event bus: aigo-im-event-bus NOT FOUND"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "7. API Gateway"
API_ID=$(aws apigatewayv2 get-apis \
  --region "$AWS_REGION" \
  --query "Items[?Name=='aigo-im-api'].ApiId | [0]" \
  --output text 2>/dev/null || echo "None")

if [[ "$API_ID" != "None" && "$API_ID" != "" ]]; then
  ENDPOINT=$(aws apigatewayv2 get-api \
    --api-id "$API_ID" \
    --region "$AWS_REGION" \
    --query 'ApiEndpoint' \
    --output text 2>/dev/null || echo "")
  ok "API Gateway: $ENDPOINT"

  # 커스텀 도메인 확인
  domain_status=$(aws apigatewayv2 get-domain-name \
    --domain-name "im-api.seolphung.com" \
    --region "$AWS_REGION" \
    --query "DomainNameConfigurations[0].DomainNameStatus" \
    --output text 2>/dev/null || echo "NOT_FOUND")
  if [[ "$domain_status" == "AVAILABLE" ]]; then
    ok "Custom domain: im-api.seolphung.com — AVAILABLE"
  else
    fail "Custom domain: im-api.seolphung.com — $domain_status"
  fi
else
  fail "IM HTTP API NOT FOUND"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "8. Lambda Permissions (EventBridge → normalize_event:live)"
perm_check=$(aws lambda get-policy \
  --function-name aigo-im-normalize-event \
  --qualifier live \
  --region "$AWS_REGION" \
  --query 'Policy' \
  --output text 2>/dev/null | python3 -c "
import sys, json
policy = json.loads(sys.stdin.read())
stmts = policy.get('Statement', [])
eb_stmts = [s for s in stmts if 'events.amazonaws.com' in str(s.get('Principal', ''))]
print('FOUND' if eb_stmts else 'MISSING')
" 2>/dev/null || echo "MISSING")

if [[ "$perm_check" == "FOUND" ]]; then
  ok "EventBridge → normalize_event:live permission exists"
else
  fail "EventBridge → normalize_event:live permission MISSING"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "9. S3 Reports Bucket"
ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
REPORTS_BUCKET="aigo-im-reports-${ACCOUNT_ID}"

if aws s3api head-bucket --bucket "$REPORTS_BUCKET" >/dev/null 2>&1; then
  ok "Reports bucket: $REPORTS_BUCKET"
else
  fail "Reports bucket: $REPORTS_BUCKET NOT FOUND"
fi

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "╔═══════════════════════════════════════════════════╗"
echo "║                   SMOKE TEST RESULT                ║"
echo "╠═══════════════════════════════════════════════════╣"
printf  "║  %-18s %-28s ║\n" "PASSED:" "$PASS checks"
printf  "║  %-18s %-28s ║\n" "FAILED:" "$FAIL checks"
echo "╚═══════════════════════════════════════════════════╝"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}Some checks failed. Review the output above.${NC}"
  exit 1
else
  echo -e "${GREEN}All checks passed. IM stack is healthy.${NC}"
  exit 0
fi
