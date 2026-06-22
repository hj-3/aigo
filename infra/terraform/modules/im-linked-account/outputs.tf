output "cross_account_role_arn" {
  description = "ARN of the cross-account role to store in aigo-im-LinkedAccounts DDB"
  value       = aws_iam_role.cross_account.arn
}

output "eventbridge_forward_role_arn" {
  description = "ARN of the EventBridge forwarding role"
  value       = aws_iam_role.eventbridge_forward.arn
}
