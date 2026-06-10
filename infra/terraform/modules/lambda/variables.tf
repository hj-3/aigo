variable "project" { type = string }
variable "function_name" { type = string }
variable "description" {
  type = string
  default = ""
}
variable "handler" { type = string }
variable "runtime" {
  type = string
  default = "nodejs22.x"
}
variable "memory_size" {
  type = number
  default = 512
}
variable "timeout" {
  type = number
  default = 30
}
variable "s3_bucket" { type = string }
variable "s3_key" { type = string }
variable "environment_variables" {
  type = map(string)
  default = {}
}
variable "kms_key_arn" { type = string }
variable "role_arn" { type = string }
variable "subnet_ids" {
  type = list(string)
  default = []
}
variable "security_group_ids" {
  type = list(string)
  default = []
}
variable "reserved_concurrency" {
  type = number
  default = -1
}
variable "log_retention_days" {
  type = number
  default = 30
}
variable "layers" {
  type = list(string)
  default = []
}
variable "publish" {
  type = bool
  default = true
}
variable "tags" {
  type = map(string)
  default = {}
}
