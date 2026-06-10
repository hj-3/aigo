locals {
  fn_name = "${var.project}-${var.function_name}"
  common_tags = merge(var.tags, {
    Project      = var.project
    ManagedBy    = "terraform"
    Module       = "lambda"
    FunctionName = local.fn_name
  })
}

resource "aws_lambda_function" "this" {
  function_name = local.fn_name
  description   = var.description
  role          = var.role_arn
  handler       = var.handler
  runtime       = var.runtime
  memory_size   = var.memory_size
  timeout       = var.timeout
  publish       = var.publish
  layers        = var.layers

  s3_bucket = var.s3_bucket
  s3_key    = var.s3_key

  kms_key_arn = var.kms_key_arn

  reserved_concurrent_executions = var.reserved_concurrency == -1 ? null : var.reserved_concurrency

  dynamic "vpc_config" {
    for_each = length(var.subnet_ids) > 0 ? [1] : []
    content {
      subnet_ids         = var.subnet_ids
      security_group_ids = var.security_group_ids
    }
  }

  environment {
    variables = merge(
      {
        STAGE           = "prod"
        SERVICE_NAME    = local.fn_name
        LOG_LEVEL       = "INFO"
        AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
      },
      var.environment_variables
    )
  }

  tracing_config { mode = "Active" }

  tags = local.common_tags
}

# ──────────────────────────────────────────────────────────────────────────────
# Alias: "live" — always points to the active version
# Canary deployments: shift traffic gradually from current to new version
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_lambda_alias" "live" {
  name             = "live"
  function_name    = aws_lambda_function.this.function_name
  function_version = aws_lambda_function.this.version

  lifecycle {
    ignore_changes = [routing_config]
  }
}

# CloudWatch alarm triggers auto-rollback via CI/CD
resource "aws_cloudwatch_metric_alarm" "error_rate" {
  alarm_name          = "${local.fn_name}-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Lambda error rate too high — triggers rollback"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = local.fn_name
    Resource     = "${local.fn_name}:live"
  }

  tags = local.common_tags
}
