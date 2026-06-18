output "knowledge_base_id" {
  description = "Bedrock Knowledge Base ID (empty string when enabled=false)"
  value       = try(aws_bedrockagent_knowledge_base.main[0].id, "")
}

output "knowledge_base_arn" {
  description = "Bedrock Knowledge Base ARN (empty string when enabled=false)"
  value       = try(aws_bedrockagent_knowledge_base.main[0].arn, "")
}

output "collection_arn" {
  description = "AOSS collection ARN (empty string when enabled=false)"
  value       = try(aws_opensearchserverless_collection.vectors[0].arn, "")
}

output "kb_role_arn" {
  description = "IAM role ARN used by Bedrock KB service"
  value       = aws_iam_role.bedrock_kb.arn
}
