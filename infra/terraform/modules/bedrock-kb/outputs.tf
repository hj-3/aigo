output "knowledge_base_id" {
  description = "Bedrock Knowledge Base ID (used as BEDROCK_KB_ID env var)"
  value       = aws_bedrockagent_knowledge_base.main.id
}

output "knowledge_base_arn" {
  description = "Bedrock Knowledge Base ARN"
  value       = aws_bedrockagent_knowledge_base.main.arn
}

output "collection_arn" {
  description = "ARN of the shared OpenSearch Serverless collection"
  value       = aws_opensearchserverless_collection.vectors.arn
}

output "kb_role_arn" {
  description = "IAM role ARN used by Bedrock KB service"
  value       = aws_iam_role.bedrock_kb.arn
}
