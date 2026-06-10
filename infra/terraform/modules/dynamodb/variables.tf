variable "project" {
  type = string
}

variable "kms_key_arn" {
  description = "KMS key ARN for DynamoDB encryption"
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
