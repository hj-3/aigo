variable "project" { type = string }
variable "domain_name" {
  description = "Root domain name (e.g. seolphung.com)"
  type        = string
}
variable "route53_zone_id" {
  description = "Route53 Hosted Zone ID for the domain"
  type        = string
}
variable "tags" {
  type    = map(string)
  default = {}
}
