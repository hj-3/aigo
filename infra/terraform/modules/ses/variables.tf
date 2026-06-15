variable "project" { type = string }
variable "domain_name" {
  description = "Root domain name (e.g. seolphung.com)"
  type        = string
}
variable "route53_zone_id" {
  description = "Route53 Hosted Zone ID for the domain"
  type        = string
}
variable "aws_region" {
  description = "AWS region (used for SES feedback-smtp endpoint)"
  type        = string
  default     = "ap-northeast-2"
}
variable "alert_email" {
  description = "Email address for DMARC reports (rua)"
  type        = string
  default     = ""
}
variable "tags" {
  type    = map(string)
  default = {}
}
