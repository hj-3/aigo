variable "project" { type = string }
variable "domain_prefix" { type = string }
variable "allowed_callback_urls" { type = list(string) }
variable "allowed_logout_urls" { type = list(string) }

variable "ses_email_identity_arn" {
  description = "SES verified identity ARN for sending Cognito emails (e.g. arn:aws:ses:ap-northeast-2:ACCOUNT:identity/noreply@seolphung.com)"
  type        = string
}

variable "ses_from_address" {
  description = "From email address for Cognito user pool emails (must be verified in SES)"
  type        = string
  default     = "noreply@seolphung.com"
}

variable "post_confirmation_lambda_arn" {
  description = "ARN of Lambda triggered after user email confirmation (creates org record)"
  type        = string
  default     = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}
