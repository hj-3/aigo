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

variable "github_app_id" {
  description = "GitHub App ID (numeric, found in GitHub App settings)"
  type        = string
  default     = ""
}

variable "github_app_slug" {
  description = "GitHub App slug (used to construct the installation URL)"
  type        = string
  default     = "aigo-app"
}

variable "slack_client_id" {
  description = "Slack App OAuth client ID"
  type        = string
  default     = ""
}

variable "slack_client_secret" {
  description = "Slack App OAuth client secret"
  type        = string
  sensitive   = true
  default     = ""
}

variable "route53_zone_id" {
  description = "Route 53 Hosted Zone ID for the domain (used by SES module)"
  type        = string
  default     = ""
}
