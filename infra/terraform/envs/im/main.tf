data "aws_caller_identity" "current" {}

locals {
  account_id = var.aws_account_id != "" ? var.aws_account_id : data.aws_caller_identity.current.account_id

  common_tags = {
    Project     = "aigo"
    Product     = "IncidentManagement"
    Environment = "prod"
    ManagedBy   = "terraform"
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# Data Sources — reference existing CM infrastructure (no duplication)
# ──────────────────────────────────────────────────────────────────────────────

data "aws_vpc" "main" {
  tags = { Project = "aigo", Environment = "prod", ManagedBy = "terraform" }
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.main.id]
  }
  filter {
    name   = "tag:Tier"
    values = ["private"]
  }
}

data "aws_security_group" "lambda" {
  name   = "aigo-lambda-sg"
  vpc_id = data.aws_vpc.main.id
}

# KMS — reuse existing CM keys
data "aws_kms_alias" "lambda" {
  name = "alias/aigo-lambda"
}

data "aws_kms_alias" "dynamodb" {
  name = "alias/aigo-dynamodb"
}

data "aws_kms_alias" "s3" {
  name = "alias/aigo-s3"
}

# S3 — Lambda code stored in existing artifacts bucket
data "aws_s3_bucket" "artifacts" {
  bucket = "aigo-artifacts"
}

# Cognito — for API Gateway JWT authorizer
data "aws_cognito_user_pools" "main" {
  name = "aigo-user-pool"
}

# Route53 — add im-api record to existing zone
data "aws_route53_zone" "main" {
  name         = "seolphung.com."
  private_zone = false
}

# ACM — *.seolphung.com wildcard covers im-api.seolphung.com
data "aws_acm_certificate" "regional" {
  domain      = "seolphung.com"
  statuses    = ["ISSUED"]
  most_recent = true
}

# SES — noreply@seolphung.com for incident reports
data "aws_ses_domain_identity" "main" {
  domain = "seolphung.com"
}

# ──────────────────────────────────────────────────────────────────────────────
# DynamoDB — IM tables (aigo-im-* namespace)
# ──────────────────────────────────────────────────────────────────────────────
module "im_dynamodb" {
  source      = "../../modules/im-dynamodb"
  kms_key_arn = data.aws_kms_alias.dynamodb.target_key_arn
  tags        = local.common_tags
}

# ──────────────────────────────────────────────────────────────────────────────
# S3 — IM reports bucket (장애보고서 전용)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_s3_bucket" "im_reports" {
  bucket = "aigo-im-reports-${local.account_id}"
  tags   = merge(local.common_tags, { Name = "aigo-im-reports" })
}

resource "aws_s3_bucket_public_access_block" "im_reports" {
  bucket                  = aws_s3_bucket.im_reports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "im_reports" {
  bucket = aws_s3_bucket.im_reports.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = data.aws_kms_alias.s3.target_key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "im_reports" {
  bucket     = aws_s3_bucket.im_reports.id
  depends_on = [aws_s3_bucket_server_side_encryption_configuration.im_reports]

  rule {
    id     = "expire-old-reports"
    status = "Enabled"
    filter {}
    expiration { days = 365 }
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# IAM — Lambda execution roles (one per function, least privilege)
# ──────────────────────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# Common inline policy: VPC networking + CloudWatch Logs + X-Ray
data "aws_iam_policy_document" "lambda_base" {
  statement {
    sid    = "VPC"
    effect = "Allow"
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface",
    ]
    resources = ["*"]
  }
  statement {
    sid    = "Logs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:/aws/lambda/aigo-im-*"]
  }
  statement {
    sid       = "XRay"
    effect    = "Allow"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }
  statement {
    sid    = "KMSDecrypt"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey",
    ]
    resources = [
      data.aws_kms_alias.lambda.target_key_arn,
      data.aws_kms_alias.dynamodb.target_key_arn,
      data.aws_kms_alias.s3.target_key_arn,
    ]
  }
}

# DDB access policy (used by most IM lambdas)
data "aws_iam_policy_document" "im_ddb_read_write" {
  statement {
    sid    = "DDBReadWrite"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
      "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan",
      "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem",
    ]
    resources = [
      "arn:aws:dynamodb:${var.aws_region}:${local.account_id}:table/aigo-im-*",
    ]
  }
}

# Bedrock access (IM agents only)
data "aws_iam_policy_document" "im_bedrock" {
  statement {
    sid    = "BedrockInvoke"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = [
      "arn:aws:bedrock:*::foundation-model/anthropic.claude-*",
      "arn:aws:bedrock:${var.aws_region}:${local.account_id}:inference-profile/*",
    ]
  }
}

