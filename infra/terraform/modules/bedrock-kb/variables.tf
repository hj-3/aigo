variable "project" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "aws_account_id" {
  type = string
}

variable "kb_bucket_arn" {
  description = "ARN of the S3 bucket that stores Knowledge Base source documents"
  type        = string
}

variable "kb_bucket_name" {
  description = "Name of the S3 bucket that stores Knowledge Base source documents"
  type        = string
}

variable "enabled" {
  description = "Set to false to destroy AOSS + KB and stop ~$692/month OCU cost"
  type        = bool
  default     = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
