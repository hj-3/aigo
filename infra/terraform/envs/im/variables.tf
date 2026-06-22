variable "aws_region" {
  type    = string
  default = "ap-northeast-2"
}

variable "aws_account_id" {
  description = "AWS account ID"
  type        = string
}

variable "alert_email" {
  description = "Email for CloudWatch alarm notifications"
  type        = string
}

variable "aws_org_id" {
  description = "AWS Organizations ID — restricts cross-account event bus access to org members"
  type        = string
  default     = ""
}
