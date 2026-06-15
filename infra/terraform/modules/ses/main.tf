locals {
  p = var.project
  common_tags = merge(var.tags, {
    Project   = var.project
    ManagedBy = "terraform"
    Module    = "ses"
  })
}

# ──────────────────────────────────────────────────────────────────────────────
# SES Domain Identity — seolphung.com
# After apply: add the DKIM CNAME records in Route53 (done below)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_ses_domain_identity" "main" {
  domain = var.domain_name
}

resource "aws_ses_domain_dkim" "main" {
  domain = aws_ses_domain_identity.main.domain
}

resource "aws_route53_record" "ses_dkim" {
  count   = 3
  zone_id = var.route53_zone_id
  name    = "${aws_ses_domain_dkim.main.dkim_tokens[count.index]}._domainkey"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.main.dkim_tokens[count.index]}.dkim.amazonses.com"]
}

# SPF record — authorizes SES to send on behalf of the domain
resource "aws_route53_record" "ses_spf" {
  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "TXT"
  ttl     = 600
  records = ["v=spf1 include:amazonses.com ~all"]
}

# Custom MAIL FROM domain — makes SPF alignment pass for DMARC
# Return-Path: bounce@mail.<domain> (same org domain as From: @<domain>)
resource "aws_ses_domain_mail_from" "main" {
  domain           = aws_ses_domain_identity.main.domain
  mail_from_domain = "mail.${var.domain_name}"
  behavior_on_mx_failure = "REJECT_MESSAGE"
}

# MX record for custom MAIL FROM domain (SES bounce/feedback endpoint)
resource "aws_route53_record" "ses_mail_from_mx" {
  zone_id = var.route53_zone_id
  name    = "mail.${var.domain_name}"
  type    = "MX"
  ttl     = 300
  records = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
}

# SPF record for custom MAIL FROM subdomain
resource "aws_route53_record" "ses_mail_from_spf" {
  zone_id = var.route53_zone_id
  name    = "mail.${var.domain_name}"
  type    = "TXT"
  ttl     = 300
  records = ["v=spf1 include:amazonses.com ~all"]
}

# DMARC record — p=none for monitoring; escalate to quarantine/reject after confirming alignment
resource "aws_route53_record" "ses_dmarc" {
  zone_id = var.route53_zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  ttl     = 300
  records = ["v=DMARC1; p=none; rua=mailto:${var.alert_email}"]
}

# ──────────────────────────────────────────────────────────────────────────────
# SES Configuration Set — for tracking bounces and complaints
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_ses_configuration_set" "main" {
  name = "${local.p}-email"

  delivery_options {
    tls_policy = "Require"
  }

  reputation_metrics_enabled = true
  sending_enabled            = true
}

# SNS topic for bounce/complaint notifications
resource "aws_sns_topic" "ses_notifications" {
  name = "${local.p}-ses-notifications"
  tags = local.common_tags
}

resource "aws_ses_identity_notification_topic" "bounce" {
  topic_arn                = aws_sns_topic.ses_notifications.arn
  notification_type        = "Bounce"
  identity                 = aws_ses_domain_identity.main.domain
  include_original_headers = false
}

resource "aws_ses_identity_notification_topic" "complaint" {
  topic_arn                = aws_sns_topic.ses_notifications.arn
  notification_type        = "Complaint"
  identity                 = aws_ses_domain_identity.main.domain
  include_original_headers = false
}

# ──────────────────────────────────────────────────────────────────────────────
# IAM — Allow Cognito to send via SES
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_iam_role" "cognito_ses" {
  name = "${local.p}-cognito-ses-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cognito-idp.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "cognito_ses" {
  name = "${local.p}-cognito-ses-policy"
  role = aws_iam_role.cognito_ses.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource = aws_ses_domain_identity.main.arn
    }]
  })
}
