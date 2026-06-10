locals {
  p = var.project
  common_tags = merge(var.tags, {
    Project   = var.project
    ManagedBy = "terraform"
    Module    = "security"
  })
}

# ──────────────────────────────────────────────────────────────────────────────
# GuardDuty — threat detection (malware, credential compromise, unusual API calls)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_guardduty_detector" "main" {
  enable = true
  tags   = local.common_tags
}

resource "aws_guardduty_detector_feature" "s3_logs" {
  detector_id = aws_guardduty_detector.main.id
  name        = "S3_DATA_EVENTS"
  status      = "ENABLED"
}

resource "aws_guardduty_detector_feature" "ebs_malware" {
  detector_id = aws_guardduty_detector.main.id
  name        = "EBS_MALWARE_PROTECTION"
  status      = "ENABLED"
}

# ──────────────────────────────────────────────────────────────────────────────
# WAF Web ACL — API Gateway protection (REGIONAL scope)
# Managed rules: common web exploits, known bad inputs, SQL injection
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_wafv2_web_acl" "api" {
  name        = "${local.p}-api-waf"
  description = "WAF for API Gateway - managed rules + rate limiting"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  # AWS Managed Rules: Common Web Application Exploits
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 10

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.p}-common-rules"
      sampled_requests_enabled   = true
    }
  }

  # AWS Managed Rules: Known Bad Inputs
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 20

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.p}-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  # AWS Managed Rules: SQL Database
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 30

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.p}-sqli-rules"
      sampled_requests_enabled   = true
    }
  }

  # Rate limit: 2000 requests per 5 minutes per IP
  rule {
    name     = "RateLimitPerIP"
    priority = 40

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.p}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.p}-api-waf"
    sampled_requests_enabled   = true
  }

  tags = local.common_tags
}

# Associate WAF with API Gateway stage
resource "aws_wafv2_web_acl_association" "api_gateway" {
  count = var.api_gateway_arn != "" ? 1 : 0

  resource_arn = var.api_gateway_arn
  web_acl_arn  = aws_wafv2_web_acl.api.arn
}

# ──────────────────────────────────────────────────────────────────────────────
# CloudTrail — audit log for all management events
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_s3_bucket_policy" "cloudtrail" {
  bucket = var.s3_audit_bucket_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AWSCloudTrailAclCheck"
        Effect = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action   = "s3:GetBucketAcl"
        Resource = "arn:aws:s3:::${var.s3_audit_bucket_name}"
        Condition = {
          StringEquals = { "AWS:SourceArn" = "arn:aws:cloudtrail:${var.aws_region}:${var.aws_account_id}:trail/${local.p}-trail" }
        }
      },
      {
        Sid    = "AWSCloudTrailWrite"
        Effect = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action   = "s3:PutObject"
        Resource = "arn:aws:s3:::${var.s3_audit_bucket_name}/cloudtrail/AWSLogs/${var.aws_account_id}/*"
        Condition = {
          StringEquals = {
            "s3:x-amz-acl"  = "bucket-owner-full-control"
            "AWS:SourceArn" = "arn:aws:cloudtrail:${var.aws_region}:${var.aws_account_id}:trail/${local.p}-trail"
          }
        }
      },
    ]
  })
}

resource "aws_cloudtrail" "main" {
  name                          = "${local.p}-trail"
  s3_bucket_name                = var.s3_audit_bucket_name
  s3_key_prefix                 = "cloudtrail"
  include_global_service_events = true
  is_multi_region_trail         = false
  enable_log_file_validation    = true
  kms_key_id                    = var.kms_key_arn

  event_selector {
    read_write_type           = "All"
    include_management_events = true
  }

  depends_on = [aws_s3_bucket_policy.cloudtrail]

  tags = local.common_tags
}

# ──────────────────────────────────────────────────────────────────────────────
# GuardDuty High-Severity Finding Alarm → SNS
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_event_rule" "guardduty_high" {
  name        = "${local.p}-guardduty-high-severity"
  description = "Alert on GuardDuty high/critical severity findings"

  event_pattern = jsonencode({
    source      = ["aws.guardduty"]
    detail-type = ["GuardDuty Finding"]
    detail = {
      severity = [{ numeric = [">=", 7] }]
    }
  })

  tags = local.common_tags
}

resource "aws_cloudwatch_event_target" "guardduty_sns" {
  rule      = aws_cloudwatch_event_rule.guardduty_high.name
  target_id = "guardduty-to-sns"
  arn       = var.sns_alarm_topic_arn
}