# Helper: merge base + extra policies into one role
resource "aws_iam_role" "im_api" {
  name               = "aigo-im-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.common_tags

  inline_policy {
    name   = "base"
    policy = data.aws_iam_policy_document.lambda_base.json
  }
  inline_policy {
    name   = "ddb"
    policy = data.aws_iam_policy_document.im_ddb_read_write.json
  }
  inline_policy {
    name = "sfn-start"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "SFNStart"
        Effect   = "Allow"
        Action   = ["states:StartExecution"]
        Resource = aws_sfn_state_machine.investigation.arn
      }]
    })
  }
  inline_policy {
    name = "invoke-chat-agent"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "InvokeChatAgent"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = "arn:aws:lambda:${var.aws_region}:${local.account_id}:function:aigo-im-chat-agent*"
      }]
    })
  }
  inline_policy {
    name = "s3-reports-read"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "S3ReportsRead"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.im_reports.arn}/*"
      }]
    })
  }
  inline_policy {
    name = "invoke-action-executor"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "InvokeActionExecutor"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = "arn:aws:lambda:${var.aws_region}:${local.account_id}:function:aigo-im-action-executor*"
      }]
    })
  }
  inline_policy {
    name = "cloudwatch-read"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "CloudWatchRead"
        Effect   = "Allow"
        Action   = ["cloudwatch:DescribeAlarms", "cloudwatch:GetMetricStatistics"]
        Resource = "*"
      }]
    })
  }
  inline_policy {
    name = "sts-assume-linked"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "AssumeLinkedAccountRole"
        Effect   = "Allow"
        Action   = ["sts:AssumeRole"]
        Resource = "arn:aws:iam::*:role/aigo-im-cross-account-role"
      }]
    })
  }
}

resource "aws_iam_role" "im_normalize_event" {
  name               = "aigo-im-normalize-event-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.common_tags

  inline_policy {
    name   = "base"
    policy = data.aws_iam_policy_document.lambda_base.json
  }
  inline_policy {
    name   = "ddb"
    policy = data.aws_iam_policy_document.im_ddb_read_write.json
  }
  inline_policy {
    name = "sfn-start"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "SFNStart"
        Effect   = "Allow"
        Action   = ["states:StartExecution"]
        Resource = aws_sfn_state_machine.investigation.arn
      }]
    })
  }
}

resource "aws_iam_role" "im_webhook_receiver" {
  name               = "aigo-im-webhook-receiver-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.common_tags

  inline_policy {
    name   = "base"
    policy = data.aws_iam_policy_document.lambda_base.json
  }
  inline_policy {
    name   = "ddb"
    policy = data.aws_iam_policy_document.im_ddb_read_write.json
  }
  inline_policy {
    name = "sfn-start"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "SFNStart"
        Effect   = "Allow"
        Action   = ["states:StartExecution"]
        Resource = aws_sfn_state_machine.investigation.arn
      }]
    })
  }
}

resource "aws_iam_role" "im_security_event" {
  name               = "aigo-im-security-event-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.common_tags

  inline_policy {
    name   = "base"
    policy = data.aws_iam_policy_document.lambda_base.json
  }
  inline_policy {
    name   = "ddb"
    policy = data.aws_iam_policy_document.im_ddb_read_write.json
  }
  inline_policy {
    name = "invoke-security-agent"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "InvokeSecurityAgent"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = "arn:aws:lambda:${var.aws_region}:${local.account_id}:function:aigo-im-security-agent*"
      }]
    })
  }
}

resource "aws_iam_role" "im_poll_investigation" {
  name               = "aigo-im-poll-investigation-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.common_tags

  inline_policy {
    name   = "base"
    policy = data.aws_iam_policy_document.lambda_base.json
  }
  inline_policy {
    name = "ddb-update-incidents"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "DDBUpdateIncidents"
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${local.account_id}:table/aigo-im-*"
      }]
    })
  }
  inline_policy {
    name = "invoke-supervisor"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "InvokeSupervisor"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = "arn:aws:lambda:${var.aws_region}:${local.account_id}:function:aigo-im-supervisor-agent*"
      }]
    })
  }
}

resource "aws_iam_role" "im_supervisor" {
  name               = "aigo-im-supervisor-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.common_tags

  inline_policy {
    name   = "base"
    policy = data.aws_iam_policy_document.lambda_base.json
  }
  inline_policy {
    name   = "ddb"
    policy = data.aws_iam_policy_document.im_ddb_read_write.json
  }
  inline_policy {
    name = "invoke-subagents"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid    = "InvokeSubAgents"
        Effect = "Allow"
        Action = ["lambda:InvokeFunction"]
        Resource = [
          "arn:aws:lambda:${var.aws_region}:${local.account_id}:function:aigo-im-scope-agent*",
          "arn:aws:lambda:${var.aws_region}:${local.account_id}:function:aigo-im-summary-agent*",
        ]
      }]
    })
  }
}

resource "aws_iam_role" "im_scope_agent" {
  name               = "aigo-im-scope-agent-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.common_tags

  inline_policy {
    name   = "base"
    policy = data.aws_iam_policy_document.lambda_base.json
  }
  inline_policy {
    name   = "ddb"
    policy = data.aws_iam_policy_document.im_ddb_read_write.json
  }
  inline_policy {
    name   = "bedrock"
    policy = data.aws_iam_policy_document.im_bedrock.json
  }
  inline_policy {
    name = "cloudwatch-read"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid    = "CWRead"
        Effect = "Allow"
        Action = [
          "cloudwatch:GetMetricData", "cloudwatch:DescribeAlarms",
          "logs:StartQuery", "logs:GetQueryResults", "logs:DescribeLogGroups",
          "ec2:DescribeInstances", "rds:DescribeDBInstances",
          "ecs:DescribeServices", "ecs:DescribeClusters",
          "health:DescribeEvents", "health:DescribeEventDetails",
          "sts:AssumeRole",
        ]
        Resource = "*"
      }]
    })
  }
}

resource "aws_iam_role" "im_summary_agent" {
  name               = "aigo-im-summary-agent-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.common_tags

  inline_policy {
    name   = "base"
    policy = data.aws_iam_policy_document.lambda_base.json
  }
  inline_policy {
    name   = "ddb"
    policy = data.aws_iam_policy_document.im_ddb_read_write.json
  }
  inline_policy {
    name   = "bedrock"
    policy = data.aws_iam_policy_document.im_bedrock.json
  }
  inline_policy {
    name = "s3-reports"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "S3Reports"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.im_reports.arn}/*"
      }]
    })
  }
  inline_policy {
    name = "ses-send"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "SESSend"
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "*"
      }]
    })
  }
}

resource "aws_iam_role" "im_security_agent" {
  name               = "aigo-im-security-agent-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.common_tags

  inline_policy {
    name   = "base"
    policy = data.aws_iam_policy_document.lambda_base.json
  }
  inline_policy {
    name   = "ddb"
    policy = data.aws_iam_policy_document.im_ddb_read_write.json
  }
  inline_policy {
    name   = "bedrock"
    policy = data.aws_iam_policy_document.im_bedrock.json
  }
  inline_policy {
    name = "guardduty-read"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "GuardDutyRead"
        Effect   = "Allow"
        Action   = ["guardduty:GetFindings", "guardduty:ListDetectors"]
        Resource = "*"
      }]
    })
  }
}

resource "aws_iam_role" "im_chat_agent" {
  name               = "aigo-im-chat-agent-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.common_tags

  inline_policy {
    name   = "base"
    policy = data.aws_iam_policy_document.lambda_base.json
  }
  inline_policy {
    name   = "ddb"
    policy = data.aws_iam_policy_document.im_ddb_read_write.json
  }
  inline_policy {
    name   = "bedrock"
    policy = data.aws_iam_policy_document.im_bedrock.json
  }
  inline_policy {
    name = "cloudwatch-read"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid    = "CWRead"
        Effect = "Allow"
        Action = [
          "cloudwatch:GetMetricData",
          "cloudwatch:GetMetricStatistics",
          "cloudwatch:DescribeAlarms",
          "logs:StartQuery",
          "logs:GetQueryResults",
          "logs:DescribeLogGroups",
        ]
        Resource = "*"
      }]
    })
  }
}

resource "aws_iam_role" "im_action_executor" {
  name               = "aigo-im-action-executor-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.common_tags

  inline_policy {
    name   = "base"
    policy = data.aws_iam_policy_document.lambda_base.json
  }
  inline_policy {
    name   = "ddb"
    policy = data.aws_iam_policy_document.im_ddb_read_write.json
  }
  inline_policy {
    name = "remediation"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Sid    = "EC2Remediation"
          Effect = "Allow"
          Action = [
            "ec2:RebootInstances", "ec2:StopInstances", "ec2:StartInstances",
            "ec2:DescribeInstances",
          ]
          Resource = "*"
        },
        {
          Sid      = "RDSRemediation"
          Effect   = "Allow"
          Action   = ["rds:RebootDBInstance", "rds:DescribeDBInstances"]
          Resource = "*"
        },
        {
          Sid      = "ECSRemediation"
          Effect   = "Allow"
          Action   = ["ecs:UpdateService", "ecs:DescribeServices"]
          Resource = "*"
        },
        {
          Sid      = "SSMRemediation"
          Effect   = "Allow"
          Action   = ["ssm:SendCommand", "ssm:GetCommandInvocation"]
          Resource = "*"
        },
        {
          Sid      = "CrossAccountAssume"
          Effect   = "Allow"
          Action   = ["sts:AssumeRole"]
          Resource = "arn:aws:iam::*:role/aigo-im-cross-account"
        },
      ]
    })
  }
}

# Step Functions execution role
resource "aws_iam_role" "im_sfn" {
  name = "aigo-im-sfn-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "states.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.common_tags

  inline_policy {
    name = "invoke-poll-investigation"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "InvokePollInvestigation"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = "arn:aws:lambda:${var.aws_region}:${local.account_id}:function:aigo-im-poll-investigation*"
      }]
    })
  }
  inline_policy {
    name = "ddb-read-write"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid    = "DDBReadWrite"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
        ]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${local.account_id}:table/aigo-im-*"
      }]
    })
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# EventBridge — IM dedicated bus + rules
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_event_bus" "im" {
  name = "aigo-im-event-bus"
  tags = local.common_tags
}

# Allow linked accounts (added via aws_cloudwatch_event_bus_policy) to publish events
# The policy is managed separately and updated when new linked accounts are added.
# See: infra/terraform/modules/im-linked-account for the per-account setup.
resource "aws_cloudwatch_event_bus_policy" "allow_linked_accounts" {
  count = var.aws_org_id != "" ? 1 : 0

  event_bus_name = aws_cloudwatch_event_bus.im.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AllowLinkedAccountsToPublish"
      Effect = "Allow"
      Principal = {
        AWS = "*"
      }
      Action   = ["events:PutEvents"]
      Resource = aws_cloudwatch_event_bus.im.arn
      Condition = {
        StringEquals = {
          "aws:PrincipalOrgID" = var.aws_org_id
        }
      }
    }]
  })
}

# CloudWatch Alarm state change → normalize-event Lambda
resource "aws_cloudwatch_event_rule" "cloudwatch_alarm" {
  name           = "aigo-im-rule-cloudwatch-alarm"
  description    = "CloudWatch Alarm ALARM state → IM normalize-event"
  event_bus_name = aws_cloudwatch_event_bus.im.name
  state          = "DISABLED" # Enable after investigation targets are configured

  event_pattern = jsonencode({
    source      = ["aws.cloudwatch"]
    detail-type = ["CloudWatch Alarm State Change"]
    detail      = { state = { value = ["ALARM"] } }
  })

  tags = local.common_tags
}

# AWS Health events → normalize-event Lambda
resource "aws_cloudwatch_event_rule" "health_event" {
  name           = "aigo-im-rule-health-event"
  description    = "AWS Health Event → IM normalize-event"
  event_bus_name = aws_cloudwatch_event_bus.im.name
  state          = "DISABLED" # Enable after verification

  event_pattern = jsonencode({
    source      = ["aws.health"]
    detail-type = ["AWS Health Event"]
  })

  tags = local.common_tags
}

# GuardDuty findings → security-event Lambda (default bus)
resource "aws_cloudwatch_event_rule" "guardduty" {
  name           = "aigo-im-rule-guardduty"
  description    = "GuardDuty finding → IM security-event handler"
  event_bus_name = "default"
  state          = "ENABLED"

  event_pattern = jsonencode({
    source      = ["aws.guardduty"]
    detail-type = ["GuardDuty Finding"]
  })

  tags = local.common_tags
}

# ──────────────────────────────────────────────────────────────────────────────
# Step Functions — Investigation state machine
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_sfn_state_machine" "investigation" {
  name     = "aigo-im-investigation"
  role_arn = aws_iam_role.im_sfn.arn
  type     = "STANDARD"

  definition = jsonencode({
    Comment = "AIGO Incident Management — Investigation orchestration (polling pattern)"
    StartAt = "StartInvestigation"
    States = {
      StartInvestigation = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = "aigo-im-poll-investigation:live"
          "Payload.$"  = "$"
        }
        ResultPath     = null
        TimeoutSeconds = 60
        Retry = [{
          ErrorEquals     = ["Lambda.ServiceException", "Lambda.AWSLambdaException"]
          MaxAttempts     = 2
          IntervalSeconds = 10
          BackoffRate     = 2
        }]
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "MarkFailed"
          ResultPath  = "$.error"
        }]
        Next = "WaitForInvestigation"
      }
      WaitForInvestigation = {
        Type    = "Wait"
        Seconds = 60
        Next    = "CheckStatus"
      }
      CheckStatus = {
        Type     = "Task"
        Resource = "arn:aws:states:::dynamodb:getItem"
        Parameters = {
          TableName = "aigo-im-Incidents"
          Key = {
            PK = { "S.$" = "States.Format('INCIDENT#{}', $.incidentId)" }
            SK = { S = "METADATA" }
          }
          ProjectionExpression    = "#s"
          ExpressionAttributeNames = { "#s" = "status" }
        }
        ResultPath = "$.statusResult"
        Next       = "EvaluateStatus"
      }
      EvaluateStatus = {
        Type = "Choice"
        Choices = [
          {
            Variable     = "$.statusResult.Item.status.S"
            StringEquals = "REPORTED"
            Next         = "Done"
          },
          {
            Variable     = "$.statusResult.Item.status.S"
            StringEquals = "INVESTIGATION_FAILED"
            Next         = "MarkFailed"
          }
        ]
        Default = "WaitForInvestigation"
      }
      Done = { Type = "Succeed" }
      MarkFailed = {
        Type     = "Task"
        Resource = "arn:aws:states:::dynamodb:updateItem"
        Parameters = {
          TableName = "aigo-im-Incidents"
          Key = {
            PK = { "S.$" = "States.Format('INCIDENT#{}', $.incidentId)" }
            SK = { S = "METADATA" }
          }
          UpdateExpression          = "SET #s = :s"
          ExpressionAttributeNames  = { "#s" = "status" }
          ExpressionAttributeValues = { ":s" = { S = "INVESTIGATION_FAILED" } }
        }
        Next = "Fail"
      }
      Fail = { Type = "Fail" }
    }
  })

  tags = local.common_tags
}

# ──────────────────────────────────────────────────────────────────────────────
# Lambda — placeholder code (실제 코드는 deploy script로 배포)
# Reuse existing modules/lambda module
# ──────────────────────────────────────────────────────────────────────────────
locals {
  im_common_env = {
    IM_TABLE_PREFIX           = "aigo-im"
    IM_INCIDENTS_TABLE        = module.im_dynamodb.table_names["incidents"]
    IM_INVESTIGATION_TABLE    = module.im_dynamodb.table_names["investigation_results"]
    IM_REPORTS_TABLE          = module.im_dynamodb.table_names["reports"]
    IM_RECOVERY_ACTIONS_TABLE = module.im_dynamodb.table_names["recovery_actions"]
    IM_TARGETS_TABLE          = module.im_dynamodb.table_names["investigation_targets"]
    IM_INTEGRATIONS_TABLE     = module.im_dynamodb.table_names["external_integrations"]
    IM_LINKED_ACCOUNTS_TABLE  = module.im_dynamodb.table_names["linked_accounts"]
    IM_ALLOWED_ACTIONS_TABLE  = module.im_dynamodb.table_names["allowed_actions"]
    IM_SETTINGS_TABLE         = module.im_dynamodb.table_names["remediation_settings"]
    IM_SECURITY_EVENTS_TABLE  = module.im_dynamodb.table_names["security_events"]
    IM_CONVERSATIONS_TABLE    = module.im_dynamodb.table_names["conversations"]
    IM_REPORTS_BUCKET         = aws_s3_bucket.im_reports.id
    IM_SFN_ARN                = aws_sfn_state_machine.investigation.arn
    IM_EVENT_BUS_NAME         = aws_cloudwatch_event_bus.im.name
    SES_FROM_ADDRESS          = "noreply@seolphung.com"
    MODEL_ID                  = "us.anthropic.claude-sonnet-4-6-20250514-v1:0"
    COGNITO_USER_POOL_ID      = tolist(data.aws_cognito_user_pools.main.ids)[0]
  }

  im_vpc = {
    subnet_ids         = tolist(data.aws_subnets.private.ids)
    security_group_ids = [data.aws_security_group.lambda.id]
  }
}

module "lambda_im_api" {
  source             = "../../modules/lambda"
  project            = "aigo"
  function_name      = "im-api"
  description        = "IM REST API handler (Hono)"
  handler            = "index.handler"
  runtime            = "nodejs22.x"
  memory_size        = 512
  timeout            = 29
  s3_bucket          = data.aws_s3_bucket.artifacts.id
  s3_key             = "lambda/im-api/latest.zip"
  kms_key_arn        = data.aws_kms_alias.lambda.target_key_arn
  role_arn           = aws_iam_role.im_api.arn
  subnet_ids         = local.im_vpc.subnet_ids
  security_group_ids = local.im_vpc.security_group_ids
  environment_variables = merge(local.im_common_env, {
    ALLOWED_ORIGINS              = "https://app.seolphung.com"
    IM_CHAT_AGENT_FUNCTION       = "aigo-im-chat-agent:live"
    IM_ACTION_EXECUTOR_FUNCTION  = "aigo-im-action-executor:live"
  })
  tags = local.common_tags
}

module "lambda_im_normalize_event" {
  source                = "../../modules/lambda"
  project               = "aigo"
  function_name         = "im-normalize-event"
  description           = "CloudWatch/Health event → Incident + SFN"
  handler               = "handler.lambda_handler"
  runtime               = "python3.12"
  memory_size           = 256
  timeout               = 60
  s3_bucket             = data.aws_s3_bucket.artifacts.id
  s3_key                = "lambda/im-normalize-event/latest.zip"
  kms_key_arn           = data.aws_kms_alias.lambda.target_key_arn
  role_arn              = aws_iam_role.im_normalize_event.arn
  subnet_ids            = local.im_vpc.subnet_ids
  security_group_ids    = local.im_vpc.security_group_ids
  environment_variables = local.im_common_env
  tags                  = local.common_tags
}

module "lambda_im_webhook_receiver" {
  source                = "../../modules/lambda"
  project               = "aigo"
  function_name         = "im-webhook-receiver"
  description           = "External tool Webhook → Incident + SFN"
  handler               = "handler.lambda_handler"
  runtime               = "python3.12"
  memory_size           = 256
  timeout               = 30
  s3_bucket             = data.aws_s3_bucket.artifacts.id
  s3_key                = "lambda/im-webhook-receiver/latest.zip"
  kms_key_arn           = data.aws_kms_alias.lambda.target_key_arn
  role_arn              = aws_iam_role.im_webhook_receiver.arn
  subnet_ids            = local.im_vpc.subnet_ids
  security_group_ids    = local.im_vpc.security_group_ids
  environment_variables = local.im_common_env
  tags                  = local.common_tags
}

module "lambda_im_security_event" {
  source                = "../../modules/lambda"
  project               = "aigo"
  function_name         = "im-security-event"
  description           = "GuardDuty finding → SecurityEvents DDB → security-agent"
  handler               = "handler.lambda_handler"
  runtime               = "python3.12"
  memory_size           = 256
  timeout               = 60
  s3_bucket             = data.aws_s3_bucket.artifacts.id
  s3_key                = "lambda/im-security-event/latest.zip"
  kms_key_arn           = data.aws_kms_alias.lambda.target_key_arn
  role_arn              = aws_iam_role.im_security_event.arn
  subnet_ids            = local.im_vpc.subnet_ids
  security_group_ids    = local.im_vpc.security_group_ids
  environment_variables = local.im_common_env
  tags                  = local.common_tags
}

module "lambda_im_poll_investigation" {
  source             = "../../modules/lambda"
  project            = "aigo"
  function_name      = "im-poll-investigation"
  description        = "SFN Task: set status=INVESTIGATING, invoke supervisor async"
  handler            = "handler.lambda_handler"
  runtime            = "python3.12"
  memory_size        = 128
  timeout            = 30
  s3_bucket          = data.aws_s3_bucket.artifacts.id
  s3_key             = "lambda/im-poll-investigation/latest.zip"
  kms_key_arn        = data.aws_kms_alias.lambda.target_key_arn
  role_arn           = aws_iam_role.im_poll_investigation.arn
  subnet_ids         = local.im_vpc.subnet_ids
  security_group_ids = local.im_vpc.security_group_ids
  environment_variables = merge(local.im_common_env, {
    IM_SUPERVISOR_FUNCTION = "aigo-im-supervisor-agent:live"
  })
  tags = local.common_tags
}

module "lambda_im_supervisor" {
  source             = "../../modules/lambda"
  project            = "aigo"
  function_name      = "im-supervisor-agent"
  description        = "IM supervisor — invoke scope + summary agents in parallel"
  handler            = "handler.lambda_handler"
  runtime            = "python3.12"
  memory_size        = 512
  timeout            = 840
  s3_bucket          = data.aws_s3_bucket.artifacts.id
  s3_key             = "lambda/im-supervisor-agent/latest.zip"
  kms_key_arn        = data.aws_kms_alias.lambda.target_key_arn
  role_arn           = aws_iam_role.im_supervisor.arn
  subnet_ids         = local.im_vpc.subnet_ids
  security_group_ids = local.im_vpc.security_group_ids
  environment_variables = merge(local.im_common_env, {
    IM_SCOPE_AGENT_FUNCTION   = "aigo-im-scope-agent"
    IM_SUMMARY_AGENT_FUNCTION = "aigo-im-summary-agent"
  })
  tags = local.common_tags
}

module "lambda_im_scope_agent" {
  source                = "../../modules/lambda"
  project               = "aigo"
  function_name         = "im-scope-agent"
  description           = "Root cause & blast radius analysis (Strands)"
  handler               = "handler.lambda_handler"
  runtime               = "python3.12"
  memory_size           = 1024
  timeout               = 600
  s3_bucket             = data.aws_s3_bucket.artifacts.id
  s3_key                = "lambda/im-scope-agent/latest.zip"
  kms_key_arn           = data.aws_kms_alias.lambda.target_key_arn
  role_arn              = aws_iam_role.im_scope_agent.arn
  subnet_ids            = local.im_vpc.subnet_ids
  security_group_ids    = local.im_vpc.security_group_ids
  environment_variables = local.im_common_env
  tags                  = local.common_tags
}

module "lambda_im_summary_agent" {
  source                = "../../modules/lambda"
  project               = "aigo"
  function_name         = "im-summary-agent"
  description           = "Korean incident report generation + S3 + SES (Strands)"
  handler               = "handler.lambda_handler"
  runtime               = "python3.12"
  memory_size           = 512
  timeout               = 300
  s3_bucket             = data.aws_s3_bucket.artifacts.id
  s3_key                = "lambda/im-summary-agent/latest.zip"
  kms_key_arn           = data.aws_kms_alias.lambda.target_key_arn
  role_arn              = aws_iam_role.im_summary_agent.arn
  subnet_ids            = local.im_vpc.subnet_ids
  security_group_ids    = local.im_vpc.security_group_ids
  environment_variables = local.im_common_env
  tags                  = local.common_tags
}

module "lambda_im_security_agent" {
  source                = "../../modules/lambda"
  project               = "aigo"
  function_name         = "im-security-agent"
  description           = "GuardDuty/CloudTrail analysis + playbook (Strands)"
  handler               = "handler.lambda_handler"
  runtime               = "python3.12"
  memory_size           = 512
  timeout               = 300
  s3_bucket             = data.aws_s3_bucket.artifacts.id
  s3_key                = "lambda/im-security-agent/latest.zip"
  kms_key_arn           = data.aws_kms_alias.lambda.target_key_arn
  role_arn              = aws_iam_role.im_security_agent.arn
  subnet_ids            = local.im_vpc.subnet_ids
  security_group_ids    = local.im_vpc.security_group_ids
  environment_variables = local.im_common_env
  tags                  = local.common_tags
}

module "lambda_im_chat_agent" {
  source                = "../../modules/lambda"
  project               = "aigo"
  function_name         = "im-chat-agent"
  description           = "Resource diagnosis AI chat (Strands + Bedrock Claude)"
  handler               = "handler.lambda_handler"
  runtime               = "python3.12"
  memory_size           = 512
  timeout               = 60
  s3_bucket             = data.aws_s3_bucket.artifacts.id
  s3_key                = "lambda/im-chat-agent/latest.zip"
  kms_key_arn           = data.aws_kms_alias.lambda.target_key_arn
  role_arn              = aws_iam_role.im_chat_agent.arn
  subnet_ids            = local.im_vpc.subnet_ids
  security_group_ids    = local.im_vpc.security_group_ids
  environment_variables = local.im_common_env
  tags                  = local.common_tags
}

module "lambda_im_action_executor" {
  source                = "../../modules/lambda"
  project               = "aigo"
  function_name         = "im-action-executor"
  description           = "Approved recovery action execution (AllowList/All + AssumeRole)"
  handler               = "handler.lambda_handler"
  runtime               = "python3.12"
  memory_size           = 256
  timeout               = 300
  s3_bucket             = data.aws_s3_bucket.artifacts.id
  s3_key                = "lambda/im-action-executor/latest.zip"
  kms_key_arn           = data.aws_kms_alias.lambda.target_key_arn
  role_arn              = aws_iam_role.im_action_executor.arn
  subnet_ids            = local.im_vpc.subnet_ids
  security_group_ids    = local.im_vpc.security_group_ids
  environment_variables = local.im_common_env
  tags                  = local.common_tags
}

# ──────────────────────────────────────────────────────────────────────────────
# EventBridge targets — wire rules to Lambda functions
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_event_target" "cloudwatch_to_normalize" {
  rule           = aws_cloudwatch_event_rule.cloudwatch_alarm.name
  event_bus_name = aws_cloudwatch_event_bus.im.name
  target_id      = "im-normalize-event"
  arn            = module.lambda_im_normalize_event.alias_arn
}

resource "aws_lambda_permission" "cloudwatch_to_normalize" {
  statement_id  = "AllowCloudWatchAlarmBus"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda_im_normalize_event.function_name
  qualifier     = "live"
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.cloudwatch_alarm.arn
}

resource "aws_cloudwatch_event_target" "health_to_normalize" {
  rule           = aws_cloudwatch_event_rule.health_event.name
  event_bus_name = aws_cloudwatch_event_bus.im.name
  target_id      = "im-normalize-event-health"
  arn            = module.lambda_im_normalize_event.alias_arn
}

resource "aws_lambda_permission" "health_to_normalize" {
  statement_id  = "AllowHealthEventBus"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda_im_normalize_event.function_name
  qualifier     = "live"
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.health_event.arn
}

resource "aws_cloudwatch_event_target" "guardduty_to_security" {
  rule      = aws_cloudwatch_event_rule.guardduty.name
  target_id = "im-security-event"
  arn       = module.lambda_im_security_event.alias_arn
}

resource "aws_lambda_permission" "guardduty_to_security" {
  statement_id  = "AllowGuardDutyEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda_im_security_event.function_name
  qualifier     = "live"
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.guardduty.arn
}

# ──────────────────────────────────────────────────────────────────────────────
# API Gateway HTTP API — im-api.seolphung.com
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_apigatewayv2_api" "im" {
  name          = "aigo-im-api"
  protocol_type = "HTTP"
  description   = "AIGO Incident Management API"

  cors_configuration {
    allow_origins = ["https://app.seolphung.com"]
    allow_methods = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age       = 86400
  }

  tags = local.common_tags
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.im.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito-authorizer"

  jwt_configuration {
    audience = [tolist(data.aws_cognito_user_pools.main.ids)[0]]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${tolist(data.aws_cognito_user_pools.main.ids)[0]}"
  }
}

resource "aws_apigatewayv2_integration" "im_api" {
  api_id                 = aws_apigatewayv2_api.im.id
  integration_type       = "AWS_PROXY"
  integration_uri        = module.lambda_im_api.alias_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "catch_all_auth" {
  api_id             = aws_apigatewayv2_api.im.id
  route_key          = "ANY /{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.im_api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# OPTIONS preflight — no auth (browsers send this before every CORS request)
resource "aws_apigatewayv2_route" "options" {
  api_id             = aws_apigatewayv2_api.im.id
  route_key          = "OPTIONS /{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.im_api.id}"
  authorization_type = "NONE"
}

# Webhook route — no auth (uses API key in header instead)
resource "aws_apigatewayv2_route" "webhook" {
  api_id             = aws_apigatewayv2_api.im.id
  route_key          = "POST /webhook/{integrationId}"
  target             = "integrations/${aws_apigatewayv2_integration.im_api.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_stage" "prod" {
  api_id      = aws_apigatewayv2_api.im.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gw.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      responseLength = "$context.responseLength"
      integrationLatency = "$context.integrationLatency"
    })
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "api_gw" {
  name              = "/aws/apigateway/aigo-im-api"
  retention_in_days = 30
  tags              = local.common_tags
}

resource "aws_lambda_permission" "api_gw_im_api" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda_im_api.function_name
  qualifier     = "live"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.im.execution_arn}/*/*"
}

# Custom domain
resource "aws_apigatewayv2_domain_name" "im" {
  domain_name = "im-api.seolphung.com"

  domain_name_configuration {
    certificate_arn = data.aws_acm_certificate.regional.arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }

  tags = local.common_tags
}

resource "aws_apigatewayv2_api_mapping" "im" {
  api_id      = aws_apigatewayv2_api.im.id
  domain_name = aws_apigatewayv2_domain_name.im.id
  stage       = aws_apigatewayv2_stage.prod.id
}

resource "aws_route53_record" "im_api" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "im-api.seolphung.com"
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.im.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.im.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
