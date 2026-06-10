output "dynamodb_key_arn" {
  value = aws_kms_key.dynamodb.arn
}
output "dynamodb_key_id" {
  value = aws_kms_key.dynamodb.key_id
}
output "s3_key_arn" {
  value = aws_kms_key.s3.arn
}
output "s3_key_id" {
  value = aws_kms_key.s3.key_id
}
output "sqs_key_arn" {
  value = aws_kms_key.sqs.arn
}
output "lambda_key_arn" {
  value = aws_kms_key.lambda.arn
}
output "cloudwatch_key_arn" {
  value = aws_kms_key.cloudwatch.arn
}
