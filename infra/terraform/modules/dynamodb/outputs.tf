output "table_names" {
  description = "Map of logical name to DynamoDB table name"
  value = {
    organizations = aws_dynamodb_table.organizations.name
    users         = aws_dynamodb_table.users.name
    repositories  = aws_dynamodb_table.repositories.name
    integrations  = aws_dynamodb_table.integrations.name
    analysis_jobs = aws_dynamodb_table.analysis_jobs.name
    agent_runs    = aws_dynamodb_table.agent_runs.name
    reports       = aws_dynamodb_table.reports.name
    findings      = aws_dynamodb_table.findings.name
    approvals     = aws_dynamodb_table.approvals.name
    fix_requests  = aws_dynamodb_table.fix_requests.name
    incidents     = aws_dynamodb_table.incidents.name
    audit_logs    = aws_dynamodb_table.audit_logs.name
    usage_records = aws_dynamodb_table.usage_records.name
  }
}

output "table_arns" {
  description = "Map of logical name to DynamoDB table ARN"
  value = {
    organizations = aws_dynamodb_table.organizations.arn
    users         = aws_dynamodb_table.users.arn
    repositories  = aws_dynamodb_table.repositories.arn
    integrations  = aws_dynamodb_table.integrations.arn
    analysis_jobs = aws_dynamodb_table.analysis_jobs.arn
    agent_runs    = aws_dynamodb_table.agent_runs.arn
    reports       = aws_dynamodb_table.reports.arn
    findings      = aws_dynamodb_table.findings.arn
    approvals     = aws_dynamodb_table.approvals.arn
    fix_requests  = aws_dynamodb_table.fix_requests.arn
    incidents     = aws_dynamodb_table.incidents.arn
    audit_logs    = aws_dynamodb_table.audit_logs.arn
    usage_records = aws_dynamodb_table.usage_records.arn
  }
}
