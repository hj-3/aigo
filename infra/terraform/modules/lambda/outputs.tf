output "function_name" { value = aws_lambda_function.this.function_name }
output "function_arn" { value = aws_lambda_function.this.arn }
output "alias_arn" { value = aws_lambda_alias.live.arn }
output "invoke_arn" { value = aws_lambda_function.this.invoke_arn }
output "alias_invoke_arn" { value = aws_lambda_alias.live.invoke_arn }
output "version" { value = aws_lambda_function.this.version }
output "error_alarm_arn" { value = aws_cloudwatch_metric_alarm.error_rate.arn }
