output "api_id" { value = aws_apigatewayv2_api.main.id }
output "api_endpoint" { value = aws_apigatewayv2_api.main.api_endpoint }
output "stage_invoke_url" { value = aws_apigatewayv2_stage.prod.invoke_url }
output "execution_arn" { value = aws_apigatewayv2_api.main.execution_arn }
