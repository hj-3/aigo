output "table_names" {
  description = "Map of logical name to DynamoDB table name"
  value = {
    incidents             = aws_dynamodb_table.incidents.name
    investigation_results = aws_dynamodb_table.investigation_results.name
    reports               = aws_dynamodb_table.reports.name
    recovery_actions      = aws_dynamodb_table.recovery_actions.name
    investigation_targets = aws_dynamodb_table.investigation_targets.name
    external_integrations = aws_dynamodb_table.external_integrations.name
    linked_accounts       = aws_dynamodb_table.linked_accounts.name
    allowed_actions       = aws_dynamodb_table.allowed_actions.name
    remediation_settings  = aws_dynamodb_table.remediation_settings.name
    security_events       = aws_dynamodb_table.security_events.name
    conversations         = aws_dynamodb_table.conversations.name
  }
}

output "table_arns" {
  description = "Map of logical name to DynamoDB table ARN"
  value = {
    incidents             = aws_dynamodb_table.incidents.arn
    investigation_results = aws_dynamodb_table.investigation_results.arn
    reports               = aws_dynamodb_table.reports.arn
    recovery_actions      = aws_dynamodb_table.recovery_actions.arn
    investigation_targets = aws_dynamodb_table.investigation_targets.arn
    external_integrations = aws_dynamodb_table.external_integrations.arn
    linked_accounts       = aws_dynamodb_table.linked_accounts.arn
    allowed_actions       = aws_dynamodb_table.allowed_actions.arn
    remediation_settings  = aws_dynamodb_table.remediation_settings.arn
    security_events       = aws_dynamodb_table.security_events.arn
    conversations         = aws_dynamodb_table.conversations.arn
  }
}
