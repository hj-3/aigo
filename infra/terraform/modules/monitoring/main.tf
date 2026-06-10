locals {
  p = var.project
  common_tags = merge(var.tags, {
    Project   = var.project
    ManagedBy = "terraform"
    Module    = "monitoring"
  })
}

# ──────────────────────────────────────────────────────────────────────────────
# CloudWatch Log Groups (one per Lambda, KMS-encrypted, retention enforced)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "lambda" {
  for_each = toset(var.lambda_function_names)

  name              = "/aws/lambda/${each.value}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn

  tags = merge(local.common_tags, { Name = "${each.value}-logs" })
}

# ──────────────────────────────────────────────────────────────────────────────
# Lambda Error Rate Alarms (> 1% errors over 5 minutes triggers alarm)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = toset(var.lambda_function_names)

  alarm_name          = "${each.value}-error-rate"
  alarm_description   = "Error rate > 1% for Lambda ${each.value}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 1

  metric_query {
    id          = "error_rate"
    expression  = "100 * errors / MAX([errors, invocations])"
    label       = "Error Rate (%)"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      metric_name = "Errors"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions  = { FunctionName = each.value }
    }
  }

  metric_query {
    id = "invocations"
    metric {
      metric_name = "Invocations"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions  = { FunctionName = each.value }
    }
  }

  alarm_actions      = [var.sns_alarm_topic_arn]
  ok_actions         = [var.sns_alarm_topic_arn]
  treat_missing_data = "notBreaching"

  tags = local.common_tags
}

# ──────────────────────────────────────────────────────────────────────────────
# SQS DLQ Alarms (any message in DLQ = potential data loss)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "dlq" {
  for_each = toset(var.sqs_dlq_names)

  alarm_name          = "${each.value}-dlq-messages"
  alarm_description   = "Messages appeared in DLQ: ${each.value}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_actions       = [var.sns_alarm_topic_arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = each.value
  }

  tags = local.common_tags
}

# ──────────────────────────────────────────────────────────────────────────────
# API Gateway Alarms
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${local.p}-api-5xx-errors"
  alarm_description   = "API Gateway 5xx error rate elevated"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "5xx"
  namespace           = "AWS/ApiGateway"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_actions       = [var.sns_alarm_topic_arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    ApiId = var.api_gateway_id
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "api_latency_p99" {
  alarm_name          = "${local.p}-api-latency-p99"
  alarm_description   = "API Gateway p99 latency > 10s"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "IntegrationLatency"
  namespace           = "AWS/ApiGateway"
  period              = 300
  extended_statistic  = "p99"
  threshold           = 10000
  alarm_actions       = [var.sns_alarm_topic_arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    ApiId = var.api_gateway_id
  }

  tags = local.common_tags
}

# ──────────────────────────────────────────────────────────────────────────────
# CloudWatch Dashboard — Platform Overview
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_dashboard" "overview" {
  dashboard_name = "${local.p}-overview"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Lambda Invocations & Errors"
          view    = "timeSeries"
          stacked = false
          metrics = [
            for fn in var.lambda_function_names : [
              "AWS/Lambda", "Invocations", "FunctionName", fn
            ]
          ]
          period = 300
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title = "Lambda Duration (P95)"
          view  = "timeSeries"
          metrics = [
            for fn in var.lambda_function_names : [
              "AWS/Lambda", "Duration", "FunctionName", fn, { stat = "p95" }
            ]
          ]
          period = 300
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title = "SQS Queue Depths"
          view  = "timeSeries"
          metrics = concat(
            [["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", "${local.p}-analysis-queue.fifo"]],
            [["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", "${local.p}-notification-queue"]],
          )
          period = 300
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title = "API Gateway Requests & Errors"
          view  = "timeSeries"
          metrics = var.api_gateway_id != "" ? [
            ["AWS/ApiGateway", "Count", "ApiId", var.api_gateway_id],
            ["AWS/ApiGateway", "4xx", "ApiId", var.api_gateway_id],
            ["AWS/ApiGateway", "5xx", "ApiId", var.api_gateway_id],
          ] : []
          period = 300
          region = var.aws_region
        }
      },
    ]
  })
}
