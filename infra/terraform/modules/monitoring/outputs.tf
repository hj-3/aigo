output "log_group_names" {
  description = "Map of Lambda function name to CloudWatch Log Group name"
  value       = { for k, v in aws_cloudwatch_log_group.lambda : k => v.name }
}

output "dashboard_name" {
  description = "CloudWatch dashboard name"
  value       = aws_cloudwatch_dashboard.overview.dashboard_name
}

output "dashboard_arn" {
  description = "CloudWatch dashboard ARN"
  value       = aws_cloudwatch_dashboard.overview.dashboard_arn
}
