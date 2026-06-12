output "github_actions_role_arn" { value = aws_iam_role.github_actions_deploy.arn }
output "lambda_connector_role_arn" { value = aws_iam_role.lambda_connector.arn }
output "lambda_api_role_arn" { value = aws_iam_role.lambda_api.arn }
output "lambda_worker_role_arn" { value = aws_iam_role.lambda_worker.arn }
output "lambda_orchestrator_role_arn" { value = aws_iam_role.lambda_orchestrator.arn }
output "ecs_task_role_arn" { value = aws_iam_role.ecs_task.arn }
output "ecs_execution_role_arn" { value = aws_iam_role.ecs_execution.arn }
