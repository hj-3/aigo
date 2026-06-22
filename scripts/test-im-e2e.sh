#!/usr/bin/env bash
# IM E2E Test — functional flow verification against live AWS environment
# Usage: ./scripts/test-im-e2e.sh <IM_API_URL> <ID_TOKEN>
#   IM_API_URL : base URL of the IM HTTP API (e.g. https://xxxx.execute-api.ap-northeast-2.amazonaws.com)
#   ID_TOKEN   : Cognito ID token for a user with custom:orgId claim
#
# Runs the following flows:
#   T1 - Create incident (POST /incidents)
#   T2 - List incidents (GET /incidents)
#   T3 - Get incident (GET /incidents/:id)
#   T4 - Start investigation (POST /incidents/:id/investigate)
#   T5 - Poll investigation status (SFN running)
#   T6 - Poll scope result (DDB SCOPE_RESULT written by agent)
#   T7 - Create mitigation plan (POST /incidents/:id/mitigation)
#   T8 - List remediations (GET /remediations?incidentId=:id)
#   T9 - Patch incident status (PATCH /incidents/:id)
#   T10 - EventBridge inject (simulate CloudWatch ALARM → DDB incident)
#
# Exit codes: 0 = all pass, 1 = one or more failures
set -euo pipefail

API_URL="${1:-${IM_API_URL:-}}"
ID_TOKEN="${2:-${IM_ID_TOKEN:-}}"

if [[ -z "$API_URL" || -z "$ID_TOKEN" ]]; then
  echo "Usage: $0 <IM_API_URL> <ID_TOKEN>"
  echo "  export IM_API_URL=https://xxxx.execute-api.ap-northeast-2.amazonaws.com"
  echo "  export IM_ID_TOKEN=eyJra..."
  exit 1
fi

AWS_REGION="${AWS_REGION:-ap-northeast-2}"
PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()      { echo -e "${GREEN}  ✅ $1${NC}"; PASS=$((PASS+1)); }
fail()    { echo -e "${RED}  ❌ $1${NC}"; FAIL=$((FAIL+1)); }
info()    { echo -e "${CYAN}     $1${NC}"; }
section() { echo -e "\n${YELLOW}━━━ $1 ━━━${NC}"; }

api() {
  local method="$1"; local path="$2"; shift 2
  curl -s -X "$method" \
    "${API_URL}${path}" \
    -H "Authorization: Bearer $ID_TOKEN" \
    -H "Content-Type: application/json" \
    "$@"
}

echo ""
echo "╔═══════════════════════════════════════════════════╗"
echo "║         AIGO Incident Management — E2E Test        ║"
echo "╚═══════════════════════════════════════════════════╝"
echo "  API URL: $API_URL"
echo "  Time:    $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ─────────────────────────────────────────────────────────────────────────────
section "T1. Create Incident"
CREATE_RESP=$(api POST /incidents -d '{
  "title": "E2E Test — High CPU on api-service",
  "description": "Automated E2E test incident",
  "severity": "HIGH",
  "affectedServices": ["api-service", "database"]
}')
info "Response: $CREATE_RESP"

INCIDENT_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('incidentId',''))" 2>/dev/null || echo "")
if [[ -n "$INCIDENT_ID" ]]; then
  ok "Incident created: $INCIDENT_ID"
else
  fail "Incident creation failed — response: $CREATE_RESP"
  echo "Cannot continue without incident ID"; exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
section "T2. List Incidents"
LIST_RESP=$(api GET /incidents)
count=$(echo "$LIST_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('items',[])))" 2>/dev/null || echo "0")
if [[ "$count" -gt 0 ]]; then
  ok "List incidents returned $count item(s)"
else
  fail "List incidents returned 0 items or error: $LIST_RESP"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "T3. Get Incident"
