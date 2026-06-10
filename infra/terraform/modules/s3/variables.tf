variable "project" { type = string }
variable "kms_key_arn" { type = string }
variable "logs_bucket_name" {
  description = "Pre-created logging bucket name (for access log delivery)"
  type        = string
  default     = ""
}
variable "replication_role_arn" {
  description = "IAM role ARN for S3 CRR (leave empty to skip replication)"
  type        = string
  default     = ""
}
variable "replication_destination_account" {
  description = "DR account ID for S3 replication"
  type        = string
  default     = ""
}
variable "tags" {
  type    = map(string)
  default = {}
}
