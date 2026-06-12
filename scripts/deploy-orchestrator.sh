#!/usr/bin/env bash
# Build and deploy the Orchestrator Python Lambda
# Usage: ./scripts/deploy-orchestrator.sh [--skip-upload]
#
# Packages: agents/orchestrator/ + tools/ + Python deps
# Uploads to S3: s3://aigo-artifacts/lambda/orchestrator/latest.zip
# Updates Lambda function: aigo-orchestrator
set -euo pipefail

PROJECT="${PROJECT:-aigo}"
AWS_REGION="${AWS_REGION:-ap-northeast-2}"
FUNCTION_NAME="${FUNCTION_NAME:-${PROJECT}-orchestrator}"
S3_BUCKET="${PROJECT}-artifacts"
S3_KEY="lambda/orchestrator/latest.zip"
ALIAS_NAME="live"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${REPO_ROOT}/.build/orchestrator"
VENV_DIR="${BUILD_DIR}/venv"
ZIP_PATH="${BUILD_DIR}/orchestrator.zip"

echo "=== Building Orchestrator Lambda Package ==="
echo "Project: $PROJECT | Region: $AWS_REGION | Function: $FUNCTION_NAME"
echo ""

# ── 1. Clean and prepare build directory ─────────────────────────────────────
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/package"

# ── 2. Install Python dependencies into the package directory ────────────────
echo "📦 Installing Python dependencies..."
# Use uv if available, fall back to pip3/python3 -m pip
if command -v uv &>/dev/null; then
  UV="uv pip install"
  export VIRTUAL_ENV=""  # uv needs VIRTUAL_ENV unset for --target mode
  uv pip install \
    "strands-agents>=0.1.0" \
    "boto3>=1.35.0" \
    "pydantic>=2.9.0" \
    "structlog>=24.4.0" \
    "httpx>=0.27.0" \
    "PyJWT>=2.9.0" \
    "cryptography>=43.0.0" \
    "python-ulid>=2.0.0" \
    --target "$BUILD_DIR/package" \
    --quiet
elif command -v pip3 &>/dev/null; then
  pip3 install \
    "strands-agents>=0.1.0" \
    "boto3>=1.35.0" \
    "pydantic>=2.9.0" \
    "structlog>=24.4.0" \
    "httpx>=0.27.0" \
    "PyJWT>=2.9.0" \
    "cryptography>=43.0.0" \
    "python-ulid>=2.0.0" \
    --target "$BUILD_DIR/package" \
    --quiet
else
  python3 -m pip install \
    "strands-agents>=0.1.0" \
    "boto3>=1.35.0" \
    "pydantic>=2.9.0" \
    "structlog>=24.4.0" \
    "httpx>=0.27.0" \
    "PyJWT>=2.9.0" \
    "cryptography>=43.0.0" \
    "python-ulid>=2.0.0" \
    --target "$BUILD_DIR/package" \
    --quiet
fi

echo "✅ Dependencies installed"

# ── 3. Copy agent source code ─────────────────────────────────────────────────
echo "📂 Copying agent source..."
cp "$REPO_ROOT/agents/orchestrator/lambda_handler.py" "$BUILD_DIR/package/"
cp -r "$REPO_ROOT/agents/orchestrator/src" "$BUILD_DIR/package/"

# Copy tools directory (all .py files at top level — no subdirectory)
mkdir -p "$BUILD_DIR/package/tools"
cp "$REPO_ROOT/tools/"*.py "$BUILD_DIR/package/tools/"
# Also copy tools directly into package root so `from tools import X` and `import ddb_tools` both work
cp "$REPO_ROOT/tools/"*.py "$BUILD_DIR/package/"

# Copy the common library (BaseAgentConfig, require_env)
if [ -d "$REPO_ROOT/libs/common/src/common" ]; then
  mkdir -p "$BUILD_DIR/package/common"
  cp "$REPO_ROOT/libs/common/src/common/"*.py "$BUILD_DIR/package/common/"
fi

echo "✅ Source copied"

# ── 4. Create ZIP archive ──────────────────────────────────────────────────────
echo "🗜️  Creating ZIP archive..."
cd "$BUILD_DIR/package"
# Keep *.dist-info/ — opentelemetry and other packages need entry_points.txt
zip -r "$ZIP_PATH" . -x "*.pyc" -x "*/__pycache__/*" -q
cd - > /dev/null
echo "✅ ZIP created: $ZIP_PATH ($(du -h "$ZIP_PATH" | cut -f1))"

# ── 5. Upload to S3 ───────────────────────────────────────────────────────────
if [[ "${1:-}" != "--skip-upload" ]]; then
  echo "☁️  Uploading to s3://$S3_BUCKET/$S3_KEY..."
  aws s3 cp "$ZIP_PATH" "s3://$S3_BUCKET/$S3_KEY" \
    --region "$AWS_REGION" \
    --no-progress
  echo "✅ Uploaded to S3"

  # ── 6. Update Lambda function code ─────────────────────────────────────────
  echo "🚀 Updating Lambda function code: $FUNCTION_NAME..."
  NEW_VERSION=$(aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --s3-bucket "$S3_BUCKET" \
    --s3-key "$S3_KEY" \
    --publish \
    --region "$AWS_REGION" \
    --query 'Version' \
    --output text)
  echo "✅ Published version: $NEW_VERSION"

  # ── 7. Promote alias directly (orchestrator is internal; no canary needed) ──
  echo "🏷️  Updating alias '$ALIAS_NAME' → v$NEW_VERSION..."
  aws lambda update-alias \
    --function-name "$FUNCTION_NAME" \
    --name "$ALIAS_NAME" \
    --function-version "$NEW_VERSION" \
    --routing-config '{"AdditionalVersionWeights":{}}' \
    --region "$AWS_REGION" \
    --no-cli-pager

  echo ""
  echo "🎉 Deployment complete: $FUNCTION_NAME:$ALIAS_NAME → v$NEW_VERSION"
else
  echo "⏭️  Skipping upload (--skip-upload)"
  echo "ZIP ready at: $ZIP_PATH"
fi
