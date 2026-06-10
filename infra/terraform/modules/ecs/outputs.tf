output "cluster_arn" { value = aws_ecs_cluster.main.arn }
output "cluster_name" { value = aws_ecs_cluster.main.name }
output "heavy_worker_task_definition_arn" { value = aws_ecs_task_definition.heavy_worker.arn }
output "heavy_worker_task_definition_family" { value = aws_ecs_task_definition.heavy_worker.family }
