#!/usr/bin/env bash
# Deploy a Strands Agent to AWS Bedrock AgentCore
# Usage: ./scripts/deploy-agent.sh <agent-name>
# Example: ./scripts/deploy-agent.sh orchestrator
set -euo pipefail

AGENT_NAME="${1:-}"
if [ -z "$AGENT_NAME" ]; then
  echo "Usage: $0 <agent-name>" >&2
  echo "Available agents: orchestrator code-reviewer infra-reviewer risk-reviewer security-agent incident-agent fix-agent" >&2
  exit 1
fi

AGENT_DIR="agents/$AGENT_NAME"
if [ ! -d "$AGENT_DIR" ]; then
  echo "Agent directory not found: $AGENT_DIR" >&2
  exit 1
fi

AWS_REGION="${AWS_REGION:-ap-northeast-2}"
PROJECT="${PROJECT:-aigo}"
ALIAS_NAME="live"

echo "🤖 Deploying agent: $AGENT_NAME"

# Get the Bedrock Agent ID from SSM Parameter Store
AGENT_ID=$(aws ssm get-parameter \
  --name "/${PROJECT}/agents/${AGENT_NAME}/agent-id" \
  --query 'Parameter.Value' \
  --output text)

echo "📦 Packaging agent $AGENT_NAME..."

# Build agent package (uv pip compile + zip)
BUILD_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_DIR"' EXIT

# Install into build directory
uv pip install \
  --target "$BUILD_DIR/package" \
  -r "${AGENT_DIR}/pyproject.toml"

cp -r "${AGENT_DIR}/src" "$BUILD_DIR/package/"
cp -r tools/ "$BUILD_DIR/package/tools/"
cp -r libs/ "$BUILD_DIR/package/libs/"

# Create zip
cd "$BUILD_DIR/package" && zip -q -r "$BUILD_DIR/agent.zip" . && cd -

PACKAGE_SIZE=$(wc -c < "$BUILD_DIR/agent.zip")
echo "📊 Package size: $(( PACKAGE_SIZE / 1024 ))KB"

# Upload to S3
S3_KEY="agent-packages/${AGENT_NAME}/${AGENT_NAME}-$(date +%Y%m%d%H%M%S).zip"
S3_BUCKET="${PROJECT}-agent-packages"

aws s3 cp "$BUILD_DIR/agent.zip" "s3://${S3_BUCKET}/${S3_KEY}" \
  --sse aws:kms

echo "☁️  Package uploaded: s3://${S3_BUCKET}/${S3_KEY}"

# Read prompt and update agent instruction before preparing new version
PROMPT_CONTENT=$(cat "prompts/v1/${AGENT_NAME}.md")

echo "✏️  Updating agent instruction..."
aws bedrock-agent update-agent \
  --no-cli-pager \
  --agent-id "$AGENT_ID" \
  --agent-name "${PROJECT}-${AGENT_NAME}" \
  --instruction "$PROMPT_CONTENT" \
  --foundation-model "us.anthropic.claude-sonnet-4-6-20250514-v1:0" \
  --agent-resource-role-arn "$(aws iam get-role --role-name "${PROJECT}-bedrock-agent-role" --query 'Role.Arn' --output text)" \
  > /dev/null

# prepare-agent transitions DRAFT to PREPARED state
echo "🔄 Preparing agent..."
aws bedrock-agent prepare-agent \
  --no-cli-pager \
  --agent-id "$AGENT_ID" \
  > /dev/null

echo "⏳ Waiting for PREPARED state..."
for i in $(seq 1 30); do
  STATUS=$(aws bedrock-agent get-agent --agent-id "$AGENT_ID" \
    --query 'agent.agentStatus' --output text)
  echo "   status: $STATUS"
  [ "$STATUS" = "PREPARED" ] && break
  [ "$STATUS" = "FAILED" ] && { echo "❌ Agent preparation failed"; exit 1; }
  sleep 10
done

echo "✅ Agent DRAFT updated: $AGENT_NAME"
echo "   Alias routing is managed by Terraform (terraform apply to cut a new version)."
