locals {
  common_tags = merge(var.tags, {
    ManagedBy = "terraform"
    Module    = "im-linked-account"
    Product   = "IncidentManagement"
  })
}

# ──────────────────────────────────────────────────────────────────────────────
# 1. EventBridge rule — forward CloudWatch Alarm state changes to central bus
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_event_rule" "cloudwatch_alarm_forward" {
  name        = "aigo-im-forward-cloudwatch-alarms"
  description = "Forward CloudWatch Alarm ALARM state changes to AIGO central event bus"

  event_pattern = jsonencode({
    source      = ["aws.cloudwatch"]
    detail-type = ["CloudWatch Alarm State Change"]
    detail = {
      state = {
        value = ["ALARM"]
      }
    }
  })

  tags = local.common_tags
}

resource "aws_cloudwatch_event_target" "forward_to_central" {
  rule      = aws_cloudwatch_event_rule.cloudwatch_alarm_forward.name
  target_id = "aigo-im-central-bus"
  arn       = var.central_event_bus_arn

  role_arn = aws_iam_role.eventbridge_forward.arn
}

# ──────────────────────────────────────────────────────────────────────────────
# 2. EventBridge rule — forward AWS Health events to central bus
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_event_rule" "health_forward" {
  name        = "aigo-im-forward-health-events"
  description = "Forward AWS Health events to AIGO central event bus"

  event_pattern = jsonencode({
    source      = ["aws.health"]
    detail-type = ["AWS Health Event"]
  })

  tags = local.common_tags
}

resource "aws_cloudwatch_event_target" "health_to_central" {
  rule      = aws_cloudwatch_event_rule.health_forward.name
  target_id = "aigo-im-central-bus-health"
  arn       = var.central_event_bus_arn

  role_arn = aws_iam_role.eventbridge_forward.arn
}

# ──────────────────────────────────────────────────────────────────────────────
# 3. IAM role — allow EventBridge in this account to put events to central bus
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_iam_role" "eventbridge_forward" {
  name = "aigo-im-eventbridge-forward-role"
  tags = local.common_tags

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  inline_policy {
    name = "put-central-events"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "PutCentralEvents"
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = var.central_event_bus_arn
      }]
    })
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# 4. Cross-account role — allow AIGO central im-api to AssumeRole here
#    (for CloudWatch monitoring and remediation execution)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_iam_role" "cross_account" {
  name = "aigo-im-cross-account-role"
  tags = local.common_tags

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { AWS = var.im_api_role_arn }
        Action    = "sts:AssumeRole"
        Condition = {
          StringEquals = {
            "sts:ExternalId" = "aigo-im-monitoring"
          }
        }
      },
      {
        # action-executor also needs to AssumeRole for remediation
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.central_account_id}:root" }
        Action    = "sts:AssumeRole"
        Condition = {
          StringLike = {
            "aws:PrincipalArn" = "arn:aws:iam::${var.central_account_id}:role/aigo-im-*"
          }
        }
      }
    ]
  })

  inline_policy {
    name = "cloudwatch-read"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid    = "CloudWatchRead"
        Effect = "Allow"
        Action = [
          "cloudwatch:DescribeAlarms",
          "cloudwatch:GetMetricStatistics",
          "cloudwatch:GetMetricData",
        ]
        Resource = "*"
      }]
    })
  }

  inline_policy {
    name = "ecs-restart"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid    = "ECSRestart"
        Effect = "Allow"
        Action = [
          "ecs:UpdateService",
          "ecs:DescribeServices",
        ]
        Resource = "*"
      }]
    })
  }

  inline_policy {
    name = "lambda-invoke"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "LambdaInvoke"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = "arn:aws:lambda:${var.aws_region}:*:function:*"
      }]
    })
  }

  inline_policy {
    name = "ssm-run"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid    = "SSMRun"
        Effect = "Allow"
        Action = [
          "ssm:SendCommand",
          "ssm:GetCommandInvocation",
        ]
        Resource = "*"
      }]
    })
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# 5. Resource policy on central event bus — allow this account to put events
#    (applied in the CENTRAL account, documented here for reference)
# ──────────────────────────────────────────────────────────────────────────────
# NOTE: The following resource policy must be applied to the central aigo-im-event-bus
# in the central account to allow cross-account event delivery.
# Add this to infra/terraform/envs/im/main.tf:
#
# resource "aws_cloudwatch_event_bus_policy" "allow_linked_accounts" {
#   event_bus_name = aws_cloudwatch_event_bus.im.name
#   policy = jsonencode({
#     Version = "2012-10-17"
#     Statement = [{
#       Sid       = "AllowLinkedAccountsToPublish"
#       Effect    = "Allow"
#       Principal = { AWS = "<linked-account-ids>" }
#       Action    = "events:PutEvents"
#       Resource  = aws_cloudwatch_event_bus.im.arn
#     }]
#   })
# }
