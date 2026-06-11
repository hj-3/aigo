#!/usr/bin/env bash
# Deploy a Lambda function with canary alias routing and auto-rollback
# Usage: ./scripts/deploy-lambda.sh <package-name> <function-name>
set -euo pipefail

PACKAGE_NAME="$1"
FUNCTION_NAME="$2"
ALIAS_NAME="live"
CANARY_WEIGHT=0.1  # 10% canary traffic (AWS Lambda alias weight: 0.0–1.0)

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
NEW_VERSION=$(aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file "fileb://$ZIP_PATH" \
  --publish \
  --query 'Version' \
  --output text)

echo "✅ Published version: $NEW_VERSION"

# Get current stable version from alias
CURRENT_VERSION=$(aws lambda get-alias \
  --function-name "$FUNCTION_NAME" \
  --name "$ALIAS_NAME" \
  --query 'FunctionVersion' \
  --output text 2>/dev/null || echo "$NEW_VERSION")

# Skip canary if this is the first deployment (same version)
if [ "$CURRENT_VERSION" = "$NEW_VERSION" ]; then
  echo "✅ First deployment — promoting v$NEW_VERSION to 100% directly"
  aws lambda update-alias \
    --function-name "$FUNCTION_NAME" \
    --name "$ALIAS_NAME" \
    --function-version "$NEW_VERSION" \
    --routing-config '{"AdditionalVersionWeights":{}}'
  echo "🎉 Deployment complete: $FUNCTION_NAME → v$NEW_VERSION (100%)"
  exit 0
fi

echo "🔀 Starting canary deployment: v$CURRENT_VERSION → v$NEW_VERSION ($(echo "$CANARY_WEIGHT * 100" | bc)% new)"

# Update alias with canary routing (weight is a decimal 0.0–1.0)
aws lambda update-alias \
  --function-name "$FUNCTION_NAME" \
  --name "$ALIAS_NAME" \
  --function-version "$CURRENT_VERSION" \
  --routing-config "{\"AdditionalVersionWeights\":{\"$NEW_VERSION\":$CANARY_WEIGHT}}"

echo "⏱️  Monitoring for 60 seconds..."
sleep 60

# Check error rate during canary (alarm name matches Terraform: {name}-error-rate)
ALARM_STATE=$(aws cloudwatch describe-alarms \
  --alarm-names "${FUNCTION_NAME}-error-rate" \
  --query 'MetricAlarms[0].StateValue' \
  --output text 2>/dev/null || echo "OK")

if [ "$ALARM_STATE" = "ALARM" ]; then
  echo "🚨 Error rate exceeded threshold! Rolling back to v$CURRENT_VERSION..."
  aws lambda update-alias \
    --function-name "$FUNCTION_NAME" \
    --name "$ALIAS_NAME" \
    --function-version "$CURRENT_VERSION" \
    --routing-config '{"AdditionalVersionWeights":{}}'
  echo "✅ Rollback complete"
  exit 1
fi

echo "✅ Canary healthy. Promoting v$NEW_VERSION to 100%..."
aws lambda update-alias \
  --function-name "$FUNCTION_NAME" \
  --name "$ALIAS_NAME" \
  --function-version "$NEW_VERSION" \
  --routing-config '{"AdditionalVersionWeights":{}}'

echo "🎉 Deployment complete: $FUNCTION_NAME → v$NEW_VERSION (100%)"
