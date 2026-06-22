variable "kms_key_arn" {
  description = "KMS key ARN for DynamoDB server-side encryption (reuse alias/aigo-dynamodb)"
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
