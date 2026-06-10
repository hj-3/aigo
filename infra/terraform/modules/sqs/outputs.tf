output "queue_urls" {
  value = {
    analysis     = aws_sqs_queue.analysis.url
    fix          = aws_sqs_queue.fix.url
    incident     = aws_sqs_queue.incident.url
    command      = aws_sqs_queue.command.url
    notification = aws_sqs_queue.notification.url
  }
}
output "queue_arns" {
  value = {
    analysis     = aws_sqs_queue.analysis.arn
    fix          = aws_sqs_queue.fix.arn
    incident     = aws_sqs_queue.incident.arn
    command      = aws_sqs_queue.command.arn
    notification = aws_sqs_queue.notification.arn
  }
}
output "dlq_arns" {
  value = {
    analysis     = aws_sqs_queue.dlq_analysis.arn
    fix          = aws_sqs_queue.dlq_fix.arn
    incident     = aws_sqs_queue.dlq_incident.arn
    command      = aws_sqs_queue.dlq_command.arn
    notification = aws_sqs_queue.dlq_notification.arn
  }
}
