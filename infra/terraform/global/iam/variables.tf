variable "project" { type = string }
variable "aws_account_id" { type = string }
variable "aws_region" { type = string }
variable "github_org" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}
