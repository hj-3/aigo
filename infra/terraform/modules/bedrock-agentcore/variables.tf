variable "project" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "aws_account_id" {
  type = string
}

variable "foundation_model" {
  description = "Bedrock foundation model ID for all agents (must be an APAC inference profile for ap-northeast-2)"
  type        = string
  default     = "apac.anthropic.claude-3-5-sonnet-20241022-v2:0"
}

variable "knowledge_base_arns" {
  description = "ARNs of Bedrock Knowledge Bases the agents can retrieve from"
  type        = list(string)
  default     = []
}

variable "s3_agent_packages_arn" {
  description = "ARN of the S3 bucket that stores agent deployment packages"
  type        = string
}

variable "agent_instructions" {
  description = "Map of agent name to full instruction/system-prompt text"
  type        = map(string)
}

variable "kms_key_arn" {
  description = "KMS key ARN for SSM Parameter encryption"
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
