variable "aws_region" {
  description = "Primary AWS region"
  type        = string
  default     = "ap-northeast-2"
}

variable "project" {
  description = "Project name (used as prefix for all resources)"
  type        = string
  default     = "aigo"
}

variable "aws_account_id" {
  description = "AWS account ID"
  type        = string
}

variable "domain_name" {
  description = "Root domain name (e.g. aigo.example.com). Leave empty to use AWS defaults."
  type        = string
  default     = ""
}

variable "alert_email" {
  description = "Email address for CloudWatch alarm notifications"
  type        = string
}

variable "enable_nat_gateway" {
  description = "Enable NAT Gateways (set false to reduce cost in non-prod)"
  type        = bool
  default     = true
}
