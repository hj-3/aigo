variable "central_account_id" {
  description = "AWS account ID of the AIGO central account (where im-event-bus lives)"
  type        = string
}

variable "central_event_bus_arn" {
  description = "ARN of the central aigo-im-event-bus in the central account"
  type        = string
}

variable "im_api_role_arn" {
  description = "ARN of the im-api IAM role in the central account (granted AssumeRole)"
  type        = string
}

variable "aws_region" {
  description = "AWS region where this linked account's resources are deployed"
  type        = string
  default     = "ap-northeast-2"
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
