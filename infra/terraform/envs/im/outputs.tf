output "im_api_url" {
  description = "IM API Gateway URL"
  value       = "https://im-api.seolphung.com"
}

output "im_api_gateway_id" {
  value = aws_apigatewayv2_api.im.id
}

output "im_sfn_arn" {
  value = aws_sfn_state_machine.investigation.arn
}

output "im_reports_bucket" {
  value = aws_s3_bucket.im_reports.id
}

output "im_event_bus_name" {
  value = aws_cloudwatch_event_bus.im.name
}

output "lambda_function_names" {
  value = {
    api              = module.lambda_im_api.function_name
    normalize_event  = module.lambda_im_normalize_event.function_name
    webhook_receiver = module.lambda_im_webhook_receiver.function_name
    security_event   = module.lambda_im_security_event.function_name
    supervisor       = module.lambda_im_supervisor.function_name
    scope_agent      = module.lambda_im_scope_agent.function_name
    summary_agent    = module.lambda_im_summary_agent.function_name
    security_agent   = module.lambda_im_security_agent.function_name
    action_executor  = module.lambda_im_action_executor.function_name
  }
}
