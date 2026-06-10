locals {
  p = var.project
  common_tags = merge(var.tags, {
    Project   = var.project
    ManagedBy = "terraform"
    Module    = "sqs"
  })
}

# ──────────────────────────────────────────────────────────────────────────────
# Dead Letter Queues (FIFO)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_sqs_queue" "dlq_analysis" {
  name                        = "${local.p}-analysis-dlq.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  message_retention_seconds   = 1209600 # 14 days
  kms_master_key_id           = var.kms_key_arn
  tags                        = merge(local.common_tags, { Name = "${local.p}-analysis-dlq" })
}

resource "aws_sqs_queue" "dlq_fix" {
  name                        = "${local.p}-fix-dlq.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  message_retention_seconds   = 1209600
  kms_master_key_id           = var.kms_key_arn
  tags                        = merge(local.common_tags, { Name = "${local.p}-fix-dlq" })
}

resource "aws_sqs_queue" "dlq_incident" {
  name                        = "${local.p}-incident-dlq.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  message_retention_seconds   = 1209600
  kms_master_key_id           = var.kms_key_arn
  tags                        = merge(local.common_tags, { Name = "${local.p}-incident-dlq" })
}

resource "aws_sqs_queue" "dlq_command" {
  name                        = "${local.p}-command-dlq.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  message_retention_seconds   = 1209600
  kms_master_key_id           = var.kms_key_arn
  tags                        = merge(local.common_tags, { Name = "${local.p}-command-dlq" })
}

resource "aws_sqs_queue" "dlq_notification" {
  name                      = "${local.p}-notification-dlq"
  message_retention_seconds = 1209600
  kms_master_key_id         = var.kms_key_arn
  tags                      = merge(local.common_tags, { Name = "${local.p}-notification-dlq" })
}

# ──────────────────────────────────────────────────────────────────────────────
# Main Queues
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_sqs_queue" "analysis" {
  name                        = "${local.p}-analysis-queue.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  visibility_timeout_seconds  = 900  # 15 min (max Lambda execution)
  message_retention_seconds   = 345600 # 4 days
  kms_master_key_id           = var.kms_key_arn

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq_analysis.arn
    maxReceiveCount     = 3
  })

  tags = merge(local.common_tags, { Name = "${local.p}-analysis-queue" })
}

resource "aws_sqs_queue" "fix" {
  name                        = "${local.p}-fix-queue.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  visibility_timeout_seconds  = 900
  message_retention_seconds   = 345600
  kms_master_key_id           = var.kms_key_arn

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq_fix.arn
    maxReceiveCount     = 3
  })

  tags = merge(local.common_tags, { Name = "${local.p}-fix-queue" })
}

resource "aws_sqs_queue" "incident" {
  name                        = "${local.p}-incident-queue.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  visibility_timeout_seconds  = 900
  message_retention_seconds   = 345600
  kms_master_key_id           = var.kms_key_arn

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq_incident.arn
    maxReceiveCount     = 3
  })

  tags = merge(local.common_tags, { Name = "${local.p}-incident-queue" })
}

resource "aws_sqs_queue" "command" {
  name                        = "${local.p}-command-queue.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  visibility_timeout_seconds  = 300
  message_retention_seconds   = 86400 # 1 day
  kms_master_key_id           = var.kms_key_arn

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq_command.arn
    maxReceiveCount     = 3
  })

  tags = merge(local.common_tags, { Name = "${local.p}-command-queue" })
}

resource "aws_sqs_queue" "notification" {
  name                       = "${local.p}-notification-queue"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 86400
  kms_master_key_id          = var.kms_key_arn

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq_notification.arn
    maxReceiveCount     = 3
  })

  tags = merge(local.common_tags, { Name = "${local.p}-notification-queue" })
}
