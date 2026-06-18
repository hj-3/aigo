variable "project" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}

variable "analysis_queue_arn" {
  type        = string
  description = "ARN of SQS FIFO queue for PR analysis jobs"
  default     = ""
}

variable "incident_queue_arn" {
  type        = string
  description = "ARN of SQS FIFO queue for incident jobs"
  default     = ""
}

variable "notification_queue_arn" {
  type        = string
  description = "ARN of SQS FIFO queue for notifications"
  default     = ""
}
