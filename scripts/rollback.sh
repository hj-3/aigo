#!/usr/bin/env bash
# Manual rollback script for Lambda functions
# Usage: ./scripts/rollback.sh <function-name> [version]
set -euo pipefail

FUNCTION_NAME="${1:-}"
TARGET_VERSION="${2:-}"
ALIAS_NAME="live"

if [ -z "$FUNCTION_NAME" ]; then
  echo "Usage: $0 <function-name> [version]" >&2
  exit 1
fi

if [ -z "$TARGET_VERSION" ]; then
  # Find the previous version from alias routing config
  CURRENT_VERSION=$(aws lambda get-alias \
    --function-name "$FUNCTION_NAME" \
    --name "$ALIAS_NAME" \
    --query 'FunctionVersion' \
    --output text)

  PREVIOUS_VERSION=$((CURRENT_VERSION - 1))
  if [ "$PREVIOUS_VERSION" -lt 1 ]; then
    echo "No previous version available" >&2
    exit 1
  fi
  TARGET_VERSION="$PREVIOUS_VERSION"
fi

echo "⏪ Rolling back $FUNCTION_NAME to v$TARGET_VERSION..."
aws lambda update-alias \
  --function-name "$FUNCTION_NAME" \
  --name "$ALIAS_NAME" \
  --function-version "$TARGET_VERSION" \
  --routing-config '{}'

echo "✅ Rollback complete: $FUNCTION_NAME → v$TARGET_VERSION"
