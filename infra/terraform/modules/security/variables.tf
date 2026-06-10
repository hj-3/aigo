variable "project" {
  type        = string
  description = "Project name prefix"
}

variable "aws_region" {
  type        = string
  description = "AWS region"
}

variable "aws_account_id" {
  type        = string
  description = "AWS account ID"
}

variable "cloudfront_distribution_arn" {
  type        = string
  description = "CloudFront distribution ARN (for WAF association)"
  default     = ""
}

variable "api_gateway_arn" {
  type        = string
  description = "API Gateway stage ARN (for WAF association)"
  default     = ""
}

variable "s3_audit_bucket_name" {
  type        = string
  description = "S3 bucket name for CloudTrail audit logs"
}

variable "kms_key_arn" {
  type        = string
  description = "KMS key ARN for CloudTrail encryption"
}

variable "sns_alarm_topic_arn" {
  type        = string
  description = "SNS topic ARN for security alerts"
}

variable "tags" {
  type    = map(string)
  default = {}
}
