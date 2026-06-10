variable "project" { type = string }
variable "aws_region" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "security_group_id" { type = string }
variable "task_role_arn" { type = string }
variable "execution_role_arn" { type = string }
variable "kms_key_arn" { type = string }
variable "logs_group_prefix" {
  type    = string
  default = "/ecs"
}
variable "tags" {
  type    = map(string)
  default = {}
}
