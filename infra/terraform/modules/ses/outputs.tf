output "domain_identity_arn" {
  value       = aws_ses_domain_identity.main.arn
  description = "SES domain identity ARN — pass to Cognito as ses_email_identity_arn"
}

output "email_identity_arn" {
  value       = aws_ses_email_identity.noreply.arn
  description = "SES noreply email identity ARN"
}

output "cognito_ses_role_arn" {
  value       = aws_iam_role.cognito_ses.arn
  description = "IAM role ARN that allows Cognito to send via SES"
}

output "configuration_set_name" {
  value       = aws_ses_configuration_set.main.name
  description = "SES configuration set name for bounce/complaint tracking"
}

output "sns_notifications_arn" {
  value       = aws_sns_topic.ses_notifications.arn
  description = "SNS topic ARN for SES bounce/complaint notifications"
}
