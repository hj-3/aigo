output "api_endpoint" {
  description = "API Gateway invoke URL"
  value       = module.api_gateway.stage_invoke_url
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain"
  value       = module.cloudfront.distribution_domain
}

output "cognito_user_pool_id" {
  value = module.cognito.user_pool_id
}

output "cognito_client_id" {
  value = module.cognito.client_id
}

output "cognito_domain" {
  value = "${module.cognito.domain}.auth.ap-northeast-2.amazoncognito.com"
}

output "dynamodb_table_names" {
  value = module.dynamodb.table_names
}

output "s3_bucket_names" {
  value = module.s3.bucket_names
}

output "sqs_queue_urls" {
  value = module.sqs.queue_urls
}

output "ecs_cluster_arn" {
  value = module.ecs.cluster_arn
}

output "vpc_id" {
  value = module.vpc.vpc_id
}

output "bedrock_agent_ids" {
  description = "Map of agent name to Bedrock Agent ID"
  value       = module.bedrock_agentcore.agent_ids
}

output "bedrock_agent_alias_arns" {
  description = "Map of agent name to Agent Alias ARN (used by workers)"
  value       = module.bedrock_agentcore.agent_alias_arns
}

output "bedrock_kb_id" {
  description = "Bedrock Knowledge Base ID"
  value       = module.bedrock_kb.knowledge_base_id
}
