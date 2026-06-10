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

variable "kms_key_arn" {
  type        = string
  description = "KMS key ARN for CloudWatch log encryption"
}

variable "sns_alarm_topic_arn" {
  type        = string
  description = "SNS topic ARN for alarm notifications"
}

variable "lambda_function_names" {
  type        = list(string)
  description = "List of Lambda function names to monitor"
  default     = []
}

variable "sqs_dlq_names" {
  type        = list(string)
  description = "List of SQS DLQ queue names to alarm on"
  default     = []
}

variable "api_gateway_id" {
  type        = string
  description = "API Gateway HTTP API ID"
  default     = ""
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch Log Group retention in days"
  default     = 90
}

variable "tags" {
  type    = map(string)
  default = {}
}
