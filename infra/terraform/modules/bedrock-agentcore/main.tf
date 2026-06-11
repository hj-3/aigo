locals {
  p = var.project

  common_tags = merge(var.tags, {
    Project   = var.project
    ManagedBy = "terraform"
    Module    = "bedrock-agentcore"
  })

  agent_configs = {
    orchestrator   = "PR 분석 조율, 서브에이전트 병렬 호출, 최종 리포트 생성"
    code-reviewer  = "코드 품질, 버그 패턴, 테스트 커버리지 분석"
    infra-reviewer = "Terraform/IaC 보안·비용·HA 검토, AWS Well-Architected 기준 적용"
    risk-reviewer  = "코드·인프라·보안 결과 종합 리스크 점수 산정 및 머지 가능 여부 판단"
    security-agent = "OWASP Top 10, CWE, 시크릿 탐지, Prompt Injection 방어"
    incident-agent = "CloudWatch 알람 기반 장애 자동 조사 및 RCA 리포트 생성"
    fix-agent      = "승인된 발견사항에 대한 unified diff patch 생성 (실행 금지)"
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# IAM — Bedrock Agent service execution role
# Ref: https://docs.aws.amazon.com/bedrock/latest/userguide/agents-permissions.html
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_iam_role" "bedrock_agent" {
  name = "${local.p}-bedrock-agent-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = var.aws_account_id
        }
        ArnLike = {
          "aws:SourceArn" = "arn:aws:bedrock:${var.aws_region}:${var.aws_account_id}:agent/*"
        }
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "bedrock_agent" {
  name = "${local.p}-bedrock-agent-policy"
  role = aws_iam_role.bedrock_agent.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "InvokeModel"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream"
        ]
        Resource = [
          "arn:aws:bedrock:*::foundation-model/anthropic.claude-*",
          "arn:aws:bedrock:*::foundation-model/apac.*",
          "arn:aws:bedrock:${var.aws_region}:${var.aws_account_id}:inference-profile/*"
        ]
      },
      {
        Sid    = "RetrieveKB"
        Effect = "Allow"
        Action = [
          "bedrock:Retrieve",
          "bedrock:RetrieveAndGenerate",
          "bedrock:GetKnowledgeBase"
        ]
        Resource = length(var.knowledge_base_arns) > 0 ? var.knowledge_base_arns : ["arn:aws:bedrock:${var.aws_region}:${var.aws_account_id}:knowledge-base/*"]
      },
      {
        Sid      = "S3AgentPackages"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = [var.s3_agent_packages_arn, "${var.s3_agent_packages_arn}/*"]
      }
    ]
  })
}

# ──────────────────────────────────────────────────────────────────────────────
# Bedrock Agents (7 agents)
# Ref: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/bedrockagent_agent
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_bedrockagent_agent" "agents" {
  for_each = local.agent_configs

  agent_name                  = "${local.p}-${each.key}"
  description                 = each.value
  foundation_model            = var.foundation_model
  instruction                 = var.agent_instructions[each.key]
  agent_resource_role_arn     = aws_iam_role.bedrock_agent.arn
  idle_session_ttl_in_seconds = 600
  prepare_agent               = true

  memory_configuration {
    enabled_memory_types = ["SESSION_SUMMARY"]
    storage_days         = 30
  }

  tags = merge(local.common_tags, { AgentName = each.key })

  depends_on = [aws_iam_role_policy.bedrock_agent]
}

# ──────────────────────────────────────────────────────────────────────────────
# Agent Aliases — "live" alias per agent (deploy script updates version)
# Ref: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/bedrockagent_agent_alias
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_bedrockagent_agent_alias" "agents" {
  for_each = aws_bedrockagent_agent.agents

  agent_id         = each.value.agent_id
  agent_alias_name = "live"
  description      = "Production alias — updated by deploy-agent.sh"

  tags = merge(local.common_tags, { AgentName = each.key })
}

# ──────────────────────────────────────────────────────────────────────────────
# SSM Parameters — store IDs for deploy-agent.sh and application runtime
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_ssm_parameter" "agent_id" {
  for_each = aws_bedrockagent_agent.agents

  name        = "/${var.project}/agents/${each.key}/agent-id"
  description = "Bedrock Agent ID for ${each.key}"
  type        = "String"
  value       = each.value.agent_id
  key_id      = var.kms_key_arn
  tier        = "Standard"

  tags = local.common_tags
}

resource "aws_ssm_parameter" "agent_alias_id" {
  for_each = aws_bedrockagent_agent_alias.agents

  name        = "/${var.project}/agents/${each.key}/alias-id"
  description = "Bedrock Agent Alias ID for ${each.key}"
  type        = "String"
  value       = each.value.agent_alias_id
  key_id      = var.kms_key_arn
  tier        = "Standard"

  tags = local.common_tags
}

resource "aws_ssm_parameter" "agent_alias_arn" {
  for_each = aws_bedrockagent_agent_alias.agents

  name        = "/${var.project}/agents/${each.key}/alias-arn"
  description = "Bedrock Agent Alias ARN for ${each.key} (used by workers)"
  type        = "String"
  value       = each.value.agent_alias_arn
  key_id      = var.kms_key_arn
  tier        = "Standard"

  tags = local.common_tags
}
