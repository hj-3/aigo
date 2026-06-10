output "agent_ids" {
  description = "Map of agent name to Bedrock Agent ID"
  value       = { for k, v in aws_bedrockagent_agent.agents : k => v.agent_id }
}

output "agent_alias_ids" {
  description = "Map of agent name to Agent Alias ID"
  value       = { for k, v in aws_bedrockagent_agent_alias.agents : k => v.agent_alias_id }
}

output "agent_alias_arns" {
  description = "Map of agent name to Agent Alias ARN (used by workers to invoke agents)"
  value       = { for k, v in aws_bedrockagent_agent_alias.agents : k => v.agent_alias_arn }
}

output "bedrock_agent_role_arn" {
  description = "IAM role ARN used by Bedrock Agent service"
  value       = aws_iam_role.bedrock_agent.arn
}
