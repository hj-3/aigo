locals {
  common_tags = merge(var.tags, {
    Project   = var.project
    ManagedBy = "terraform"
    Module    = "kms"
  })
}

# ──────────────────────────────────────────────────────────────────────────────
# DynamoDB KMS Key
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_kms_key" "dynamodb" {
  description             = "${var.project} DynamoDB encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  multi_region            = false

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Enable IAM User Permissions"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.aws_account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "Allow DynamoDB Service"
        Effect    = "Allow"
        Principal = { Service = "dynamodb.amazonaws.com" }
        Action    = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"]
        Resource  = "*"
      }
    ]
  })

  tags = merge(local.common_tags, { Name = "${var.project}-kms-dynamodb" })
}

resource "aws_kms_alias" "dynamodb" {
  name          = "alias/${var.project}-dynamodb"
  target_key_id = aws_kms_key.dynamodb.key_id
}

# ──────────────────────────────────────────────────────────────────────────────
# S3 KMS Key
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_kms_key" "s3" {
  description             = "${var.project} S3 encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  multi_region            = false

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Enable IAM User Permissions"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.aws_account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "Allow S3 Service"
        Effect    = "Allow"
        Principal = { Service = "s3.amazonaws.com" }
        Action    = ["kms:GenerateDataKey*", "kms:Decrypt"]
        Resource  = "*"
      }
    ]
  })

  tags = merge(local.common_tags, { Name = "${var.project}-kms-s3" })
}

resource "aws_kms_alias" "s3" {
  name          = "alias/${var.project}-s3"
  target_key_id = aws_kms_key.s3.key_id
}

# ──────────────────────────────────────────────────────────────────────────────
# SQS KMS Key
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_kms_key" "sqs" {
  description             = "${var.project} SQS encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Enable IAM User Permissions"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.aws_account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "Allow SQS Service"
        Effect    = "Allow"
        Principal = { Service = "sqs.amazonaws.com" }
        Action    = ["kms:GenerateDataKey*", "kms:Decrypt"]
        Resource  = "*"
      }
    ]
  })

  tags = merge(local.common_tags, { Name = "${var.project}-kms-sqs" })
}

resource "aws_kms_alias" "sqs" {
  name          = "alias/${var.project}-sqs"
  target_key_id = aws_kms_key.sqs.key_id
}

# ──────────────────────────────────────────────────────────────────────────────
# Lambda / SSM KMS Key
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_kms_key" "lambda" {
  description             = "${var.project} Lambda environment variables & SSM encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Enable IAM User Permissions"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.aws_account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      }
    ]
  })

  tags = merge(local.common_tags, { Name = "${var.project}-kms-lambda" })
}

resource "aws_kms_alias" "lambda" {
  name          = "alias/${var.project}-lambda"
  target_key_id = aws_kms_key.lambda.key_id
}

# ──────────────────────────────────────────────────────────────────────────────
# CloudWatch Logs KMS Key
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_kms_key" "cloudwatch" {
  description             = "${var.project} CloudWatch Logs encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Enable IAM User Permissions"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.aws_account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "Allow CloudWatch Logs"
        Effect    = "Allow"
        Principal = { Service = "logs.${var.aws_region}.amazonaws.com" }
        Action    = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
        Resource  = "*"
      },
      {
        Sid       = "Allow CloudTrail"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = ["kms:GenerateDataKey*", "kms:Decrypt"]
        Resource  = "*"
        Condition = {
          StringLike = {
            "kms:EncryptionContext:aws:cloudtrail:arn" = "arn:aws:cloudtrail:${var.aws_region}:${var.aws_account_id}:trail/*"
          }
        }
      }
    ]
  })

  tags = merge(local.common_tags, { Name = "${var.project}-kms-cloudwatch" })
}

resource "aws_kms_alias" "cloudwatch" {
  name          = "alias/${var.project}-cloudwatch"
  target_key_id = aws_kms_key.cloudwatch.key_id
}
