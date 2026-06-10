variable "project" { type = string }
variable "aws_region" { type = string }
variable "cognito_user_pool_arn" { type = string }
variable "cognito_client_id" {
  type = string
}
variable "lambda_arns" {
  description = "Map of route key to Lambda function ARN"
  type        = map(string)
  default     = {}
}
variable "cors_allow_origins" {
  type    = list(string)
  default = []
}
variable "tags" {
  type = map(string)
  default = {}
}
