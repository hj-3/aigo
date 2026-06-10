variable "project" { type = string }
variable "frontend_bucket_id" { type = string }
variable "frontend_bucket_arn" { type = string }
variable "api_domain" { type = string }
variable "domain_name" {
  type    = string
  default = ""
}
variable "acm_certificate_arn" {
  type    = string
  default = ""
}
variable "tags" {
  type    = map(string)
  default = {}
}
