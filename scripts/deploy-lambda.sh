#!/usr/bin/env bash
# Deploy a Lambda function with canary alias routing and auto-rollback
# Usage: ./scripts/deploy-lambda.sh <package-name> <function-name>
set -euo pipefail

PACKAGE_NAME="$1"
FUNCTION_NAME="$2"
ALIAS_NAME="live"
ERROR_RATE_THRESHOLD=5  # Auto-rollback if error rate > 5%
CANARY_WEIGHT=10        # Start at 10% traffic

# Determine bundle path based on package location
if [[ "$PACKAGE_NAME" == connector-* ]]; then
  BUNDLE_PATH="connectors/${PACKAGE_NAME#connector-}/dist/index.js"
elif [[ "$PACKAGE_NAME" == "worker-lightweight" ]]; then
  BUNDLE_PATH="workers/lightweight/dist/index.js"
elif [[ "$PACKAGE_NAME" == "dashboard-api" ]]; then
  BUNDLE_PATH="apps/dashboard-api/dist/index.js"
else
  echo "Unknown package: $PACKAGE_NAME" >&2
  exit 1
fi

echo "📦 Packaging $PACKAGE_NAME from $BUNDLE_PATH..."
cd "$(dirname "$BUNDLE_PATH")" && zip -q deployment.zip "$(basename "$BUNDLE_PATH")"
cd - > /dev/null

ZIP_PATH="$(dirname "$BUNDLE_PATH")/deployment.zip"

echo "🚀 Updating Lambda function code: $FUNCTION_NAME"
PUBLISH_OUTPUT=$(aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file "fileb://$ZIP_PATH" \
  --publish \
  --query 'Version' \
  --output text)

NEW_VERSION="$PUBLISH_OUTPUT"
echo "✅ Published version: $NEW_VERSION"

# Get current stable version from alias
CURRENT_VERSION=$(aws lambda get-alias \
  --function-name "$FUNCTION_NAME" \
  --name "$ALIAS_NAME" \
  --query 'FunctionVersion' \
  --output text 2>/dev/null || echo "$NEW_VERSION")

echo "🔀 Starting canary deployment: v$CURRENT_VERSION → v$NEW_VERSION ($CANARY_WEIGHT% new)"

# Update alias with canary routing
aws lambda update-alias \
  --function-name "$FUNCTION_NAME" \
  --name "$ALIAS_NAME" \
  --function-version "$CURRENT_VERSION" \
  --routing-config "AdditionalVersionWeights={\"$NEW_VERSION\"=$CANARY_WEIGHT}"

echo "⏱️  Monitoring for 60 seconds..."
sleep 60

# Check error rate during canary
ALARM_STATE=$(aws cloudwatch describe-alarms \
  --alarm-names "${FUNCTION_NAME}-error-rate-alarm" \
  --query 'MetricAlarms[0].StateValue' \
  --output text 2>/dev/null || echo "OK")

if [ "$ALARM_STATE" = "ALARM" ]; then
  echo "🚨 Error rate exceeded threshold! Rolling back to v$CURRENT_VERSION..."
  aws lambda update-alias \
    --function-name "$FUNCTION_NAME" \
    --name "$ALIAS_NAME" \
    --function-version "$CURRENT_VERSION" \
    --routing-config '{}'
  echo "✅ Rollback complete"
  exit 1
fi

echo "✅ Canary healthy. Promoting v$NEW_VERSION to 100%..."
aws lambda update-alias \
  --function-name "$FUNCTION_NAME" \
  --name "$ALIAS_NAME" \
  --function-version "$NEW_VERSION" \
  --routing-config '{}'

echo "🎉 Deployment complete: $FUNCTION_NAME → v$NEW_VERSION (100%)"
