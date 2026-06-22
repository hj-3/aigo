#!/usr/bin/env bash
# Build and deploy an IM Python Lambda function
# Usage: ./scripts/deploy-im-lambda.sh <src-dir> <function-name>
#
# <src-dir>       relative path to the Lambda source (e.g. agents/im-supervisor)
# <function-name> AWS Lambda function name (e.g. aigo-im-supervisor-agent)
#
# Uploads to: s3://aigo-artifacts/lambda/<function-name>/latest.zip
# Updates Lambda + promotes alias to 100% (no canary — internal invocation)
set -euo pipefail

SRC_DIR="$1"
FUNCTION_NAME="$2"

PROJECT="${PROJECT:-aigo}"
AWS_REGION="${AWS_REGION:-ap-northeast-2}"
S3_BUCKET="${PROJECT}-artifacts"
S3_KEY="lambda/${FUNCTION_NAME}/latest.zip"
ALIAS_NAME="live"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${REPO_ROOT}/.build/${FUNCTION_NAME}"
ZIP_PATH="${BUILD_DIR}/${FUNCTION_NAME}.zip"

echo "=== Building IM Lambda: ${FUNCTION_NAME} ==="
echo "Source: ${SRC_DIR} | Region: ${AWS_REGION}"

# ── 1. Clean build directory ──────────────────────────────────────────────────
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/package"

# ── 2. Install Python dependencies ───────────────────────────────────────────
echo "📦 Installing dependencies..."

# Detect whether this is an agent (needs strands) or a worker
if [[ "$SRC_DIR" == agents/* ]]; then
  EXTRA_DEPS="strands-agents>=0.1.0"
else
  EXTRA_DEPS=""
fi

if command -v uv &>/dev/null; then
  uv pip install \
    "boto3>=1.35.0" \
    "pydantic>=2.9.0" \
    "structlog>=24.4.0" \
    "python-ulid>=2.0.0" \
    ${EXTRA_DEPS:+"$EXTRA_DEPS"} \
    --target "$BUILD_DIR/package" \
    --quiet
else
  pip3 install \
    "boto3>=1.35.0" \
    "pydantic>=2.9.0" \
    "structlog>=24.4.0" \
    "python-ulid>=2.0.0" \
    ${EXTRA_DEPS:+"$EXTRA_DEPS"} \
    --target "$BUILD_DIR/package" \
    --quiet
fi
echo "✅ Dependencies installed"

# ── 3. Copy source code ───────────────────────────────────────────────────────
echo "📂 Copying source..."
cp "${REPO_ROOT}/${SRC_DIR}/lambda_handler.py" "$BUILD_DIR/package/handler.py"
cp -r "${REPO_ROOT}/${SRC_DIR}/src" "$BUILD_DIR/package/"
echo "✅ Source copied"

# ── 4. Create ZIP ─────────────────────────────────────────────────────────────
echo "🗜️  Creating ZIP..."
cd "$BUILD_DIR/package"
zip -r "$ZIP_PATH" . -x "*.pyc" -x "*/__pycache__/*" -q
cd - > /dev/null
echo "✅ ZIP created: $ZIP_PATH ($(du -h "$ZIP_PATH" | cut -f1))"

# ── 5. Upload to S3 ───────────────────────────────────────────────────────────
echo "☁️  Uploading to s3://${S3_BUCKET}/${S3_KEY}..."
aws s3 cp "$ZIP_PATH" "s3://${S3_BUCKET}/${S3_KEY}" \
  --region "$AWS_REGION" \
  --no-progress
echo "✅ Uploaded"

# ── 6. Update Lambda function code ───────────────────────────────────────────
echo "🚀 Updating Lambda: ${FUNCTION_NAME}..."
NEW_VERSION=$(aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --s3-bucket "$S3_BUCKET" \
  --s3-key "$S3_KEY" \
  --publish \
  --region "$AWS_REGION" \
  --query 'Version' \
  --output text)
echo "✅ Published version: ${NEW_VERSION}"

# ── 7. Promote alias ─────────────────────────────────────────────────────────
echo "🏷️  Promoting alias '${ALIAS_NAME}' → v${NEW_VERSION}..."
aws lambda update-alias \
  --function-name "$FUNCTION_NAME" \
  --name "$ALIAS_NAME" \
  --function-version "$NEW_VERSION" \
  --routing-config '{"AdditionalVersionWeights":{}}' \
  --region "$AWS_REGION" \
  --no-cli-pager

echo ""
echo "🎉 Done: ${FUNCTION_NAME}:${ALIAS_NAME} → v${NEW_VERSION}"