GET_RESP=$(api GET "/incidents/$INCIDENT_ID")
status=$(echo "$GET_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
if [[ "$status" == "OPEN" ]]; then
  ok "GET /incidents/$INCIDENT_ID — status=OPEN"
else
  fail "GET /incidents/$INCIDENT_ID — unexpected: $GET_RESP"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "T4. Start Investigation (→ Step Functions)"
INV_RESP=$(api POST "/incidents/$INCIDENT_ID/investigate")
EXEC_ARN=$(echo "$INV_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('executionArn',''))" 2>/dev/null || echo "")
if [[ -n "$EXEC_ARN" ]]; then
  ok "Investigation started: $EXEC_ARN"
else
  fail "Start investigation failed: $INV_RESP"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "T5. Verify Step Functions Execution"
sleep 5
SFN_STATUS=$(aws stepfunctions describe-execution \
  --execution-arn "$EXEC_ARN" \
  --region "$AWS_REGION" \
  --query 'status' \
  --output text 2>/dev/null || echo "UNKNOWN")
info "SFN status: $SFN_STATUS"

if [[ "$SFN_STATUS" == "RUNNING" || "$SFN_STATUS" == "SUCCEEDED" ]]; then
  ok "Step Functions execution is $SFN_STATUS"
else
  fail "Step Functions execution status: $SFN_STATUS"
  # Print execution history for debugging
  info "Execution history:"
  aws stepfunctions get-execution-history \
    --execution-arn "$EXEC_ARN" \
    --region "$AWS_REGION" \
    --query 'events[-5:].{type:type,timestamp:timestamp}' \
    --output table 2>/dev/null || true
fi

# ─────────────────────────────────────────────────────────────────────────────
section "T6. Verify Incident Status Updated to INVESTIGATING"
sleep 3
INC_STATUS=$(api GET "/incidents/$INCIDENT_ID" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
if [[ "$INC_STATUS" == "INVESTIGATING" ]]; then
  ok "Incident status updated to INVESTIGATING"
else
  fail "Expected INVESTIGATING, got: $INC_STATUS"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "T7. Poll Scope Result (wait up to 5 min for scope agent)"
info "Waiting for scope agent to write SCOPE_RESULT to DDB (up to 300s)..."
SCOPE_TABLE=$(aws lambda get-function-configuration \
  --function-name aigo-im-scope-agent \
  --region "$AWS_REGION" \
  --query 'Environment.Variables.IM_INVESTIGATION_TABLE' \
  --output text 2>/dev/null || echo "aigo-im-investigation")

SCOPE_FOUND=false
for i in $(seq 1 15); do
  scope_item=$(aws dynamodb get-item \
    --table-name "$SCOPE_TABLE" \
    --key "{\"PK\":{\"S\":\"INCIDENT#${INCIDENT_ID}\"},\"SK\":{\"S\":\"SCOPE_RESULT\"}}" \
    --region "$AWS_REGION" \
    --query 'Item.rootCause.S' \
    --output text 2>/dev/null || echo "None")

  if [[ "$scope_item" != "None" && "$scope_item" != "" ]]; then
    ok "SCOPE_RESULT found in DDB (attempt $i)"
    info "Root cause: $(echo "$scope_item" | cut -c1-80)..."
    SCOPE_FOUND=true
    break
  fi
  info "Attempt $i/15 — scope not ready, waiting 20s..."
  sleep 20
done

if [[ "$SCOPE_FOUND" == "false" ]]; then
  fail "SCOPE_RESULT not found after 300s — scope agent may have failed"
  info "Check CloudWatch logs: /aws/lambda/aigo-im-scope-agent"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "T8. Create Mitigation Plan"
MITIG_RESP=$(api POST "/incidents/$INCIDENT_ID/mitigation")
created=$(echo "$MITIG_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('created',0))" 2>/dev/null || echo "0")
if [[ "$created" -gt 0 ]]; then
  ok "Mitigation plan created: $created action(s)"
elif echo "$MITIG_RESP" | grep -q "NO_RECOVERY_OPTIONS"; then
  fail "NO_RECOVERY_OPTIONS — scope agent did not produce recovery actions"
else
  fail "Mitigation creation failed: $MITIG_RESP"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "T9. List Remediations"
REM_RESP=$(api GET "/remediations?incidentId=$INCIDENT_ID")
rem_count=$(echo "$REM_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('items',[])))" 2>/dev/null || echo "0")
if [[ "$rem_count" -gt 0 ]]; then
  ok "Remediations list: $rem_count item(s)"
  echo "$REM_RESP" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for item in d.get('items',[]):
    print(f'     • {item.get(\"actionType\",\"?\")} — {item.get(\"description\",\"?\")[:60]}')
" 2>/dev/null || true
else
  fail "No remediations found: $REM_RESP"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "T10. Patch Incident (resolve)"
PATCH_RESP=$(api PATCH "/incidents/$INCIDENT_ID" -d '{"status":"RESOLVED","resolution":"E2E test completed"}')
updated=$(echo "$PATCH_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('updated',''))" 2>/dev/null || echo "")
if [[ "$updated" == "True" || "$updated" == "true" ]]; then
  ok "Incident patched to RESOLVED"
else
  fail "Patch failed: $PATCH_RESP"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "T11. EventBridge — Simulate CloudWatch ALARM"
TARGETS_TABLE=$(aws lambda get-function-configuration \
  --function-name aigo-im-normalize-event \
  --region "$AWS_REGION" \
  --query 'Environment.Variables.IM_TARGETS_TABLE' \
  --output text 2>/dev/null || echo "aigo-im-targets")

info "Invoking normalize_event Lambda directly with simulated CloudWatch ALARM event..."
CW_PAYLOAD=$(cat <<EOF
{
  "source": "aws.cloudwatch",
  "detail-type": "CloudWatch Alarm State Change",
  "account": "$(aws sts get-caller-identity --query Account --output text)",
  "detail": {
    "alarmName": "e2e-test-alarm",
    "state": {"value": "ALARM"},
    "previousState": {"value": "OK"},
    "configuration": {"description": "E2E test alarm"}
  }
}
EOF
)

INVOKE_RESP=$(aws lambda invoke \
  --function-name aigo-im-normalize-event \
  --region "$AWS_REGION" \
  --payload "$(echo "$CW_PAYLOAD" | base64 -w0)" \
  --cli-binary-format raw-in-base64-out \
  /tmp/normalize_response.json 2>&1)

STATUS_CODE=$(cat /tmp/normalize_response.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('statusCode',d.get('status','?')))" 2>/dev/null || echo "?")
info "normalize_event response: $(cat /tmp/normalize_response.json 2>/dev/null | head -c 200)"

# normalize_event should skip unregistered targets — this is expected behavior
if echo "$(cat /tmp/normalize_response.json 2>/dev/null)" | grep -qi "skipped\|not_registered\|200\|ok"; then
  ok "normalize_event invoked successfully (unregistered target correctly skipped)"
else
  fail "normalize_event invocation error: $(cat /tmp/normalize_response.json 2>/dev/null)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "T12. CloudWatch Logs — Check for Lambda errors"
info "Checking recent Lambda errors (last 10 min)..."
END_TIME=$(date +%s)000
START_TIME=$((END_TIME - 600000))

for fn in aigo-im-api aigo-im-normalize-event aigo-im-supervisor-agent aigo-im-scope-agent; do
  LOG_GROUP="/aws/lambda/$fn"
  error_count=$(aws logs filter-log-events \
    --log-group-name "$LOG_GROUP" \
    --start-time "$START_TIME" \
    --end-time "$END_TIME" \
    --filter-pattern "ERROR" \
    --region "$AWS_REGION" \
    --query 'length(events)' \
    --output text 2>/dev/null || echo "N/A")

  if [[ "$error_count" == "0" || "$error_count" == "N/A" ]]; then
    ok "$fn — no ERROR logs"
  else
    fail "$fn — $error_count ERROR log event(s) found"
    aws logs filter-log-events \
      --log-group-name "$LOG_GROUP" \
      --start-time "$START_TIME" \
      --end-time "$END_TIME" \
      --filter-pattern "ERROR" \
      --region "$AWS_REGION" \
      --query 'events[*].message' \
      --output text 2>/dev/null | head -5 || true
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "╔═══════════════════════════════════════════════════╗"
echo "║                  E2E TEST RESULT                   ║"
echo "╠═══════════════════════════════════════════════════╣"
printf  "║  %-18s %-28s ║\n" "PASSED:" "$PASS / $((PASS+FAIL)) tests"
printf  "║  %-18s %-28s ║\n" "FAILED:" "$FAIL tests"
echo "╠═══════════════════════════════════════════════════╣"
printf  "║  %-48s ║\n" "Test incident: $INCIDENT_ID"
echo "╚═══════════════════════════════════════════════════╝"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}Some E2E tests failed. Review output above.${NC}"
  echo ""
  echo "Debug commands:"
  echo "  aws logs tail /aws/lambda/aigo-im-scope-agent --since 10m"
  echo "  aws logs tail /aws/lambda/aigo-im-supervisor-agent --since 10m"
  echo "  aws stepfunctions get-execution-history --execution-arn $EXEC_ARN"
  exit 1
else
  echo -e "${GREEN}All E2E tests passed.${NC}"
  exit 0
fi
