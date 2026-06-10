variable "project" { type = string }
variable "domain_prefix" { type = string }
variable "allowed_callback_urls" { type = list(string) }
variable "allowed_logout_urls" { type = list(string) }
variable "tags" {
  type    = map(string)
  default = {}
}
