locals {
  p = var.project
  common_tags = merge(var.tags, {
    Project   = var.project
    ManagedBy = "terraform"
    Module    = "eventbridge"
  })
}

resource "aws_cloudwatch_event_bus" "main" {
  name = "${local.p}-bus"
  tags = local.common_tags
}

resource "aws_cloudwatch_event_archive" "main" {
  name             = "${local.p}-archive"
  event_source_arn = aws_cloudwatch_event_bus.main.arn
  retention_days   = 90
}

# ──────────────────────────────────────────────────────────────────────────────
# Schema Registry
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_schemas_registry" "main" {
  name        = "${local.p}-registry"
  description = "Event schemas for AgentOps Platform"
  tags        = local.common_tags
}

# ──────────────────────────────────────────────────────────────────────────────
# EventBridge → SQS Routing Rules
# Each rule extracts $.detail and forwards it as the SQS message body.
# This preserves the existing AnalysisQueueMessage / IncidentQueueMessage format
# that lightweight-worker already expects.
# ──────────────────────────────────────────────────────────────────────────────

# IAM role that allows EventBridge to send messages to SQS FIFO queues
resource "aws_iam_role" "eventbridge_sqs" {
  name = "${local.p}-eventbridge-sqs-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy" "eventbridge_sqs" {
  name = "${local.p}-eventbridge-sqs-policy"
  role = aws_iam_role.eventbridge_sqs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = compact([
          var.analysis_queue_arn,
          var.incident_queue_arn,
          var.notification_queue_arn,
        ])
      }
    ]
  })
}

# Rule: PR_ANALYSIS_REQUESTED → SQS analysis-queue
resource "aws_cloudwatch_event_rule" "pr_analysis" {
  count          = var.analysis_queue_arn != "" ? 1 : 0
  name           = "${local.p}-pr-analysis-requested"
  description    = "Routes PR_ANALYSIS_REQUESTED events to the analysis SQS queue"
  event_bus_name = aws_cloudwatch_event_bus.main.name
  event_pattern = jsonencode({
    source      = ["aigo.github", "aigo.dashboard"]
    detail-type = ["PR_ANALYSIS_REQUESTED"]
  })
  tags = local.common_tags
}

resource "aws_cloudwatch_event_target" "pr_analysis_sqs" {
  count          = var.analysis_queue_arn != "" ? 1 : 0
  rule           = aws_cloudwatch_event_rule.pr_analysis[0].name
  event_bus_name = aws_cloudwatch_event_bus.main.name
  target_id      = "AnalysisSqsTarget"
  arn            = var.analysis_queue_arn
  role_arn       = aws_iam_role.eventbridge_sqs.arn

  # Extract $.detail and use it as the SQS message body
  # This means lightweight-worker receives the same AnalysisQueueMessage as before
  input_transformer {
    input_paths    = { detail = "$.detail" }
    input_template = "<detail>"
  }

  sqs_target {
    message_group_id = "pr-analysis"
  }
}

# Rule: INCIDENT_DETECTED → SQS incident-queue
resource "aws_cloudwatch_event_rule" "incident" {
  count          = var.incident_queue_arn != "" ? 1 : 0
  name           = "${local.p}-incident-detected"
  description    = "Routes INCIDENT_DETECTED events to the incident SQS queue"
  event_bus_name = aws_cloudwatch_event_bus.main.name
  event_pattern = jsonencode({
    source      = ["aigo.aws", "aigo.slack"]
    detail-type = ["INCIDENT_DETECTED"]
  })
  tags = local.common_tags
}

resource "aws_cloudwatch_event_target" "incident_sqs" {
  count          = var.incident_queue_arn != "" ? 1 : 0
  rule           = aws_cloudwatch_event_rule.incident[0].name
  event_bus_name = aws_cloudwatch_event_bus.main.name
  target_id      = "IncidentSqsTarget"
  arn            = var.incident_queue_arn
  role_arn       = aws_iam_role.eventbridge_sqs.arn

  input_transformer {
    input_paths    = { detail = "$.detail" }
    input_template = "<detail>"
  }

  sqs_target {
    message_group_id = "incident"
  }
}

# Rule: REPORT_CREATED → SQS notification-queue (fan-out notifications)
resource "aws_cloudwatch_event_rule" "report_created" {
  count          = var.notification_queue_arn != "" ? 1 : 0
  name           = "${local.p}-report-created"
  description    = "Routes REPORT_CREATED events to the notification SQS queue"
  event_bus_name = aws_cloudwatch_event_bus.main.name
  event_pattern = jsonencode({
    source      = ["aigo.orchestrator"]
    detail-type = ["REPORT_CREATED", "APPROVAL_SUBMITTED"]
  })
  tags = local.common_tags
}

resource "aws_cloudwatch_event_target" "report_created_sqs" {
  count          = var.notification_queue_arn != "" ? 1 : 0
  rule           = aws_cloudwatch_event_rule.report_created[0].name
  event_bus_name = aws_cloudwatch_event_bus.main.name
  target_id      = "NotificationSqsTarget"
  arn            = var.notification_queue_arn
  role_arn       = aws_iam_role.eventbridge_sqs.arn

  input_transformer {
    input_paths    = { detail = "$.detail" }
    input_template = "<detail>"
  }

  sqs_target {
    message_group_id = "notifications"
  }
}
